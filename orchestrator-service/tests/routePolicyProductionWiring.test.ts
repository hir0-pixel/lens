import { randomBytes, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadRoutePolicy, checkRoutePolicyModelsReady, reloadRoutePolicyFromDisk, type OrchestratorServiceEnv } from "../src/main";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { ModelRegistry } from "../../services/model-registry/ModelRegistry";
import {
  RoutePolicyError,
  SignedRoutePolicyManifestPort,
  signRoutePolicyManifest,
  HmacRoutePolicyManifestSigner,
  Ed25519RoutePolicyManifestVerifier,
  signRoutePolicyManifestEd25519,
  type RoutePolicyManifest,
} from "../src/groundingPolicy";
import { generateKeyPairSync } from "node:crypto";
import {
  ProductionOrchestratorService,
  type AuditAdmissionPort,
  type DisclosureReservationPort,
  type GenerationContextFencePort,
  type OutputBlobStorePort,
  type OutputGuardPort,
  type ResultAuthorizationPort,
  type RetrievalPort,
  type TurnStatePort,
} from "../src/service";
import type { OrchestratorChatRequest } from "../src/http";
import type { RetrievalRequest, RetrievalResult, RetrievedContext } from "../../libs/rag-contracts";
import { InMemoryConversationHistory, type ConversationHistoryPort } from "../src/conversationHistory";

const NOW = 1_700_000_000_000;
const OPS_KEY = randomBytes(32).toString("hex");

function manifest(overrides: Partial<RoutePolicyManifest["entries"][number]> = {}, manifestRevision = 1): RoutePolicyManifest {
  return {
    manifestRevision,
    entries: [
      {
        applicationRef: "lens-employee-client",
        workspaceRef: "default-workspace",
        purposeRef: "assistant",
        requestClass: "enterprise-grounded",
        routePolicyRevision: 3,
        groundingRequired: true,
        routerModelRef: "router-default",
        allowedProfileSelectors: ["default"],
        defaultProfileSelector: "default",
        noDefaultSelectorBehavior: "CLARIFY",
        clarificationText: "Could you say more about what you'd like to know?",
        // SignedRoutePolicyManifestPort checks expiry against the REAL wall
        // clock (it has no injectable `now`), unlike the rest of this
        // package's fake-port tests — base this off Date.now(), not the
        // fixed NOW fixture used elsewhere in this file.
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
        ...overrides,
      },
    ],
  };
}

function envFrom(json: string, signature: string, opsKey: string): OrchestratorServiceEnv {
  return {
    PORT: "8789",
    HOST: "127.0.0.1",
    ORCHESTRATOR_WORKLOAD_TOKEN: "x".repeat(40),
    RETRIEVAL_URL: "https://retrieval.internal",
    RETRIEVAL_WORKLOAD_TOKEN: "x".repeat(40),
    MODEL_RUNTIME_URL: "https://runtime.internal",
    MODEL_RUNTIME_WORKLOAD_TOKEN: "x".repeat(40),
    MODEL_ARTIFACT_DIGEST: `sha256:${"a".repeat(64)}`,
    AUTHORITY_URL: "https://authority.internal",
    AUTHORITY_WORKLOAD_TOKEN: "x".repeat(40),
    ROUTE_POLICY_MANIFEST_JSON: json,
    ROUTE_POLICY_MANIFEST_SIGNATURE: signature,
    ROUTE_POLICY_OPS_KEY: opsKey,
  };
}

