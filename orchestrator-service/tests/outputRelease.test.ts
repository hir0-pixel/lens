import { describe, expect, it } from "vitest";
import { OrchestratorError, type OrchestratorFailureCode } from "../../services/orchestrator";
import type { RuntimePort } from "../../services/model-gateway/ModelGateway";
import type { RetrievalResult, RetrievedContext } from "../../libs/rag-contracts";
import type { OrchestratorChatRequest } from "../src/http";
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
import { DevRoutePolicyPort } from "../src/groundingPolicy";

const NOW = 1_700_000_000_000;
const CONTEXT_DIGEST = `sha256:${"d".repeat(64)}` as const;

function request(overrides: Partial<OrchestratorChatRequest> = {}): OrchestratorChatRequest {
  return {
    requestId: "req-release",
    turnId: "turn-release",
    subjectRef: "subject-1",
    sessionRef: "session-1",
    conversationRef: "conversation-1",
    deviceRef: "device-1",
    applicationId: "lens-employee-client",
    purposeRef: "assistant",
    retrievalClass: "enterprise-grounded",
    workspaceRef: "default-workspace",
    capability: "grounded-assistant",
    inputText: "What is the policy?",
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
    document_version_ref: "policy.docx",
    chunk_ref: "chunk-1",
    content_digest: `sha256:${"b".repeat(64)}`,
    citation_anchor: "A1",
    classification_ref: "internal",
    text: "Use approved internal systems only.",
    ...overrides,
  };
}

function retrievalResult(overrides: Partial<RetrievalResult> = {}): RetrievalResult {
  const retrieved = source();
  return {
    status: "context",
    retrieval_id: "retrieval-1",
    request_id: "req-release",
    turn_id: "turn:req-release",
    visibility_sequence: 1,
    index_generation: "index:1",
    context_digest: CONTEXT_DIGEST,
    manifest: {
      digest: CONTEXT_DIGEST,
      retrieved_at: NOW,
      source_revision_digest: `sha256:${"c".repeat(64)}`,
      operation_decision_ref: "decision:operation",
      candidate_decision_ref: "decision:candidates",
      policy_revision: 1,
      subject_security_revision: 1,
      resource_security_revision_digest: `sha256:${"e".repeat(64)}`,
      expires_at: NOW + 10_000,
      sources: [retrieved],
    },
    sources: [retrieved],
    ...overrides,
  };
}

class StaticRetrieval implements RetrievalPort {
  constructor(private readonly result = retrievalResult()) {}

  async retrieve(): Promise<RetrievalResult> {
    return this.result;
  }
}

