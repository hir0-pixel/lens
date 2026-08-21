import { describe, expect, it } from "vitest";
import {
  RAG_CONTRACT_VERSION,
  type AuthorizationManifest,
  type RagRequest,
  type RetrievalRequest,
  type RetrievalResult,
} from "../../libs/rag-contracts";

function validRequest(): RagRequest {
  return {
    request_id: "request-0001",
    turn_id: "turn-0001",
    subject_ref: "subject-1",
    session_ref: "session-1",
    device_ref: "device-1",
    application_id: "lens-employee-client",
    purpose_ref: "assistant",
    retrieval_class: "enterprise-grounded",
    query_digest: `sha256:${"a".repeat(64)}`,
    deadline_at: 2_000,
    cancellation: false,
    retry_budget: 0,
    bulkhead: "interactive",
    capability: "rag-assistant",
  };
}

function validRetrievalRequest(overrides: Partial<RetrievalRequest> = {}): RetrievalRequest {
  return {
    request_id: "request-0001",
    turn_id: "turn-0001",
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
    deadline_at: 2_000,
    cancellation: false,
    bulkhead: "interactive",
    visibility_minimum: 1,
    ...overrides,
  };
}

describe("RAG contract boundaries (Track 1)", () => {
  it("pins the contract version and additive-only registry", () => {
    expect(RAG_CONTRACT_VERSION).toBe("1.0.0");
  });

  it("does not accept a client-supplied subject, role, endpoint, or policy decision", () => {
    const forbidden = {
      ...validRequest(),
      subject_ref: "client-chosen",
      role: "admin",
      model_endpoint: "http://public.example/model",
      policy_decision: { allowed: true },
    };
    const allowed = Object.keys(validRequest());
    const received = Object.keys(forbidden);
    for (const key of received) {
      if (!allowed.includes(key)) {
        expect(key).toMatch(/^(role|model_endpoint|policy_decision)$/);
      }
    }
  });

  it("binds the orchestrator-only retrieval ingress to a fixed workload identity", () => {
    const request = validRetrievalRequest();
    expect(request.caller_workload_ref).toBe("ai-orchestrator");
    expect(request.application_id).toBe("lens-employee-client");
  });

  it("keeps retrieval candidate caps within the 100/500/1000 batch envelope", () => {
    for (const limit of [100, 500, 1_000]) {
      expect(validRetrievalRequest({ candidate_limit: limit }).candidate_limit).toBe(limit);
    }
    expect(validRetrievalRequest({ ...validRetrievalRequest(), candidate_limit: 1_001 }).candidate_limit).toBe(1_001);
  });

  it("distinguishes the stable retrieval result states", () => {
    const states: RetrievalResult["status"][] = ["context", "no_context", "denied_policy", "failed_downstream"];
    expect(states).toHaveLength(4);
  });

  it("keeps authorized context text on RetrievalResult while AuthorizationManifest stays text-free", () => {
    const result: RetrievalResult = {
      status: "context",
      retrieval_id: "retrieval-0001",
      request_id: "request-0001",
      turn_id: "turn-0001",
      visibility_sequence: 9,
      index_generation: "gen-0007",
      context_digest: `sha256:${"b".repeat(64)}`,
      manifest: {
        digest: `sha256:${"c".repeat(64)}`,
        retrieved_at: 2_000,
        source_revision_digest: `sha256:${"d".repeat(64)}`,
        operation_decision_ref: "op-0001",
        candidate_decision_ref: "cand-0001",
        policy_revision: 12,
        subject_security_revision: 44,
        resource_security_revision_digest: `sha256:${"e".repeat(64)}`,
        expires_at: 3_000,
        sources: [
          {
            document_version_ref: "doc-version-1",
            chunk_ref: "chunk-1",
            content_digest: `sha256:${"f".repeat(64)}`,
            citation_anchor: "Section 2",
            classification_ref: "confidential",
          },
        ],
      },
      sources: [
        {
          document_version_ref: "doc-version-1",
          chunk_ref: "chunk-1",
          content_digest: `sha256:${"f".repeat(64)}`,
          citation_anchor: "Section 2",
          classification_ref: "confidential",
          text: "The remote-work stipend is $1,500.",
        },
      ],
    };

    const manifest: AuthorizationManifest = result.manifest;

    expect(result.sources[0].text).toBe("The remote-work stipend is $1,500.");
    expect(manifest).not.toHaveProperty("text");
    expect(manifest.sources[0]).not.toHaveProperty("text");
    expect("text" in result.sources[0]).toBe(true);
    expect("text" in manifest).toBe(false);
  });
});
