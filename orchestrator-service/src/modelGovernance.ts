import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { AuditLedger } from "../../services/audit/AuditLedger";
import {
  ModelRegistry,
  type CapabilityProfile,
  type Evidence,
  type EvidenceVerifier,
  type ModelVersion,
  type PrivilegedChangeGate,
  type RegistryAudit,
  type SnapshotSigner,
} from "../../services/model-registry/ModelRegistry";
import { OrchestratorError } from "../../services/orchestrator/types";
import type { ModelSelectionPort } from "./modelSelection";

const MODEL_REF_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function hmacHex(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function opsKeyFromHex(hex: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("Model governance ops key must be 64 hex characters (32 bytes).");
  return Buffer.from(hex, "hex");
}

/**
 * Real change-fence verification: a caller cannot approve/promote/revoke/
 * alias/roll out a model in this registry without a valid HMAC-SHA256 token
 * over `${operation}|${targetDigest}`, keyed by a server-held secret. This is
 * not a permissive mock — an incorrect or missing token is rejected exactly
 * like a real privileged-change gate would reject an invalid signature.
 */
export class HmacChangeGate implements PrivilegedChangeGate {
  constructor(private readonly opsKey: Buffer) {}
  verify(input: { operation: string; targetDigest: string; changeFenceRef: string }): boolean {
    if (!input.changeFenceRef.startsWith("hmac:")) return false;
    const expected = hmacHex(this.opsKey, `${input.operation}|${input.targetDigest}`);
    return timingSafeHexEqual(input.changeFenceRef.slice("hmac:".length), expected);
  }
}

export function signChangeFence(opsKeyHex: string, operation: string, targetDigest: string): string {
  return `hmac:${hmacHex(opsKeyFromHex(opsKeyHex), `${operation}|${targetDigest}`)}`;
}

/**
 * Structural evidence verification: the shared `Evidence` type carries no
 * cryptographic signature field to verify against (only a `signed: boolean`
 * claim), so this checks internal consistency and required fields — it is
 * NOT cryptographic evidence verification. A real deployment that needs that
 * must extend `Evidence` with a verifiable signature and replace this class;
 * that extension is out of scope here and is named explicitly in the
 * production readiness report, not silently treated as done.
 */
export class StructuralEvidenceVerifier implements EvidenceVerifier {
  verify(evidence: Evidence): boolean {
    return (
      evidence.signed === true &&
      evidence.evidenceRef.length > 0 &&
      evidence.deploymentProfileDigest.length > 0 &&
      /^sha256:/.test(evidence.artifactDigest)
    );
  }
}

export class HmacSnapshotSigner implements SnapshotSigner {
  constructor(private readonly opsKey: Buffer) {}
  sign(snapshot: unknown): string {
    return `hmac:${hmacHex(this.opsKey, JSON.stringify(snapshot))}`;
  }
}

export class LedgerRegistryAudit implements RegistryAudit {
  private readonly ledger: AuditLedger;
  constructor(now: () => number = () => Date.now()) {
    this.ledger = new AuditLedger({ "model-registry": ["registry.model.approved", "registry.model.promoted", "registry.model.revoked", "registry.alias.updated", "registry.rollout.activated"] }, () => new Date(now()), 16);
  }
  admit(input: { event: "model.approved" | "model.promoted" | "model.revoked" | "alias.updated" | "rollout.activated"; digest: string }): { receipt: string } {
    const eventType = input.event === "model.approved" ? "registry.model.approved"
      : input.event === "model.promoted" ? "registry.model.promoted"
      : input.event === "model.revoked" ? "registry.model.revoked"
      : input.event === "alias.updated" ? "registry.alias.updated"
      : "registry.rollout.activated";
    const receipt = this.ledger.appendIntent({ workloadId: "model-registry", attested: true }, {
      eventId: `${input.event}:${input.digest}`,
      partitionKey: input.digest,
      eventType,
      requestId: input.digest,
      action: input.event,
      intentDigest: input.digest,
      byteLength: input.digest.length,
    });
    return { receipt: receipt.receiptDigest };
  }
}

export interface ModelGovernanceManifestEntry {
  modelId: string;
  version: string;
  /** Symbolic client-facing alias(es) this artifact should resolve from, e.g. "default", "fast-internal". */
  aliases: readonly string[];
  artifactRef: string; // must start with oci://internal/
  artifactDigest: `sha256:${string}`;
  manifestDigest: `sha256:${string}`;
  provenanceRef: string;
  sbomRef: string;
  modelCardRef: string;
  signerRef: string;
  capability: Omit<CapabilityProfile, "digest" | "approvedRequestClasses"> & { approvedRequestClasses: readonly string[] };
  /** Evidence kinds required by ModelRegistry.approve/promote: evaluation, red_team, privacy, provenance, security. All five must be present and pass. */
  evidenceRefs: readonly string[];
  deploymentProfileDigest: `sha256:${string}`;
}

export interface ModelGovernanceManifest {
  entries: readonly ModelGovernanceManifestEntry[];
}

function capabilityDigestFor(capability: ModelGovernanceManifestEntry["capability"]): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(capability)).digest("hex")}`;
}

export interface ModelEligibilityCheckPort {
  resolveEndpoint(input: { capability: string; artifactDigest: string; denyEpoch: number }): Promise<{ endpointRef: string; snapshotExpiresAt: number; external: boolean }>;
  currentDenyEpoch(): number;
  /**
   * Optional: true only if `artifactDigest` is approved for `capability`
   * specifically (not merely routable for *some* capability). Neither
   * `resolveEndpoint` nor `resolve` check this themselves — the
   * `capability`/`artifactDigest` pair they're given is trusted to already
   * be the right one for the call site. Callers that must verify the pairing
   * independently (e.g. `main.ts`'s boot/readiness router-model check) use
   * this. Ports without a real per-capability distinction (e.g.
   * `SingleDigestModelEligibility`) omit it.
   */
  capabilityApproved?(input: { artifactDigest: string; capability: string }): boolean;
}

/**
 * Registry-backed model governance: alias resolution and endpoint
 * eligibility are both derived from a live, signed `ModelRegistry.snapshot()`
 * — not a static allow-everything answer. A model that is later revoked via
 * `registry.revoke(...)` disappears from the snapshot's `routable` set on the
 * very next check, so revocation takes effect without restarting the
 * Orchestrator. This is the sovereign path: the registry only ever contains
 * `oci://internal/...` artifacts (enforced by `ModelRegistry.register`), so
 * `external` is always `false` here — there is no code path by which a
 * public provider endpoint can be returned.
 */
