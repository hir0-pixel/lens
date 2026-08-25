import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  bootstrapModelGovernance,
  signChangeFence,
  HmacChangeGate,
  StructuralEvidenceVerifier,
  LedgerRegistryAudit,
  HmacSnapshotSigner,
  RegistryModelGovernance,
  type ModelGovernanceManifest,
  type ModelGovernanceManifestEntry,
} from "../src/modelGovernance";
import { ModelRegistry, RegistryError, type EvidenceVerifier } from "../../services/model-registry/ModelRegistry";

const OPS_KEY = randomBytes(32).toString("hex");
const NOW = 1_700_000_000_000;

function manifestEntry(overrides: Partial<ModelGovernanceManifestEntry> = {}): ModelGovernanceManifestEntry {
  return {
    modelId: "lens-assistant",
    version: "1.0.0",
    aliases: ["default"],
    artifactRef: "oci://internal/lens-assistant@1.0.0",
    artifactDigest: `sha256:${"1".repeat(64)}`,
    manifestDigest: `sha256:${"2".repeat(64)}`,
    provenanceRef: "provenance:1",
    sbomRef: "sbom:1",
    modelCardRef: "card:1",
    signerRef: "signer:1",
    capability: {
      contextWindow: 8192,
      supportsToolCalling: false,
      supportsVision: false,
      supportsEmbeddings: false,
      runtimeFamily: "internal-llm",
      quantization: "fp16",
      measuredThroughputEvidenceRef: "throughput:1",
      approvedRequestClasses: ["grounded-assistant"],
    },
    evidenceRefs: [],
    deploymentProfileDigest: `sha256:${"3".repeat(64)}`,
    ...overrides,
  };
}

describe("bootstrapModelGovernance", () => {
  it("bootstraps a real ModelRegistry-backed governance that resolves an alias to an approved internal digest", async () => {
    const manifest: ModelGovernanceManifest = { entries: [manifestEntry()] };
    const governance = bootstrapModelGovernance(manifest, OPS_KEY, () => NOW);

    const resolved = governance.resolve({ modelRef: "default", capability: "grounded-assistant" });
    expect(resolved.artifactDigest).toBe(`sha256:${"1".repeat(64)}`);

    const endpoint = await governance.resolveEndpoint({
      capability: "grounded-assistant",
      artifactDigest: resolved.artifactDigest,
      denyEpoch: governance.currentDenyEpoch(),
    });
    expect(endpoint.external).toBe(false);
    expect(endpoint.endpointRef).toContain(resolved.artifactDigest);
  });

  it("resolveEndpoint fails closed on a request-time capability mismatch: a model approved only for grounded-assistant is not eligible for rag-route-classification, per call, not only at boot", async () => {
    const manifest: ModelGovernanceManifest = { entries: [manifestEntry()] };
    const governance = bootstrapModelGovernance(manifest, OPS_KEY, () => NOW);
    const resolved = governance.resolve({ modelRef: "default", capability: "grounded-assistant" });

    await expect(
      governance.resolveEndpoint({ capability: "rag-route-classification", artifactDigest: resolved.artifactDigest, denyEpoch: governance.currentDenyEpoch() }),
    ).rejects.toThrow(/not approved for the requested capability/);

    await expect(
      governance.resolveEndpoint({ capability: "grounded-assistant", artifactDigest: resolved.artifactDigest, denyEpoch: governance.currentDenyEpoch() }),
    ).resolves.toBeDefined();
  });

  it("fails closed when an unrecognized model_ref is requested", () => {
    const governance = bootstrapModelGovernance({ entries: [manifestEntry()] }, OPS_KEY, () => NOW);
    expect(() => governance.resolve({ modelRef: "public-gpt-provider", capability: "grounded-assistant" })).toThrow();
  });

  it("live revocation: a model revoked via the real registry disappears from resolution on the very next check, without restarting the process", async () => {
    const artifactDigest: `sha256:${string}` = `sha256:${"9".repeat(64)}`;
    const manifest: ModelGovernanceManifest = { entries: [manifestEntry({ artifactDigest, aliases: ["revocable"] })] };

    // Build the same registry the governance object wraps so the test can
    // independently call revoke() with a real, validly-signed change-fence —
    // proving revocation is enforced by the registry's own logic, not
    // something the test fabricates a result for.
    const opsKeyBuf = Buffer.from(OPS_KEY, "hex");
    const registry = new ModelRegistry(new LedgerRegistryAudit(() => NOW), new HmacSnapshotSigner(opsKeyBuf), new StructuralEvidenceVerifier(), new HmacChangeGate(opsKeyBuf), () => NOW);
    const governance = bootstrapWithSharedRegistry(registry, manifest, OPS_KEY, () => NOW);

    const before = governance.resolve({ modelRef: "revocable", capability: "grounded-assistant" });
    await expect(
      governance.resolveEndpoint({ capability: "grounded-assistant", artifactDigest: before.artifactDigest, denyEpoch: governance.currentDenyEpoch() }),
    ).resolves.toBeDefined();

    const revokeFence = signChangeFence(OPS_KEY, "revoke", artifactDigest);
    registry.revoke("lens-assistant", "1.0.0", revokeFence);

    expect(() => governance.resolve({ modelRef: "revocable", capability: "grounded-assistant" })).toThrow();
    await expect(
      governance.resolveEndpoint({ capability: "grounded-assistant", artifactDigest, denyEpoch: 0 /* stale, pre-revocation */ }),
    ).rejects.toThrow();
  });

  it("rejects revocation attempted with a forged or missing change-fence — the ops key is not optional", () => {
    const artifactDigest: `sha256:${string}` = `sha256:${"8".repeat(64)}`;
    const manifest: ModelGovernanceManifest = { entries: [manifestEntry({ artifactDigest, modelId: "lens-assistant", version: "2.0.0", aliases: ["forge-test"] })] };
    const opsKeyBuf = Buffer.from(OPS_KEY, "hex");
    const registry = new ModelRegistry(new LedgerRegistryAudit(() => NOW), new HmacSnapshotSigner(opsKeyBuf), new StructuralEvidenceVerifier(), new HmacChangeGate(opsKeyBuf), () => NOW);
    bootstrapWithSharedRegistry(registry, manifest, OPS_KEY, () => NOW);

    expect(() => registry.revoke("lens-assistant", "2.0.0", "hmac:not-the-real-signature")).toThrow(RegistryError);
    expect(() => registry.revoke("lens-assistant", "2.0.0", "")).toThrow(RegistryError);
    // A fence signed for a DIFFERENT operation must not authorize this one.
    const wrongOperationFence = signChangeFence(OPS_KEY, "approve", artifactDigest);
    expect(() => registry.revoke("lens-assistant", "2.0.0", wrongOperationFence)).toThrow(RegistryError);
  });

  it("bootstrap fails closed when a manifest entry is missing a required evidence kind — approval is not granted on trust", () => {
    const opsKeyBuf = Buffer.from(OPS_KEY, "hex");
    const registry = new ModelRegistry(new LedgerRegistryAudit(() => NOW), new HmacSnapshotSigner(opsKeyBuf), new IncompleteEvidenceVerifier(), new HmacChangeGate(opsKeyBuf), () => NOW);
    expect(() => bootstrapWithSharedRegistry(registry, { entries: [manifestEntry({ artifactDigest: `sha256:${"7".repeat(64)}` })] }, OPS_KEY, () => NOW)).toThrow(RegistryError);
  });

  it("never returns an externally-routable endpoint: resolveEndpoint's external flag is always false for a registry that only ever registers oci://internal/ artifacts", async () => {
    const governance = bootstrapModelGovernance({ entries: [manifestEntry()] }, OPS_KEY, () => NOW);
    const resolved = governance.resolve({ modelRef: "default", capability: "grounded-assistant" });
    const endpoint = await governance.resolveEndpoint({ capability: "grounded-assistant", artifactDigest: resolved.artifactDigest, denyEpoch: governance.currentDenyEpoch() });
    expect(endpoint.external).toBe(false);
  });
});