describe("production route-policy wiring (main.ts's loadRoutePolicy)", () => {
  it("production cannot start without a route-policy authority — missing manifest/signature/ops-key throws", () => {
    expect(() => loadRoutePolicy({
      PORT: "8789", HOST: "127.0.0.1",
      ORCHESTRATOR_WORKLOAD_TOKEN: "x".repeat(40),
      RETRIEVAL_URL: "https://retrieval.internal", RETRIEVAL_WORKLOAD_TOKEN: "x".repeat(40),
      MODEL_RUNTIME_URL: "https://runtime.internal", MODEL_RUNTIME_WORKLOAD_TOKEN: "x".repeat(40),
      MODEL_ARTIFACT_DIGEST: `sha256:${"a".repeat(64)}`,
      AUTHORITY_URL: "https://authority.internal", AUTHORITY_WORKLOAD_TOKEN: "x".repeat(40),
      // No ROUTE_POLICY_* fields set at all.
    })).toThrow(/ROUTE_POLICY_MANIFEST_JSON/);
  });

  it("a forged/wrong-key signature fails closed — never silently trusted", () => {
    const m = manifest();
    const wrongKey = randomBytes(32).toString("hex");
    const validSignature = signRoutePolicyManifest(OPS_KEY, m);
    // Verifying with a DIFFERENT key than the one that signed it must fail.
    expect(() => loadRoutePolicy(envFrom(JSON.stringify(m), validSignature, wrongKey))).toThrow();
  });

  it("a same-key content tamper fails closed — the signature must cover the manifest's actual content, not just its shape", () => {
    const original = manifest();
    const signature = signRoutePolicyManifest(OPS_KEY, original);
    // Same key, same signature — but the entry actually deployed differs
    // from the one that was signed (grounding flipped, router swapped).
    // `HmacRoutePolicyManifestSigner` re-signs whatever manifest object it
    // is given, so this only proves anything if `loadRoutePolicy`/
    // `SignedRoutePolicyManifestPort` verify against the SAME manifest that
    // was signed rather than trusting the caller's claim.
    const tampered: RoutePolicyManifest = {
      manifestRevision: original.manifestRevision,
      entries: [{ ...original.entries[0]!, groundingRequired: false, routerModelRef: "attacker-controlled-router" }],
    };
    expect(() => loadRoutePolicy(envFrom(JSON.stringify(tampered), signature, OPS_KEY))).toThrow();
  });

  it("a real signed manifest loads and resolves the exact scope it defines", async () => {
    const m = manifest();
    const signature = signRoutePolicyManifest(OPS_KEY, m);
    const port = loadRoutePolicy(envFrom(JSON.stringify(m), signature, OPS_KEY));
    const result = await port.resolve({
      requestId: "req-1", subjectRef: "subject-1",
      applicationRef: "lens-employee-client", workspaceRef: "default-workspace",
      purposeRef: "assistant", requestClass: "enterprise-grounded",
    }, new AbortController().signal);
    expect(result.groundingRequired).toBe(true);
    expect(result.routePolicyRevision).toBe(3);
    expect(result.allowedProfileSelectors).toEqual(["default"]);
  });

  it("policy expiry denies even with a valid signature", async () => {
    const m = manifest({ expiresAt: NOW - 1_000 });
    const signature = signRoutePolicyManifest(OPS_KEY, m);
    const port = new SignedRoutePolicyManifestPort(m, signature, new HmacRoutePolicyManifestSigner(Buffer.from(OPS_KEY, "hex")));
    await expect(port.resolve({
      requestId: "req-1", subjectRef: "subject-1",
      applicationRef: "lens-employee-client", workspaceRef: "default-workspace",
      purposeRef: "assistant", requestClass: "enterprise-grounded",
    }, new AbortController().signal)).rejects.toMatchObject({ code: "POLICY_EXPIRED" });
  });

  it("readiness degrades once every manifest entry has expired", () => {
    const m = manifest({ expiresAt: NOW - 1_000 });
    const signature = signRoutePolicyManifest(OPS_KEY, m);
    const port = new SignedRoutePolicyManifestPort(m, signature, new HmacRoutePolicyManifestSigner(Buffer.from(OPS_KEY, "hex")));
    expect(port.hasLiveEntries(NOW)).toBe(false);
  });

  it("no scope match fails closed with POLICY_NOT_FOUND, never a default policy", async () => {
    const m = manifest();
    const signature = signRoutePolicyManifest(OPS_KEY, m);
    const port = loadRoutePolicy(envFrom(JSON.stringify(m), signature, OPS_KEY));
    await expect(port.resolve({
      requestId: "req-1", subjectRef: "subject-1",
      applicationRef: "lens-employee-client", workspaceRef: "some-other-workspace",
      purposeRef: "assistant", requestClass: "enterprise-grounded",
    }, new AbortController().signal)).rejects.toMatchObject({ code: "POLICY_NOT_FOUND" });
  });
});