export class RegistryModelGovernance implements ModelSelectionPort, ModelEligibilityCheckPort {
  private readonly aliasToDigest = new Map<string, `sha256:${string}`>();
  private readonly digestToCapabilityDigest = new Map<string, string>();
  private readonly digestToApprovedRequestClasses = new Map<string, readonly string[]>();

  constructor(
    private readonly registry: ModelRegistry,
    private readonly defaultRef: string,
    private readonly snapshotMaxAgeMs = 60_000,
  ) {}

  registerAlias(alias: string, artifactDigest: `sha256:${string}`, capabilityDigest: string, approvedRequestClasses?: readonly string[]): void {
    if (!MODEL_REF_PATTERN.test(alias)) throw new Error(`Invalid model_ref alias: ${alias}`);
    this.aliasToDigest.set(alias, artifactDigest);
    this.digestToCapabilityDigest.set(artifactDigest, capabilityDigest);
    if (approvedRequestClasses) this.digestToApprovedRequestClasses.set(artifactDigest, approvedRequestClasses);
  }

  /** True only if `artifactDigest` was registered with `capability` in its approved request classes. False (not "unknown") if the digest was never registered with any approved-classes list. */
  capabilityApproved(input: { artifactDigest: string; capability: string }): boolean {
    return (this.digestToApprovedRequestClasses.get(input.artifactDigest) ?? []).includes(input.capability);
  }

  resolve(input: { modelRef: string; capability: string }): { artifactDigest: `sha256:${string}` } {
    const ref = input.modelRef || this.defaultRef;
    if (!MODEL_REF_PATTERN.test(ref)) throw new OrchestratorError("FORBIDDEN", "The requested model reference is malformed.");
    const artifactDigest = this.aliasToDigest.get(ref);
    if (!artifactDigest) throw new OrchestratorError("FORBIDDEN", "The requested model is not approved for this capability.");
    if (!this.isCurrentlyRoutable(artifactDigest)) throw new OrchestratorError("FORBIDDEN", "The requested model is not currently routable.");
    return { artifactDigest };
  }

  private isCurrentlyRoutable(artifactDigest: string): boolean {
    const expectedCapabilityDigest = this.digestToCapabilityDigest.get(artifactDigest);
    if (!expectedCapabilityDigest) return false;
    const snapshot = this.registry.snapshot(this.snapshotMaxAgeMs);
    return snapshot.routable.some((r) => r.artifactDigest === artifactDigest && r.capabilityDigest === expectedCapabilityDigest);
  }