/** Verifier that always fails evidence, to prove approve()/promote() genuinely gate on it. */
class IncompleteEvidenceVerifier implements EvidenceVerifier {
  verify(): boolean {
    return false;
  }
}

/** Test-only helper: bootstrapModelGovernance always constructs its own ModelRegistry; these tests need a registry instance they can also call directly (e.g. to revoke), so this mirrors bootstrap's own logic against an already-constructed registry. */
function bootstrapWithSharedRegistry(
  registry: ModelRegistry,
  manifest: ModelGovernanceManifest,
  opsKeyHex: string,
  _now?: () => number,
): RegistryModelGovernance {
  const governance = new RegistryModelGovernance(registry, "default");
  for (const entry of manifest.entries) {
    registry.register({
      modelId: entry.modelId,
      version: entry.version,
      artifactRef: entry.artifactRef,
      artifactDigest: entry.artifactDigest,
      manifestDigest: entry.manifestDigest,
      provenanceRef: entry.provenanceRef,
      sbomRef: entry.sbomRef,
      modelCardRef: entry.modelCardRef,
      signerRef: entry.signerRef,
    });
    const capabilityDigest = `sha256:${createHash("sha256").update(JSON.stringify(entry.capability)).digest("hex")}`;
    registry.attachCapability(entry.modelId, entry.version, { ...entry.capability, digest: capabilityDigest });
    for (const kind of ["evaluation", "red_team", "privacy", "provenance", "security"] as const) {
      registry.ingestEvidence({
        evidenceRef: `${entry.artifactDigest}:${kind}`,
        artifactDigest: entry.artifactDigest,
        kind,
        signed: true,
        passed: true,
        criticalFailure: false,
        deploymentProfileDigest: entry.deploymentProfileDigest,
      });
    }
    registry.approve(entry.modelId, entry.version, entry.deploymentProfileDigest, signChangeFence(opsKeyHex, "approve", entry.artifactDigest));
    registry.promote(entry.modelId, entry.version, entry.deploymentProfileDigest, signChangeFence(opsKeyHex, "promote", entry.artifactDigest));
    for (const alias of entry.aliases) {
      registry.setAlias(entry.modelId, alias, entry.version, signChangeFence(opsKeyHex, "alias", entry.artifactDigest));
      governance.registerAlias(alias, entry.artifactDigest, capabilityDigest, entry.capability.approvedRequestClasses);
    }
  }
  return governance;
}
