import { describe, expect, it } from "vitest";
import type {
  AuditAdmissionPort,
  DisclosureReservationPort,
  GenerationContextFencePort,
  OutputBlobStorePort,
  OutputGuardPort,
  ResultAuthorizationPort,
  TurnStatePort,
  RetrievalPort,
} from "../src/service";
import { ProductionOrchestratorService } from "../src/service";
import type { OrchestratorChatRequest } from "../src/http";
import type { RetrievalRequest, RetrievalResult, RetrievedContext } from "../../libs/rag-contracts";
import type { OrchestratorFailureCode } from "../../services/orchestrator";

const NOW = 1_700_000_000_000;

function request(overrides: Partial<OrchestratorChatRequest> = {}): OrchestratorChatRequest {
  return {
    requestId: "req-1",
    turnId: "turn-1",
    subjectRef: "subject-1",
    sessionRef: "session-1",
    deviceRef: "device-1",
    applicationId: "lens-employee-client",
    purposeRef: "assistant",
    retrievalClass: "enterprise-grounded",
    capability: "grounded-assistant",
    inputText: "What is the remote-work stipend?",
    queryDigest: `sha256:${"a".repeat(64)}`,
    deadlineAt: NOW + 30_000,
    retryBudget: 0,
    bulkhead: "interactive",
    ...overrides,
  };
}

function contextSource(overrides: Partial<RetrievedContext> = {}): RetrievedContext {
  return {
    document_version_ref: "remote_work_policy.docx",
    chunk_ref: "chunk-1",
    content_digest: `sha256:${"b".repeat(64)}`,
    citation_anchor: "Section 2",
    classification_ref: "internal",
    text: "The remote-work stipend is $1,500 per year.",
    ...overrides,
  };
}

class FakeRetrievalPort implements RetrievalPort {
  readonly calls: { request: RetrievalRequest; signal: AbortSignal }[] = [];

  constructor(private readonly result: RetrievalResult) {}

  async retrieve(request: RetrievalRequest, signal: AbortSignal): Promise<RetrievalResult> {
    this.calls.push({ request, signal });
    return this.result;
  }
}

function testReleasePorts(events: string[] = []) {
  const generationContextFence: GenerationContextFencePort = {
    async revalidate(input, signal) {
      if (signal.aborted) throw new Error("CANCELLED");
      events.push(`fence:${input.boundary}`);
      return {
        fenceRef: `fence:${input.boundary}:${input.requestId}`,
        contextDigest: input.contextDigest,
        expiresAt: input.manifestExpiresAt,
        checkedAt: NOW,
      };
    },
  };
  const auditAdmission: AuditAdmissionPort = {
    async admit(input, signal) {
      if (signal.aborted) throw new Error("CANCELLED");
      events.push(`audit:${input.kind}`);
      return { receiptDigest: `audit:${input.kind}:${input.requestId}` };
    },
  };
  const outputGuards: OutputGuardPort = {
    async inspect(input, signal) {
      if (signal.aborted) throw new Error("CANCELLED");
      events.push("guard:inspect");
      return {
        allowed: true,
        derivedClassificationRef: input.sourceClassifications.includes("restricted") ? "restricted" : "internal",
        guardReceipt: `guard:${input.outputDigest}`,
      };
    },
  };
  const outputStore: OutputBlobStorePort = {
    async putBlob(input, signal) {
      if (signal.aborted) throw new Error("CANCELLED");
      events.push("output:put");
      return {
        outputRef: `output:${input.turnId}`,
        outputDigest: input.outputDigest,
        commitProof: `commit:${input.outputDigest}`,
      };
    },
    async verifyBlob(_input, signal) {
      if (signal.aborted) throw new Error("CANCELLED");
      events.push("output:verify");
      return true;
    },
    async repairDanglingOutput(_input, signal) {
      if (signal.aborted) throw new Error("CANCELLED");
      events.push("output:repair");
      return "repaired";
    },
  };
  const turnState: TurnStatePort = {
    async commitTerminal(_input, signal) {
      if (signal.aborted) throw new Error("CANCELLED");
      events.push("turn:commit");
    },
    async markFailed(input: { code: OrchestratorFailureCode }) {
      events.push(`turn:fail:${input.code}`);
    },
  };
  const disclosure: DisclosureReservationPort = {
    async reserve(input, signal) {
      if (signal.aborted) throw new Error("CANCELLED");
      events.push(`disclosure:reserve:${input.classificationRef}`);
      return { reservationRef: `disclosure:${input.requestId}`, classificationRef: input.classificationRef };
    },
    async commit(_input, signal) {
      if (signal.aborted) throw new Error("CANCELLED");
      events.push("disclosure:commit");
    },
  };
  const resultAuthorization: ResultAuthorizationPort = {
    async authorize(input, signal) {
      if (signal.aborted) throw new Error("CANCELLED");
      events.push(`authz:${input.classificationRef}`);
      return { releaseFence: `release:${input.outputRef}`, obligations: ["audit", "no-store"] };
    },
  };
  return { generationContextFence, auditAdmission, outputGuards, outputStore, turnState, disclosure, resultAuthorization };
}