function ports(events: string[] = [], overrides: {
  outputStore?: Partial<OutputBlobStorePort>;
  resultAuthorization?: Partial<ResultAuthorizationPort>;
  outputGuards?: Partial<OutputGuardPort>;
  runtime?: RuntimePort;
} = {}) {
  const generationContextFence: GenerationContextFencePort = {
    async revalidate(input, signal) {
      if (signal.aborted) throw new OrchestratorError("CANCELLED", "cancelled");
      events.push(`fence:${input.boundary}${input.toolCallRef ? `:${input.toolCallRef}` : ""}`);
      return {
        fenceRef: `fence:${input.boundary}`,
        contextDigest: input.contextDigest,
        expiresAt: input.manifestExpiresAt,
        checkedAt: NOW,
      };
    },
  };
  const auditAdmission: AuditAdmissionPort = {
    async admit(input, signal) {
      if (signal.aborted) throw new OrchestratorError("CANCELLED", "cancelled");
      events.push(`audit:${input.kind}`);
      return { receiptDigest: `audit:${input.kind}:${input.requestId}` };
    },
  };
  const outputGuards: OutputGuardPort = {
    async inspect(input, signal) {
      if (signal.aborted) throw new OrchestratorError("CANCELLED", "cancelled");
      events.push("guard:inspect");
      return {
        allowed: true,
        derivedClassificationRef: input.sourceClassifications.includes("restricted") ? "restricted" : "internal",
        guardReceipt: `guard:${input.requestId}`,
      };
    },
    ...overrides.outputGuards,
  };
  const outputStore: OutputBlobStorePort = {
    async putBlob(input, signal) {
      if (signal.aborted) throw new OrchestratorError("CANCELLED", "cancelled");
      events.push("output:put");
      return {
        outputRef: `output:${input.turnId}`,
        outputDigest: input.outputDigest,
        commitProof: `commit:${input.outputDigest}`,
      };
    },
    async verifyBlob(_input, signal) {
      if (signal.aborted) throw new OrchestratorError("CANCELLED", "cancelled");
      events.push("output:verify");
      return true;
    },
    async repairDanglingOutput(_input, signal) {
      if (signal.aborted) throw new OrchestratorError("CANCELLED", "cancelled");
      events.push("output:repair");
      return "repaired";
    },
    ...overrides.outputStore,
  };
  const turnState: TurnStatePort = {
    async commitTerminal(_input, signal) {
      if (signal.aborted) throw new OrchestratorError("CANCELLED", "cancelled");
      events.push("turn:commit");
    },
    async markFailed(input: { code: OrchestratorFailureCode }) {
      events.push(`turn:fail:${input.code}`);
    },
  };
  const disclosure: DisclosureReservationPort = {
    async reserve(input, signal) {
      if (signal.aborted) throw new OrchestratorError("CANCELLED", "cancelled");
      events.push(`disclosure:reserve:${input.classificationRef}`);
      return { reservationRef: `disclosure:${input.requestId}`, classificationRef: input.classificationRef };
    },
    async commit(_input, signal) {
      if (signal.aborted) throw new OrchestratorError("CANCELLED", "cancelled");
      events.push("disclosure:commit");
    },
  };
  const resultAuthorization: ResultAuthorizationPort = {
    async authorize(input, signal) {
      if (signal.aborted) throw new OrchestratorError("CANCELLED", "cancelled");
      events.push(`authz:${input.classificationRef}`);
      return { releaseFence: `release:${input.outputRef}`, obligations: ["audit", "no-store"] };
    },
    ...overrides.resultAuthorization,
  };
  return {
    generationContextFence,
    auditAdmission,
    outputGuards,
    outputStore,
    turnState,
    disclosure,
    resultAuthorization,
    // This file exercises the post-retrieval release pipeline, not routing
    // decisions — default to a grounded scope so the deterministic fallback
    // (no turnRouter configured) reaches retrieval/generation rather than
    // terminating early at CLARIFY, matching every test's actual intent.
    routePolicy: new DevRoutePolicyPort({ groundingRequired: true, defaultProfileSelector: "default" }),
    ...(overrides.runtime ? { runtime: overrides.runtime } : {}),
  };
}