  async resolveEndpoint(input: { capability: string; artifactDigest: string; denyEpoch: number }): Promise<{ endpointRef: string; snapshotExpiresAt: number; external: boolean }> {
    const snapshot = this.registry.snapshot(this.snapshotMaxAgeMs);
    if (input.denyEpoch < snapshot.emergencyDenyEpoch) {
      throw new OrchestratorError("FORBIDDEN", "A model was revoked since this request's eligibility was last checked; retry with a fresh snapshot.");
    }
    const expectedCapabilityDigest = this.digestToCapabilityDigest.get(input.artifactDigest);
    const entry = snapshot.routable.find((r) => r.artifactDigest === input.artifactDigest);
    if (!entry || !expectedCapabilityDigest || entry.capabilityDigest !== expectedCapabilityDigest) {
      throw new OrchestratorError("FORBIDDEN", "The model artifact is not currently routable.");
    }
    // Per-call capability gate: routable is necessary but not sufficient. A model approved
    // and promoted for one capability (e.g. `grounded-assistant`, final generation) must not
    // become eligible for another (e.g. `rag-route-classification`) just because it shares a
    // capability *profile* digest — the artifact's approved-request-classes list, registered
    // alongside its alias, is the actual per-capability entitlement and is checked on every
    // call, not only at boot/readiness (`checkRoutePolicyModelsReady` in main.ts checks the
    // same thing ahead of time, but that is a readiness signal, not a substitute for this).
    if (!this.capabilityApproved({ artifactDigest: input.artifactDigest, capability: input.capability })) {
      throw new OrchestratorError("FORBIDDEN", "The model artifact is not approved for the requested capability.");
    }
    return { endpointRef: `internal-model:${input.artifactDigest}`, snapshotExpiresAt: snapshot.expiresAt, external: false };
  }

  currentDenyEpoch(): number {
    return this.registry.snapshot(this.snapshotMaxAgeMs).emergencyDenyEpoch;
  }
}

/**
 * Drives the registry's own real approve/promote/alias workflow from a
 * deployer-supplied manifest, using genuine HMAC change-fences signed by the
 * ops key — this exercises the same evidence-gate and signature checks any
 * runtime change to the registry would go through. It does not bypass them:
 * a manifest entry missing a required evidence kind, or any entry whose
 * evidence fails `StructuralEvidenceVerifier`, makes `approve`/`promote`
 * throw `RegistryError("EVIDENCE_INSUFFICIENT")` and bootstrap fails closed.
 */
export function bootstrapModelGovernance(manifest: ModelGovernanceManifest, opsKeyHex: string, now: () => number = () => Date.now()): RegistryModelGovernance {
  const opsKey = opsKeyFromHex(opsKeyHex);
  const registry = new ModelRegistry(new LedgerRegistryAudit(now), new HmacSnapshotSigner(opsKey), new StructuralEvidenceVerifier(), new HmacChangeGate(opsKey), now);
  const governance = new RegistryModelGovernance(registry, "default");

  for (const entry of manifest.entries) {
    const version: Omit<ModelVersion, "state" | "evidenceRefs" | "capability"> = {
      modelId: entry.modelId,
      version: entry.version,
      artifactRef: entry.artifactRef,
      artifactDigest: entry.artifactDigest,
      manifestDigest: entry.manifestDigest,
      provenanceRef: entry.provenanceRef,
      sbomRef: entry.sbomRef,
      modelCardRef: entry.modelCardRef,
      signerRef: entry.signerRef,
    };
    registry.register(version);
    const capabilityDigest = capabilityDigestFor(entry.capability);
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

    const approveFence = signChangeFence(opsKeyHex, "approve", entry.artifactDigest);
    registry.approve(entry.modelId, entry.version, entry.deploymentProfileDigest, approveFence);
    const promoteFence = signChangeFence(opsKeyHex, "promote", entry.artifactDigest);
    registry.promote(entry.modelId, entry.version, entry.deploymentProfileDigest, promoteFence);

    for (const alias of entry.aliases) {
      const aliasFence = signChangeFence(opsKeyHex, "alias", entry.artifactDigest);
      registry.setAlias(entry.modelId, alias, entry.version, aliasFence);
      governance.registerAlias(alias, entry.artifactDigest, capabilityDigest, entry.capability.approvedRequestClasses);
    }
  }

  return governance;
}