describe("ProductionOrchestratorService", () => {
  it("returns a grounded completion with citations and retrieval-derived context", async () => {
    const source = contextSource();
    const retrieval = new FakeRetrievalPort({
      status: "context",
      retrieval_id: "retrieval-1",
      request_id: "req-1",
      turn_id: "turn:req-1",
      visibility_sequence: 7,
      index_generation: "index:gen-7",
      context_digest: `sha256:${"c".repeat(64)}`,
      manifest: {
        digest: `sha256:${"d".repeat(64)}`,
        retrieved_at: NOW,
        source_revision_digest: `sha256:${"e".repeat(64)}`,
        operation_decision_ref: "decision:operation",
        candidate_decision_ref: "decision:candidates",
        policy_revision: 11,
        subject_security_revision: 5,
        resource_security_revision_digest: `sha256:${"f".repeat(64)}`,
        expires_at: NOW + 10_000,
        sources: [source],
      },
      sources: [source],
    });
    const service = new ProductionOrchestratorService({ retrieval, now: () => NOW, ...testReleasePorts() });

    const response = await service.handleChat(request(), new AbortController().signal);

    expect(response).toMatchObject({
      status: "COMPLETED",
      requestId: "req-1",
      turnId: "turn:req-1",
      citations: [{ source: "remote_work_policy.docx", section: "Section 2" }],
    });
    expect(response.output).toContain("Answer using only the authorized context for request req-1.");
    expect(response.output).toContain("Question: What is the remote-work stipend?");
    expect(response.output).toContain("The remote-work stipend is $1,500 per year.");
    expect(response.outputDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(retrieval.calls).toHaveLength(1);
    expect(retrieval.calls[0]?.request).toMatchObject({
      request_id: "req-1",
      turn_id: "turn:req-1",
      caller_workload_ref: "ai-orchestrator",
      subject_ref: "subject-1",
      session_ref: "session-1",
      device_ref: "device-1",
      application_id: "lens-employee-client",
      query_digest: `sha256:${"a".repeat(64)}`,
      query_text: "What is the remote-work stipend?",
      purpose_ref: "assistant",
      retrieval_class: "enterprise-grounded",
      corpus_ref: "enterprise-docs",
      mode: "hybrid",
      candidate_limit: 100,
      deadline_at: NOW + 30_000,
      cancellation: false,
      bulkhead: "interactive",
      visibility_minimum: 0,
    });
    expect(retrieval.calls[0]?.signal.aborted).toBe(false);
  });

  it("denies the turn when retrieval returns no authorized context", async () => {
    const retrieval = new FakeRetrievalPort({ status: "no_context" });
    const service = new ProductionOrchestratorService({ retrieval, now: () => NOW, ...testReleasePorts() });

    const response = await service.handleChat(request({ requestId: "req-2", turnId: "turn-2" }), new AbortController().signal);

    expect(response).toEqual({
      status: "DENIED",
      requestId: "req-2",
      turnId: "turn:req-2",
      error: "FORBIDDEN",
    });
    expect(retrieval.calls).toHaveLength(1);
  });

  it("rejects nonzero retry budgets before any retrieval call", async () => {
    const retrieval = new FakeRetrievalPort({ status: "no_context" });
    const service = new ProductionOrchestratorService({ retrieval, now: () => NOW, ...testReleasePorts() });

    const response = await service.handleChat(request({ requestId: "req-3", turnId: "turn-3", retryBudget: 1 }), new AbortController().signal);

    expect(response).toEqual({
      status: "FAILED",
      requestId: "req-3",
      error: "NON_IDEMPOTENT_RETRY_REJECTED",
    });
    expect(retrieval.calls).toHaveLength(0);
  });
});