describe("item 7: bounded hot-reload — asymmetric verification, rollback/duplicate/expiry/invalid-signature rejection", () => {
  it("Ed25519RoutePolicyManifestVerifier holds only a public key and still rejects a forged signature", () => {
    const keys = generateKeyPairSync("ed25519");
    const m = manifest();
    const forged = signRoutePolicyManifestEd25519(generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString(), m);
    const verifier = new Ed25519RoutePolicyManifestVerifier(keys.publicKey);
    expect(verifier.verify(m, forged)).toBe(false);
  });

  it("Ed25519: a real signature from the matching private key verifies, and construction/resolve succeed exactly like the HMAC path", async () => {
    const keys = generateKeyPairSync("ed25519");
    const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const m = manifest();
    const signature = signRoutePolicyManifestEd25519(privateKeyPem, m);
    const port = new SignedRoutePolicyManifestPort(m, signature, new Ed25519RoutePolicyManifestVerifier(keys.publicKey));
    const result = await port.resolve({
      requestId: "req-1", subjectRef: "subject-1",
      applicationRef: "lens-employee-client", workspaceRef: "default-workspace",
      purposeRef: "assistant", requestClass: "enterprise-grounded",
    }, new AbortController().signal);
    expect(result.groundingRequired).toBe(true);
  });

  it("reload() with a strictly greater manifestRevision and a valid signature replaces the live manifest", async () => {
    const m1 = manifest({ groundingRequired: true }, 1);
    const sig1 = signRoutePolicyManifest(OPS_KEY, m1);
    const port = new SignedRoutePolicyManifestPort(m1, sig1, new HmacRoutePolicyManifestSigner(Buffer.from(OPS_KEY, "hex")));
    expect(port.currentManifestRevision()).toBe(1);

    const m2 = manifest({ groundingRequired: false }, 2);
    const sig2 = signRoutePolicyManifest(OPS_KEY, m2);
    port.reload(m2, sig2);
    expect(port.currentManifestRevision()).toBe(2);

    const resolved = await port.resolve({
      requestId: "req-1", subjectRef: "subject-1",
      applicationRef: "lens-employee-client", workspaceRef: "default-workspace",
      purposeRef: "assistant", requestClass: "enterprise-grounded",
    }, new AbortController().signal);
    expect(resolved.groundingRequired).toBe(false);
  });

  it("reload() rejects a duplicate revision (replay) — the live manifest is left untouched", async () => {
    const m1 = manifest({ groundingRequired: true }, 5);
    const sig1 = signRoutePolicyManifest(OPS_KEY, m1);
    const port = new SignedRoutePolicyManifestPort(m1, sig1, new HmacRoutePolicyManifestSigner(Buffer.from(OPS_KEY, "hex")));

    const replay = manifest({ groundingRequired: false }, 5);
    const replaySig = signRoutePolicyManifest(OPS_KEY, replay);
    expect(() => port.reload(replay, replaySig)).toThrow(RoutePolicyError);
    try {
      port.reload(replay, replaySig);
    } catch (error) {
      expect((error as RoutePolicyError).code).toBe("POLICY_ROLLBACK_REJECTED");
    }
    expect(port.currentManifestRevision()).toBe(5);
  });

  it("reload() rejects an outright rollback (lower revision) — the live manifest is left untouched", async () => {
    const m1 = manifest({ groundingRequired: true }, 5);
    const sig1 = signRoutePolicyManifest(OPS_KEY, m1);
    const port = new SignedRoutePolicyManifestPort(m1, sig1, new HmacRoutePolicyManifestSigner(Buffer.from(OPS_KEY, "hex")));

    const rollback = manifest({ groundingRequired: false }, 3);
    const rollbackSig = signRoutePolicyManifest(OPS_KEY, rollback);
    expect(() => port.reload(rollback, rollbackSig)).toThrow(RoutePolicyError);
    expect(port.currentManifestRevision()).toBe(5);

    const resolved = await port.resolve({
      requestId: "req-1", subjectRef: "subject-1",
      applicationRef: "lens-employee-client", workspaceRef: "default-workspace",
      purposeRef: "assistant", requestClass: "enterprise-grounded",
    }, new AbortController().signal);
    expect(resolved.groundingRequired).toBe(true); // unchanged
  });

  it("reload() rejects an invalid signature — the live manifest is left untouched", () => {
    const m1 = manifest({}, 1);
    const sig1 = signRoutePolicyManifest(OPS_KEY, m1);
    const port = new SignedRoutePolicyManifestPort(m1, sig1, new HmacRoutePolicyManifestSigner(Buffer.from(OPS_KEY, "hex")));

    const m2 = manifest({}, 2);
    const wrongKey = randomBytes(32).toString("hex");
    const forgedSig = signRoutePolicyManifest(wrongKey, m2);
    expect(() => port.reload(m2, forgedSig)).toThrow(RoutePolicyError);
    expect(port.currentManifestRevision()).toBe(1);
  });

  it("reload() rejects a manifest with no live (unexpired) entries — the live manifest is left untouched", () => {
    const m1 = manifest({}, 1);
    const sig1 = signRoutePolicyManifest(OPS_KEY, m1);
    const port = new SignedRoutePolicyManifestPort(m1, sig1, new HmacRoutePolicyManifestSigner(Buffer.from(OPS_KEY, "hex")));

    const expired = manifest({ expiresAt: Date.now() - 1_000 }, 2);
    const expiredSig = signRoutePolicyManifest(OPS_KEY, expired);
    expect(() => port.reload(expired, expiredSig)).toThrow(RoutePolicyError);
    expect(port.currentManifestRevision()).toBe(1);
  });

  it("reloadRoutePolicyFromDisk (main.ts, SIGHUP-triggered) reads the manifest/signature file pair and applies a valid advancing revision", () => {
    const dir = mkdtempSync(join(tmpdir(), "route-policy-reload-"));
    try {
      const m1 = manifest({ groundingRequired: true }, 1);
      const sig1 = signRoutePolicyManifest(OPS_KEY, m1);
      const routePolicy = new SignedRoutePolicyManifestPort(m1, sig1, new HmacRoutePolicyManifestSigner(Buffer.from(OPS_KEY, "hex")));

      const manifestPath = join(dir, "manifest.json");
      const signaturePath = join(dir, "manifest.sig");
      const m2 = manifest({ groundingRequired: false }, 2);
      const sig2 = signRoutePolicyManifest(OPS_KEY, m2);
      writeFileSync(manifestPath, JSON.stringify(m2), "utf8");
      writeFileSync(signaturePath, sig2, "utf8");

      const env: OrchestratorServiceEnv = envFrom(JSON.stringify(m1), sig1, OPS_KEY);
      env.ROUTE_POLICY_MANIFEST_PATH = manifestPath;
      env.ROUTE_POLICY_SIGNATURE_PATH = signaturePath;
      const quietLogger = { error: () => {}, info: () => {} };
      reloadRoutePolicyFromDisk(env, routePolicy, quietLogger);

      expect(routePolicy.currentManifestRevision()).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reloadRoutePolicyFromDisk is a no-op (never throws) when the on-disk file pair fails verification/rollback checks — the live manifest keeps serving", () => {
    const dir = mkdtempSync(join(tmpdir(), "route-policy-reload-bad-"));
    try {
      const m1 = manifest({ groundingRequired: true }, 5);
      const sig1 = signRoutePolicyManifest(OPS_KEY, m1);
      const routePolicy = new SignedRoutePolicyManifestPort(m1, sig1, new HmacRoutePolicyManifestSigner(Buffer.from(OPS_KEY, "hex")));

      const manifestPath = join(dir, "manifest.json");
      const signaturePath = join(dir, "manifest.sig");
      const rollback = manifest({ groundingRequired: false }, 2); // lower revision — rollback
      const rollbackSig = signRoutePolicyManifest(OPS_KEY, rollback);
      writeFileSync(manifestPath, JSON.stringify(rollback), "utf8");
      writeFileSync(signaturePath, rollbackSig, "utf8");

      const env: OrchestratorServiceEnv = envFrom(JSON.stringify(m1), sig1, OPS_KEY);
      env.ROUTE_POLICY_MANIFEST_PATH = manifestPath;
      env.ROUTE_POLICY_SIGNATURE_PATH = signaturePath;
      const quietLogger = { error: () => {}, info: () => {} };
      expect(() => reloadRoutePolicyFromDisk(env, routePolicy, quietLogger)).not.toThrow();

      expect(routePolicy.currentManifestRevision()).toBe(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reloadRoutePolicyFromDisk is inert when ROUTE_POLICY_MANIFEST_PATH/SIGNATURE_PATH are not configured (opt-in only)", () => {
    const m1 = manifest({}, 1);
    const sig1 = signRoutePolicyManifest(OPS_KEY, m1);
    const routePolicy = new SignedRoutePolicyManifestPort(m1, sig1, new HmacRoutePolicyManifestSigner(Buffer.from(OPS_KEY, "hex")));
    const env = envFrom(JSON.stringify(m1), sig1, OPS_KEY);
    expect(() => reloadRoutePolicyFromDisk(env, routePolicy)).not.toThrow();
    expect(routePolicy.currentManifestRevision()).toBe(1);
  });
});

describe("item 6: startup/readiness router_model_ref Registry validation (main.ts's checkRoutePolicyModelsReady)", () => {
  function governanceManifest(overrides: Partial<ModelGovernanceManifestEntry> = {}): ModelGovernanceManifest {
    return {
      entries: [{
        modelId: "lens-router",
        version: "1.0.0",
        aliases: ["router-default"],
        artifactRef: "oci://internal/lens-router@1.0.0",
        artifactDigest: `sha256:${"9".repeat(64)}`,
        manifestDigest: `sha256:${"8".repeat(64)}`,
        provenanceRef: "provenance:router",
        sbomRef: "sbom:router",
        modelCardRef: "card:router",
        signerRef: "signer:router",
        capability: {
          contextWindow: 8192,
          supportsToolCalling: false,
          supportsVision: false,
          supportsEmbeddings: false,
          runtimeFamily: "internal-llm",
          quantization: "fp16",
          measuredThroughputEvidenceRef: "throughput:router",
          approvedRequestClasses: ["rag-route-classification"],
        },
        evidenceRefs: [],
        deploymentProfileDigest: `sha256:${"7".repeat(64)}`,
        ...overrides,
      }],
    };
  }

  it("boot fails when a live scope's router_model_ref does not resolve to any registered alias", async () => {
    const governance = bootstrapModelGovernance(governanceManifest(), OPS_KEY, () => Date.now());
    const m = manifest({ routerModelRef: "router-that-was-never-registered" });
    const signature = signRoutePolicyManifest(OPS_KEY, m);
    const port = loadRoutePolicy(envFrom(JSON.stringify(m), signature, OPS_KEY));
    const result = await checkRoutePolicyModelsReady(port, governance, governance);
    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.offending).toContain("router-that-was-never-registered");
  });

  it("boot succeeds when every live scope's router_model_ref resolves and is eligible", async () => {
    const governance = bootstrapModelGovernance(governanceManifest(), OPS_KEY, () => Date.now());
    const m = manifest({ routerModelRef: "router-default" });
    const signature = signRoutePolicyManifest(OPS_KEY, m);
    const port = loadRoutePolicy(envFrom(JSON.stringify(m), signature, OPS_KEY));
    const result = await checkRoutePolicyModelsReady(port, governance, governance);
    expect(result.ready).toBe(true);
  });

  it("boot fails when the resolved router_model_ref is routable but NOT approved for rag-route-classification specifically", async () => {
    // Approved only for final generation — a real registry entry that IS
    // resolvable/routable, but for the wrong capability. Proves the boot
    // check does not accept "routable for something" as a stand-in for
    // "approved for rag-route-classification".
    const governance = bootstrapModelGovernance(governanceManifest({ capability: { contextWindow: 8192, supportsToolCalling: false, supportsVision: false, supportsEmbeddings: false, runtimeFamily: "internal-llm", quantization: "fp16", measuredThroughputEvidenceRef: "throughput:router", approvedRequestClasses: ["grounded-assistant"] } }), OPS_KEY, () => Date.now());
    const m = manifest({ routerModelRef: "router-default" });
    const signature = signRoutePolicyManifest(OPS_KEY, m);
    const port = loadRoutePolicy(envFrom(JSON.stringify(m), signature, OPS_KEY));
    const result = await checkRoutePolicyModelsReady(port, governance, governance);
    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.offending).toContain("router-default");
  });

  it("readiness degrades (without a restart) once a live scope's router_model_ref is revoked", async () => {
    // Build the registry directly (mirroring bootstrapModelGovernance's own
    // logic) so this test can independently call the registry's real
    // revoke() with a validly-signed change-fence, proving revocation is
    // enforced by the registry itself, not something the test fabricates.
    const opsKeyBuf = Buffer.from(OPS_KEY, "hex");
    const registry = new ModelRegistry(new LedgerRegistryAudit(() => Date.now()), new HmacSnapshotSigner(opsKeyBuf), new StructuralEvidenceVerifier(), new HmacChangeGate(opsKeyBuf), () => Date.now());
    const entry = governanceManifest().entries[0]!;
    registry.register({ modelId: entry.modelId, version: entry.version, artifactRef: entry.artifactRef, artifactDigest: entry.artifactDigest, manifestDigest: entry.manifestDigest, provenanceRef: entry.provenanceRef, sbomRef: entry.sbomRef, modelCardRef: entry.modelCardRef, signerRef: entry.signerRef });
    const capabilityDigest = `sha256:${createHash("sha256").update(JSON.stringify(entry.capability)).digest("hex")}`;
    registry.attachCapability(entry.modelId, entry.version, { ...entry.capability, digest: capabilityDigest });
    for (const kind of ["evaluation", "red_team", "privacy", "provenance", "security"] as const) {
      registry.ingestEvidence({ evidenceRef: `${entry.artifactDigest}:${kind}`, artifactDigest: entry.artifactDigest, kind, signed: true, passed: true, criticalFailure: false, deploymentProfileDigest: entry.deploymentProfileDigest });
    }
    registry.approve(entry.modelId, entry.version, entry.deploymentProfileDigest, signChangeFence(OPS_KEY, "approve", entry.artifactDigest));
    registry.promote(entry.modelId, entry.version, entry.deploymentProfileDigest, signChangeFence(OPS_KEY, "promote", entry.artifactDigest));
    registry.setAlias(entry.modelId, "router-default", entry.version, signChangeFence(OPS_KEY, "alias", entry.artifactDigest));
    const governance = new RegistryModelGovernance(registry, "default");
    governance.registerAlias("router-default", entry.artifactDigest, capabilityDigest, entry.capability.approvedRequestClasses);

    const m = manifest({ routerModelRef: "router-default" });
    const signature = signRoutePolicyManifest(OPS_KEY, m);
    const port = loadRoutePolicy(envFrom(JSON.stringify(m), signature, OPS_KEY));
    expect((await checkRoutePolicyModelsReady(port, governance, governance)).ready).toBe(true);

    registry.revoke(entry.modelId, entry.version, signChangeFence(OPS_KEY, "revoke", entry.artifactDigest));
    const afterRevoke = await checkRoutePolicyModelsReady(port, governance, governance);
    expect(afterRevoke.ready).toBe(false);
  });

  it("an expired scope's router_model_ref is not enumerated — only LIVE scopes must resolve", async () => {
    const governance = bootstrapModelGovernance(governanceManifest(), OPS_KEY, () => Date.now());
    const m = manifest({ routerModelRef: "a-router-that-does-not-exist", expiresAt: Date.now() - 1_000 });
    const signature = signRoutePolicyManifest(OPS_KEY, m);
    const port = new SignedRoutePolicyManifestPort(m, signature, new HmacRoutePolicyManifestSigner(Buffer.from(OPS_KEY, "hex")));
    const result = await checkRoutePolicyModelsReady(port, governance, governance);
    expect(result.ready).toBe(true);
  });
});

// --- End-to-end proofs against the real ProductionOrchestratorService,
// driven by a real signed manifest (not a DevRoutePolicyPort double) ---

function request(overrides: Partial<OrchestratorChatRequest> = {}): OrchestratorChatRequest {
  return {
    requestId: "req-e2e",
    turnId: "turn-e2e",
    subjectRef: "subject-1",
    sessionRef: "session-1",
    conversationRef: "conversation-1",
    deviceRef: "device-1",
    applicationId: "lens-employee-client",
    purposeRef: "assistant",
    retrievalClass: "enterprise-grounded",
    workspaceRef: "default-workspace",
    capability: "grounded-assistant",
    inputText: "",
    queryDigest: `sha256:${"a".repeat(64)}`,
    deadlineAt: NOW + 30_000,
    retryBudget: 0,
    bulkhead: "interactive",
    delegatedSessionAssertion: "test-delegated-session-assertion",
    ...overrides,
  };
}

function source(overrides: Partial<RetrievedContext> = {}): RetrievedContext {
  return {
    document_version_ref: "leave_policy.docx",
    chunk_ref: "chunk-1",
    content_digest: `sha256:${"b".repeat(64)}`,
    citation_anchor: "Section 1",
    classification_ref: "internal",
    text: "Employees get 20 days of leave per year.",
    ...overrides,
  };
}

function retrievalResult(req: RetrievalRequest): RetrievalResult {
  const retrieved = source();
  return {
    status: "context",
    retrieval_id: `retrieval-${req.request_id}`,
    request_id: req.request_id,
    turn_id: req.turn_id,
    visibility_sequence: 1,
    index_generation: "index:1",
    context_digest: `sha256:${"c".repeat(64)}`,
    manifest: {
      digest: `sha256:${"c".repeat(64)}`,
      retrieved_at: NOW,
      source_revision_digest: `sha256:${"e".repeat(64)}`,
      operation_decision_ref: "decision:operation",
      candidate_decision_ref: "decision:candidates",
      policy_revision: 1,
      subject_security_revision: 1,
      resource_security_revision_digest: `sha256:${"f".repeat(64)}`,
      expires_at: NOW + 20_000,
      sources: [retrieved],
    },
    sources: [retrieved],
  };
}

class RecordingRetrieval implements RetrievalPort {
  readonly calls: RetrievalRequest[] = [];
  async retrieve(req: RetrievalRequest): Promise<RetrievalResult> {
    this.calls.push(req);
    return retrievalResult(req);
  }
}

function releasePorts(auditCalls: string[] = []): {
  generationContextFence: GenerationContextFencePort;
  auditAdmission: AuditAdmissionPort;
  outputGuards: OutputGuardPort;
  outputStore: OutputBlobStorePort;
  turnState: TurnStatePort;
  disclosure: DisclosureReservationPort;
  resultAuthorization: ResultAuthorizationPort;
} {
  return {
    generationContextFence: {
      async revalidate(input) {
        return { fenceRef: `fence:${input.boundary}`, contextDigest: input.contextDigest, expiresAt: input.manifestExpiresAt, checkedAt: NOW };
      },
    },
    auditAdmission: {
      async admit(input) {
        auditCalls.push(input.kind);
        return { receiptDigest: `audit:${input.kind}:${input.requestId}` };
      },
    },
    outputGuards: {
      async inspect(input) {
        return { allowed: true, derivedClassificationRef: "internal", guardReceipt: `guard:${input.requestId}` };
      },
    },
    outputStore: {
      async putBlob(input) {
        return { outputRef: `output:${input.turnId}`, outputDigest: input.outputDigest, commitProof: `commit:${input.outputDigest}` };
      },
      async verifyBlob() { return true; },
      async repairDanglingOutput() { return "repaired"; },
    },
    turnState: { async commitTerminal() {}, async markFailed() {} },
    disclosure: {
      async reserve(input) {
        return { reservationRef: `disclosure:${input.requestId}`, classificationRef: input.classificationRef };
      },
      async commit() {},
    },
    resultAuthorization: {
      async authorize(input) {
        return { releaseFence: `release:${input.outputRef}`, obligations: ["audit", "no-store"] };
      },
    },
  };
}

function signedPolicy(overrides: Partial<RoutePolicyManifest["entries"][number]> = {}) {
  const m = manifest(overrides);
  const signature = signRoutePolicyManifest(OPS_KEY, m);
  return new SignedRoutePolicyManifestPort(m, signature, new HmacRoutePolicyManifestSigner(Buffer.from(OPS_KEY, "hex")));
}

describe("production route-policy wiring — end-to-end against ProductionOrchestratorService", () => {
  it("policy is resolved before the router is ever invoked", async () => {
    const calls: string[] = [];
    const routePolicy = {
      async resolve(input: Parameters<SignedRoutePolicyManifestPort["resolve"]>[0], signal: AbortSignal) {
        calls.push("policy");
        return signedPolicy().resolve(input, signal);
      },
    };
    const turnRouter = {
      async classify() {
        calls.push("router");
        return { route: "SINGLE_RETRIEVAL", standalone_query: "What is the leave policy?", profile_selector: "default", reason_code: "x", confidence_bucket: "HIGH" };
      },
    };
    const retrieval = new RecordingRetrieval();
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true, retrieval, now: () => NOW, routePolicy, turnRouter, ...releasePorts() });

    await service.handleChat(request({ inputText: "What is the leave policy?" }), new AbortController().signal);

    expect(calls).toEqual(["policy", "router"]);
  });

  it("policy outage (unreachable/thrown authority) denies the turn before the router ever runs", async () => {
    const routerCalled = { value: false };
    const routePolicy = { async resolve(): Promise<never> { throw new RoutePolicyError("POLICY_UNAVAILABLE"); } };
    const turnRouter = { async classify() { routerCalled.value = true; return undefined; } };
    const retrieval = new RecordingRetrieval();
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true, retrieval, now: () => NOW, routePolicy, turnRouter, ...releasePorts() });

    const response = await service.handleChat(request({ inputText: "What is the leave policy?" }), new AbortController().signal);

    expect(response.status).toBe("FAILED");
    expect(response.error).toBe("POLICY_UNAVAILABLE");
    expect(routerCalled.value).toBe(false);
    expect(retrieval.calls).toHaveLength(0);
  });

  it("a real signed policy with grounding_required=true prevents an ACKNOWLEDGEMENT/NO_RETRIEVAL router result from bypassing retrieval", async () => {
    const retrieval = new RecordingRetrieval();
    const routePolicy = signedPolicy({ groundingRequired: true });
    // "okay" hits the deterministic ACK fast path — a confident NO_RETRIEVAL
    // by another name — and must still be overridden.
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true, retrieval, now: () => NOW, routePolicy, ...releasePorts() });

    const response = await service.handleChat(request({ inputText: "okay" }), new AbortController().signal);

    expect(response.status).toBe("COMPLETED");
    expect(retrieval.calls).toHaveLength(1);
  });

  it("'okay' skips retrieval when the real signed policy permits NO_RETRIEVAL", async () => {
    const retrieval = new RecordingRetrieval();
    const routePolicy = signedPolicy({ groundingRequired: false });
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true, retrieval, now: () => NOW, routePolicy, ...releasePorts() });

    const response = await service.handleChat(request({ inputText: "okay" }), new AbortController().signal);

    expect(response.status).toBe("COMPLETED");
    expect(response.output).toBe("Noted.");
    expect(retrieval.calls).toHaveLength(0);
  });

  it("an enterprise knowledge question retrieves under the real signed policy", async () => {
    const retrieval = new RecordingRetrieval();
    const routePolicy = signedPolicy({ groundingRequired: true });
    const turnRouter = {
      async classify() {
        return { route: "SINGLE_RETRIEVAL", standalone_query: "What is the leave policy?", profile_selector: "default", reason_code: "knowledge_lookup", confidence_bucket: "HIGH" };
      },
    };
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true, retrieval, now: () => NOW, routePolicy, turnRouter, ...releasePorts() });

    const response = await service.handleChat(request({ inputText: "What is the leave policy?" }), new AbortController().signal);

    expect(response.status).toBe("COMPLETED");
    expect(retrieval.calls).toHaveLength(1);
  });

  it("an out-of-set profile_selector from the router fails closed to the policy default, never the unlisted selector", async () => {
    const retrieval = new RecordingRetrieval();
    const routePolicy = signedPolicy({ groundingRequired: true, allowedProfileSelectors: ["default"], defaultProfileSelector: "default" });
    const turnRouter = {
      async classify() {
        return { route: "SINGLE_RETRIEVAL", standalone_query: "What is the leave policy?", profile_selector: "not-in-the-allowed-set", reason_code: "x", confidence_bucket: "HIGH" };
      },
    };
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true, retrieval, now: () => NOW, routePolicy, turnRouter, ...releasePorts() });

    const response = await service.handleChat(request({ inputText: "What is the leave policy?" }), new AbortController().signal);

    expect(response.status).toBe("COMPLETED");
    expect(retrieval.calls).toHaveLength(1);
  });

  it("override provenance reaches the audit ledger (route_override admission) and the finalized turn's terminal lineage — as complete structured fields, never an opaque string", async () => {
    const auditCalls: string[] = [];
    const admitInputs: Parameters<AuditAdmissionPort["admit"]>[0][] = [];
    const history = new InMemoryConversationHistory();
    const finalized: Parameters<ConversationHistoryPort["finalizeTurn"]>[0][] = [];
    const originalFinalize = history.finalizeTurn.bind(history);
    history.finalizeTurn = async (input) => {
      finalized.push(input);
      return originalFinalize(input);
    };
    const ports = releasePorts(auditCalls);
    const originalAdmit = ports.auditAdmission.admit.bind(ports.auditAdmission);
    ports.auditAdmission.admit = async (input, signal) => {
      admitInputs.push(input);
      return originalAdmit(input, signal);
    };
    const retrieval = new RecordingRetrieval();
    const routePolicy = signedPolicy({ groundingRequired: true }); // forces override on "okay"
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true,
      retrieval,
      now: () => NOW,
      routePolicy,
      conversationHistory: history,
      ...ports,
    });

    const response = await service.handleChat(request({ inputText: "okay" }), new AbortController().signal);

    expect(response.status).toBe("COMPLETED");
    expect(auditCalls).toContain("route_override");

    const overrideAdmission = admitInputs.find((input) => input.kind === "route_override");
    expect(overrideAdmission?.routeOverride).toMatchObject({
      attemptedRoute: "NO_RETRIEVAL",
      attemptedReasonCode: "unambiguous_acknowledgement",
      attemptedConfidenceBucket: "HIGH",
      effectiveRoute: "SINGLE_RETRIEVAL",
      effectiveProfileSelector: "default",
      groundingRequired: true,
      routePolicyRevision: 3,
      enforcementOverride: true,
      overrideReason: "grounding_required_violation",
    });
    expect(overrideAdmission?.routeOverride?.routePolicyDigest).toMatch(/^sha256:/);
    expect(overrideAdmission?.routeOverride?.allowedProfileSetDigest).toMatch(/^sha256:/);

    expect(finalized).toHaveLength(1);
    const lineage = finalized[0]!.terminalEvidence;
    expect(lineage.routePolicyRevision).toBe(3);
    expect(lineage.effectiveRoute).toBe("SINGLE_RETRIEVAL");
    expect(lineage.attemptedRoute).toBe("NO_RETRIEVAL");
    expect(lineage.attemptedReasonCode).toBe("unambiguous_acknowledgement");
    expect(lineage.enforcementOverride).toBe(true);
    expect(lineage.overrideReason).toBe("grounding_required_violation");
  });
});
