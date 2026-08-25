import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthorityHttpClient } from "../src/authorityClient";
import { ProductionOrchestratorService, type RetrievalPort } from "../src/service";
import type { OrchestratorChatRequest } from "../src/http";
import type { RetrievalRequest, RetrievalResult, RetrievedContext } from "../../libs/rag-contracts";
import type { RuntimePort } from "../../services/model-gateway/ModelGateway";
// Cross-package import against the real, deployable Authority backend — the
// whole point of this test is to prove the Orchestrator and Authority speak
// the same contract end to end, not just that each side's unit tests agree
// with its own fakes.
import { createAuthorityHttp, type AuthorityHttp } from "../../authority-service/src/http";
import { AuthorityService } from "../../authority-service/src/service";
import { AuthorityStore } from "../../authority-service/src/store";
import { GovernanceAuthority } from "../../services/governance/GovernanceAuthority";
import {
  DevAutoProvisioningResourceFactReader,
  DevAutoProvisioningSubjectDeviceDirectory,
  HmacFenceSigner,
  InMemoryPdpAuditPort,
  PdpBackedContextFencePolicy,
  bootstrapGenerationPdp,
} from "../../authority-service/src/pdpAdapter";
import { randomBytes } from "node:crypto";
import { OutputBlobCrypto } from "../../authority-service/src/outputCrypto";
import { DevRoutePolicyPort } from "../src/groundingPolicy";

/**
 * Wires the real PDP-backed policy against dev auto-provisioning subject/
 * device/resource sources — the whole point of this file is proving the
 * Orchestrator drives the real Authority end to end, including the real
 * revalidate() -> PDP decideBatch/consumeFence path, not a fail-closed
 * stub or a fake that always allows.
 */
function testContextFencePolicy(governance: GovernanceAuthority, now: () => number) {
  const directory = new DevAutoProvisioningSubjectDeviceDirectory();
  const resourceReader = new DevAutoProvisioningResourceFactReader(governance, now);
  const signer = new HmacFenceSigner(randomBytes(32));
  const pdp = bootstrapGenerationPdp({ directory, resourceReader, audit: new InMemoryPdpAuditPort(), signer, now });
  return new PdpBackedContextFencePolicy(pdp, now);
}

// This file exercises the real Authority HTTP client, whose own deadline
// signal is computed from the real wall clock (`Date.now()`), not an
// injectable `now()`. So — unlike the fake-port unit tests elsewhere in this
// package — every timestamp here must be real wall-clock time, or the
// client's own AbortSignal.timeout fires almost immediately against a
// deadline that looks (to Date.now()) like it's already passed.
const WORKLOAD_TOKEN = "authority-workload-token-" + "x".repeat(20);

function request(overrides: Partial<OrchestratorChatRequest> = {}): OrchestratorChatRequest {
  return {
    requestId: "req-authority",
    turnId: "turn-authority",
    subjectRef: "subject-1",
    sessionRef: "session-1",
    conversationRef: "conversation-1",
    deviceRef: "device-1",
    applicationId: "lens-employee-client",
    purposeRef: "assistant",
    retrievalClass: "enterprise-grounded",
    workspaceRef: "default-workspace",
    capability: "grounded-assistant",
    inputText: "What is the remote-work policy?",
    queryDigest: `sha256:${"a".repeat(64)}`,
    deadlineAt: Date.now() + 30_000,
    retryBudget: 0,
    bulkhead: "interactive",
    delegatedSessionAssertion: "test-delegated-session-assertion",
    ...overrides,
  };
}

function source(overrides: Partial<RetrievedContext> = {}): RetrievedContext {
  return {
    document_version_ref: "remote_work_policy.docx",
    chunk_ref: "chunk-1",
    content_digest: `sha256:${"b".repeat(64)}`,
    citation_anchor: "Section 2",
    classification_ref: "internal",
    text: "Remote work requires manager approval.",
    ...overrides,
  };
}