describe("ProductionOrchestratorService output release", () => {
  it("fails closed when production release adapters are missing", async () => {
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true,
      retrieval: new StaticRetrieval(),
      now: () => NOW,
      routePolicy: new DevRoutePolicyPort(),
    });

    const response = await service.handleChat(request(), new AbortController().signal);

    expect(response).toMatchObject({
      status: "FAILED",
      requestId: "req-release",
      turnId: "turn:req-release",
      error: "EVIDENCE_REQUIRED",
    });
  });

  it("stores the output blob before terminal turn commit and release", async () => {
    const events: string[] = [];
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true,
      retrieval: new StaticRetrieval(),
      now: () => NOW,
      ...ports(events),
    });

    const response = await service.handleChat(request(), new AbortController().signal);

    expect(response.status).toBe("COMPLETED");
    expect(events).toEqual([
      "audit:generation",
      "fence:generation_start",
      "guard:inspect",
      "output:put",
      "disclosure:reserve:internal",
      "authz:internal",
      "audit:release",
      "output:verify",
      "turn:commit",
      "disclosure:commit",
    ]);
  });

  it("repairs a dangling output blob before terminal turn commit", async () => {
    const events: string[] = [];
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true,
      retrieval: new StaticRetrieval(),
      now: () => NOW,
      ...ports(events, {
        outputStore: {
          async verifyBlob() {
            events.push("output:verify");
            return false;
          },
        },
      }),
    });

    const response = await service.handleChat(request(), new AbortController().signal);

    expect(response.status).toBe("COMPLETED");
    expect(events.indexOf("output:repair")).toBeGreaterThan(events.indexOf("output:verify"));
    expect(events.indexOf("turn:commit")).toBeGreaterThan(events.indexOf("output:repair"));
  });

  it("does not release output when dangling repair reports corrupt data", async () => {
    const events: string[] = [];
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true,
      retrieval: new StaticRetrieval(),
      now: () => NOW,
      ...ports(events, {
        outputStore: {
          async verifyBlob() {
            events.push("output:verify");
            return false;
          },
          async repairDanglingOutput() {
            events.push("output:repair");
            return "corrupt";
          },
        },
      }),
    });

    const response = await service.handleChat(request(), new AbortController().signal);

    expect(response).toMatchObject({ status: "FAILED", error: "DEPENDENCY_UNAVAILABLE" });
    expect(events).not.toContain("turn:commit");
    expect(events).not.toContain("disclosure:commit");
    expect(events).toContain("turn:fail:DEPENDENCY_UNAVAILABLE");
  });

  it("denies release when durable result authorization fails", async () => {
    const events: string[] = [];
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true,
      retrieval: new StaticRetrieval(),
      now: () => NOW,
      ...ports(events, {
        resultAuthorization: {
          async authorize() {
            events.push("authz:deny");
            throw new OrchestratorError("FORBIDDEN", "result denied");
          },
        },
      }),
    });

    const response = await service.handleChat(request(), new AbortController().signal);

    expect(response).toMatchObject({ status: "DENIED", error: "FORBIDDEN" });
    expect(events).not.toContain("audit:release");
    expect(events).not.toContain("turn:commit");
  });

  it("enforces byte-bounded output before durable staging", async () => {
    const events: string[] = [];
    const runtime: RuntimePort = {
      async execute(input) {
        return {
          output: "123456789",
          receipt: {
            schemaVersion: 1,
            reservationId: input.reservationId,
            requestId: "req-large",
            turnId: "turn:req-large",
            stepId: "step-large",
            fence: input.fence,
            artifactDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            endpointGeneration: input.endpointGeneration ?? "1",
            usageEventId: "usage:large",
            measuredUnits: 1,
            terminal: "completed",
          },
        };
      },
    };
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true,
      retrieval: new StaticRetrieval(),
      now: () => NOW,
      maxOutputBytes: 4,
      ...ports(events, { runtime }),
    });

    const response = await service.handleChat(request(), new AbortController().signal);

    expect(response).toMatchObject({ status: "FAILED", error: "OVERLOADED" });
    expect(events).not.toContain("output:put");
  });

  it("does not automatically retry non-idempotent model generation failures", async () => {
    let attempts = 0;
    const runtime: RuntimePort = {
      async execute() {
        attempts += 1;
        throw new Error("runtime unavailable");
      },
    };
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true,
      retrieval: new StaticRetrieval(),
      now: () => NOW,
      ...ports([], { runtime }),
    });

    const response = await service.handleChat(request(), new AbortController().signal);

    expect(response).toMatchObject({ status: "FAILED", error: "DEPENDENCY_UNAVAILABLE" });
    expect(attempts).toBe(1);
  });

  it("propagates cancellation through output-release ports", async () => {
    const events: string[] = [];
    const controller = new AbortController();
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true,
      retrieval: new StaticRetrieval(),
      now: () => NOW,
      ...ports(events, {
        outputStore: {
          async putBlob(_input, signal) {
            events.push(`output:put:pre:${signal.aborted}`);
            controller.abort();
            if (signal.aborted) throw new OrchestratorError("CANCELLED", "cancelled");
            throw new Error("expected cancellation");
          },
        },
      }),
    });

    const response = await service.handleChat(request(), controller.signal);

    expect(response).toMatchObject({ status: "CANCELLED", error: "CANCELLED" });
    expect(events).toContain("output:put:pre:false");
    expect(events).not.toContain("turn:commit");
  });

  it("exposes a tool-call boundary revalidation API while the request is active", async () => {
    const events: string[] = [];
    const runtime: RuntimePort = {
      async execute(_input, signal) {
        await service.revalidateToolCallBoundary({
          requestId: "req-tool",
          contextDigest: CONTEXT_DIGEST,
          toolCallRef: "tool:kb-lookup",
        }, signal);
        return {
          output: "tool checked",
          receipt: {
            schemaVersion: 1,
            reservationId: _input.reservationId,
            requestId: "req-tool",
            turnId: "turn:req-tool",
            stepId: "step-tool",
            fence: _input.fence,
            artifactDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            endpointGeneration: _input.endpointGeneration ?? "1",
            usageEventId: "usage:tool",
            measuredUnits: 1,
            terminal: "completed",
          },
        };
      },
    };
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true,
      retrieval: new StaticRetrieval(retrievalResult({ request_id: "req-tool", turn_id: "turn:req-tool" })),
      now: () => NOW,
      ...ports(events, { runtime }),
    });
    const response = await service.handleChat(request({ requestId: "req-tool", turnId: "turn-tool" }), new AbortController().signal);

    expect(response.status).toBe("COMPLETED");
    expect(events).toContain("fence:generation_start");
    expect(events).toContain("fence:tool_call_boundary:tool:kb-lookup");
  });
});