function retrievalResult(overrides: Partial<RetrievalResult> = {}): RetrievalResult {
  const retrieved = source();
  return {
    status: "context",
    retrieval_id: "retrieval-authority",
    request_id: "req-authority",
    turn_id: "turn:req-authority",
    visibility_sequence: 1,
    index_generation: "index:1",
    context_digest: `sha256:${"c".repeat(64)}`,
    manifest: {
      digest: `sha256:${"c".repeat(64)}`,
      retrieved_at: Date.now(),
      source_revision_digest: `sha256:${"e".repeat(64)}`,
      operation_decision_ref: "decision:operation",
      candidate_decision_ref: "decision:candidates",
      policy_revision: 1,
      subject_security_revision: 1,
      resource_security_revision_digest: `sha256:${"f".repeat(64)}`,
      expires_at: Date.now() + 20_000,
      sources: [retrieved],
    },
    sources: [retrieved],
    ...overrides,
  };
}

class StaticRetrieval implements RetrievalPort {
  readonly calls: RetrievalRequest[] = [];
  constructor(private readonly result: RetrievalResult) {}
  async retrieve(req: RetrievalRequest): Promise<RetrievalResult> {
    this.calls.push(req);
    return this.result;
  }
}

const echoRuntime: RuntimePort = {
  async execute(input) {
    return {
      output: input.chunks.join(""),
      receipt: {
        schemaVersion: 1,
        reservationId: input.reservationId,
        requestId: "request-echo",
        turnId: "turn-echo",
        stepId: "step-echo",
        fence: input.fence,
        artifactDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        endpointGeneration: input.endpointGeneration ?? "1",
        usageEventId: `usage:${input.reservationId}`,
        measuredUnits: 1,
        terminal: "completed",
      },
    };
  },
};

describe("ProductionOrchestratorService against the real, deployed authority-service", () => {
  let dir: string;
  let http: AuthorityHttp;
  let store: AuthorityStore;
  let authorityService: AuthorityService;
  let authorityUrl: string;
  let client: AuthorityHttpClient;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "authority-orchestrator-"));
    store = new AuthorityStore(join(dir, "authority.db"));
    const governance = new GovernanceAuthority(() => Date.now());
    const contextFencePolicy = testContextFencePolicy(governance, () => Date.now());
    authorityService = new AuthorityService(store, undefined, () => Date.now(), contextFencePolicy, governance, OutputBlobCrypto.fromHex(randomBytes(32).toString("hex")));
    http = createAuthorityHttp({ workloadToken: WORKLOAD_TOKEN, service: authorityService, isStoreReady: () => true });
    await http.listen(0, "127.0.0.1");
    const address = http.server.address();
    if (!address || typeof address === "string") throw new Error("authority server did not bind");
    authorityUrl = `http://127.0.0.1:${address.port}`;
    client = new AuthorityHttpClient(authorityUrl, WORKLOAD_TOKEN);
  });

  afterEach(async () => {
    await http.close();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("completes a full grounded turn end to end through the real deployed Authority backend, not a fake port", async () => {
    const retrieval = new StaticRetrieval(retrievalResult());
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true,
      retrieval,
      generationContextFence: client,
      auditAdmission: client,
      outputGuards: client,
      outputStore: client,
      turnState: client,
      disclosure: client,
      resultAuthorization: client,
      routePolicy: new DevRoutePolicyPort({ groundingRequired: true, defaultProfileSelector: "default" }),
      runtime: echoRuntime,
    });

    const response = await service.handleChat(request(), new AbortController().signal);

    expect(response.status).toBe("COMPLETED");
    expect(response.output).toContain("Remote work requires manager approval.");

    // Prove it actually landed in the Authority's durable store, not just that
    // the client parsed a response — the same durability guarantee a second
    // Orchestrator replica reading this authority would depend on.
    const commit = await store.getTerminalCommit("req-authority", "turn:req-authority");
    expect(commit).toBeDefined();
    expect(commit?.committed).toBe(1);
  });

  it("item 4: a grounding-required override's structured route_override provenance survives the real HTTP round trip to Authority's durable store — not a bare kind+digest", async () => {
    const retrieval = new StaticRetrieval(retrievalResult());
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true,
      retrieval,
      generationContextFence: client,
      auditAdmission: client,
      outputGuards: client,
      outputStore: client,
      turnState: client,
      disclosure: client,
      resultAuthorization: client,
      // No defaultProfileSelector: undefined here means the fixture already
      // defaults to "default" in groundingPolicy.test.ts's helper — set it
      // explicitly so an ack fast-path override has a selector to fall back to.
      routePolicy: new DevRoutePolicyPort({ groundingRequired: true, defaultProfileSelector: "default", routePolicyRevision: 9 }),
      runtime: echoRuntime,
    });

    // "okay" is the deterministic ack fast path — with groundingRequired
    // true it MUST be overridden to SINGLE_RETRIEVAL, which is exactly the
    // route_override admission this test verifies end to end.
    const response = await service.handleChat(request({ requestId: "req-override", turnId: "turn:req-override", inputText: "okay" }), new AbortController().signal);
    expect(response.status).toBe("COMPLETED");

    const stored = await store.getAdmission("req-override", "route_override");
    expect(stored).toBeDefined();
    expect(stored?.routeOverrideJson).toBeDefined();
    const persisted = JSON.parse(stored!.routeOverrideJson!);
    expect(persisted).toMatchObject({
      attemptedRoute: "NO_RETRIEVAL",
      attemptedReasonCode: "unambiguous_acknowledgement",
      effectiveRoute: "SINGLE_RETRIEVAL",
      effectiveProfileSelector: "default",
      groundingRequired: true,
      routePolicyRevision: 9,
      enforcementOverride: true,
      overrideReason: "grounding_required_violation",
    });
  });

  it("denies release when the output guard authority actually rejects an oversized output, not a simulated denial", async () => {
    // The Authority's own DefaultContentPolicy (authority-service/src/service.ts)
    // denies on a real structural check: output byte length > 64 KiB. Give the
    // Orchestrator itself a generous bound so its own check does not intercept
    // this first — the denial we're asserting on must come from the deployed
    // Authority's guard, over the real HTTP wire, not from the Orchestrator's
    // local defaults.
    const retrieval = new StaticRetrieval(retrievalResult());
    const oversizedRuntime: RuntimePort = {
      async execute(input) {
        return {
          output: "x".repeat(70 * 1024),
          receipt: {
            schemaVersion: 1,
            reservationId: input.reservationId,
            requestId: "request-oversized",
            turnId: "turn-oversized",
            stepId: "step-oversized",
            fence: input.fence,
            artifactDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            endpointGeneration: input.endpointGeneration ?? "1",
            usageEventId: "usage:oversized",
            measuredUnits: 1,
            terminal: "completed",
          },
        };
      },
    };
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true,
      retrieval,
      generationContextFence: client,
      auditAdmission: client,
      outputGuards: client,
      outputStore: client,
      turnState: client,
      disclosure: client,
      resultAuthorization: client,
      routePolicy: new DevRoutePolicyPort({ groundingRequired: true, defaultProfileSelector: "default" }),
      maxOutputBytes: 1_000_000,
      runtime: oversizedRuntime,
    });

    const response = await service.handleChat(request({ requestId: "req-oversized", turnId: "turn-oversized" }), new AbortController().signal);

    expect(response.status).toBe("DENIED");
    expect(response.error).toBe("FORBIDDEN");
  });

  it("revalidates authorization immediately before generation and denies when the real Authority has revoked the fence between checkpoints", async () => {
    const retrieval = new StaticRetrieval(retrievalResult({ request_id: "req-revoke-flow", turn_id: "turn:req-revoke-flow" }));
    // The generation_start revalidate happens inside the Orchestrator's own
    // generate() step, before runtime.execute() is ever called. By revoking
    // the fence from inside runtime.execute() and then driving a SECOND real
    // revalidate through revalidateToolCallBoundary — the only other point in
    // the shipped code that re-checks a context fence for the same turn — we
    // prove the Authority backend's revocation genuinely takes effect against
    // the real HTTP wire, not just inside AuthorityService's own unit tests.
    const revokeThenReverifyRuntime: RuntimePort = {
      async execute(_input, signal) {
        const revoked = authorityService.revokeContextFence("req-revoke-flow", "turn:req-revoke-flow");
        expect(revoked).toBe(1);
        // This must throw — the Authority just revoked the fence for this
        // (requestId, turnId), so the real revalidate call over HTTP should
        // deny it. If it doesn't throw, the test fails with a normal
        // COMPLETED response instead of the expected denial below.
        await orchestratorService.revalidateToolCallBoundary(
          { requestId: "req-revoke-flow", contextDigest: `sha256:${"c".repeat(64)}`, toolCallRef: "tool:post-revoke-check" },
          signal,
        );
        return {
          output: "unexpected: revalidation should have thrown",
          receipt: {
            schemaVersion: 1,
            reservationId: _input.reservationId,
            requestId: "req-revoke-flow",
            turnId: "turn:req-revoke-flow",
            stepId: "step-revoke",
            fence: _input.fence,
            artifactDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            endpointGeneration: _input.endpointGeneration ?? "1",
            usageEventId: "usage:should-not-happen",
            measuredUnits: 1,
            terminal: "completed",
          },
        };
      },
    };
    const orchestratorService = new ProductionOrchestratorService({ devInMemoryAuthorities: true,
      retrieval,
      generationContextFence: client,
      auditAdmission: client,
      outputGuards: client,
      outputStore: client,
      turnState: client,
      disclosure: client,
      resultAuthorization: client,
      routePolicy: new DevRoutePolicyPort({ groundingRequired: true, defaultProfileSelector: "default" }),
      runtime: revokeThenReverifyRuntime,
    });
    const response = await orchestratorService.handleChat(
      request({ requestId: "req-revoke-flow", turnId: "turn-revoke-flow" }),
      new AbortController().signal,
    );

    expect(response.status).toBe("FAILED");
    expect(response.error).toBe("DEPENDENCY_UNAVAILABLE");
  });

  it("denies at generation_start itself — before runtime.execute is ever called — when the real Authority already revoked the context fence", async () => {
    // The previous test proves revocation is enforced at the *next reachable*
    // checkpoint (tool_call_boundary, inside runtime.execute). This test
    // proves the stronger, literal claim: that authorization is revalidated
    // BEFORE generation begins at all. We pre-seed a live fence for this
    // exact (requestId, turnId, contextDigest) against the real Authority,
    // revoke it, and only then run the turn — so the Orchestrator's own
    // generation_start revalidate call (service.ts, inside `generate()`,
    // which runs strictly before `modelGateway.generate`/`runtime.execute`)
    // is the thing that denies. The runtime is instrumented to prove it is
    // never invoked at all.
    const requestId = "req-pre-revoked";
    const turnId = `turn:${requestId}`;
    const contextDigest: `sha256:${string}` = `sha256:${"c".repeat(64)}`;

    const retrieval = new StaticRetrieval(retrievalResult({ request_id: requestId, turn_id: turnId }));

    await client.revalidate(
      {
        requestId,
        turnId,
        subjectRef: "subject-1",
        deviceRef: "device-1",
        sessionRef: "session-1",
        contextDigest,
        manifestExpiresAt: Date.now() + 60_000,
        boundary: "generation_start",
        resourceRefs: ["remote_work_policy.docx"],
        indexGeneration: "index:1",
      },
      new AbortController().signal,
    );
    const revoked = await authorityService.revokeContextFence(requestId, turnId);
    expect(revoked).toBe(1);

    let runtimeCalled = false;
    const shouldNeverRunRuntime: RuntimePort = {
      async execute(input) {
        runtimeCalled = true;
        return {
          output: "should never run",
          receipt: {
            schemaVersion: 1,
            reservationId: input.reservationId,
            requestId,
            turnId,
            stepId: "step-never",
            fence: input.fence,
            artifactDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            endpointGeneration: input.endpointGeneration ?? "1",
            usageEventId: "usage:never",
            measuredUnits: 1,
            terminal: "completed",
          },
        };
      },
    };

    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true,
      retrieval,
      generationContextFence: client,
      auditAdmission: client,
      outputGuards: client,
      outputStore: client,
      turnState: client,
      disclosure: client,
      resultAuthorization: client,
      routePolicy: new DevRoutePolicyPort({ groundingRequired: true, defaultProfileSelector: "default" }),
      runtime: shouldNeverRunRuntime,
    });

    const response = await service.handleChat(request({ requestId, turnId }), new AbortController().signal);

    expect(response.status).toBe("DENIED");
    expect(response.error).toBe("FORBIDDEN");
    expect(runtimeCalled).toBe(false);
  });
});
