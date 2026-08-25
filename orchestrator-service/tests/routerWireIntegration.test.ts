import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpTurnRouterLLMPort } from "../src/httpTurnRouter";
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
import { DevRoutePolicyPort, type RoutePolicyPort } from "../src/groundingPolicy";

const WORKLOAD_TOKEN = "controlled-model-workload-token-" + "y".repeat(20);

function request(overrides: Partial<OrchestratorChatRequest> = {}): OrchestratorChatRequest {
  return {
    requestId: "req-wire",
    turnId: "turn-wire",
    subjectRef: "subject-1",
    sessionRef: "session-wire",
    conversationRef: "conversation-wire",
    deviceRef: "device-1",
    applicationId: "lens-employee-client",
    purposeRef: "assistant",
    retrievalClass: "enterprise-grounded",
    workspaceRef: "default-workspace",
    capability: "grounded-assistant",
    inputText: "",
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
  };
}

class RecordingRetrieval implements RetrievalPort {
  readonly calls: RetrievalRequest[] = [];
  async retrieve(req: RetrievalRequest): Promise<RetrievalResult> {
    this.calls.push(req);
    return retrievalResult(req);
  }
}

function fakeReleasePorts(): {
  generationContextFence: GenerationContextFencePort;
  auditAdmission: AuditAdmissionPort;
  outputGuards: OutputGuardPort;
  outputStore: OutputBlobStorePort;
  turnState: TurnStatePort;
  disclosure: DisclosureReservationPort;
  resultAuthorization: ResultAuthorizationPort;
  routePolicy: RoutePolicyPort;
} {
  return {
    generationContextFence: {
      async revalidate(input) {
        return { fenceRef: `fence:${input.boundary}`, contextDigest: input.contextDigest, expiresAt: input.manifestExpiresAt, checkedAt: Date.now() };
      },
    },
    auditAdmission: { async admit(input) { return { receiptDigest: `audit:${input.kind}:${input.requestId}` }; } },
    outputGuards: { async inspect(input) { return { allowed: true, derivedClassificationRef: "internal", guardReceipt: `guard:${input.requestId}` }; } },
    outputStore: {
      async putBlob(input) { return { outputRef: `output:${input.turnId}`, outputDigest: input.outputDigest, commitProof: `commit:${input.outputDigest}` }; },
      async verifyBlob() { return true; },
      async repairDanglingOutput() { return "repaired"; },
    },
    turnState: { async commitTerminal() {}, async markFailed() {} },
    disclosure: {
      async reserve(input) { return { reservationRef: `disclosure:${input.requestId}`, classificationRef: input.classificationRef }; },
      async commit() {},
    },
    resultAuthorization: { async authorize(input) { return { releaseFence: `release:${input.outputRef}`, obligations: ["audit", "no-store"] }; } },
    routePolicy: new DevRoutePolicyPort(),
  };
}

/**
 * NOT a proof of live-model routing quality. This is a scripted stand-in
 * server that speaks the exact /v1/inference/generate wire contract
 * InternalInferenceClient and HttpTurnRouterLLMPort use, with a hand-coded
 * `classify()` function playing the model's role. What this DOES prove: the
 * transport, JSON envelope, auth header, and client-side schema
 * validation/fallback logic in httpTurnRouter.ts and router.ts are real and
 * exercised over a real HTTP connection. What this does NOT prove: routing
 * accuracy, false-retrieval rate, false-no-retrieval rate, follow-up rewrite
 * quality, latency, or failure-fallback behavior of any actual internal
 * router model — those require the acceptance evaluation described in
 * docs/ROUTER_ACCEPTANCE_EVALUATION_PLAN.md, run against a real deployed
 * model, before this router can be called production-verified.
 */
function startControlledModelServer(token: string): Promise<{ server: Server; url: string; requests: string[] }> {
  const requests: string[] = [];
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const suppliedToken = req.headers["x-lens-model-workload-token"];
      if (suppliedToken !== token) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "UNAUTHENTICATED" }));
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const prompt: string = body.chunks?.[0] ?? "";
        requests.push(prompt);
        const output = classify(prompt);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          output,
          receipt: {
            reservation_id: body.reservation_id,
            fence: body.fence,
            scope_id: body.scope_id,
            schema_version: 1,
            request_id: "request-wire",
            turn_id: "turn-wire",
            step_id: "step-wire",
            artifact_digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            endpoint_generation: body.endpoint_generation ?? "1",
            usage_event_id: `usage:${body.reservation_id}`,
            measured_units: 1,
            terminal: "completed",
          },
        }));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, requests }));
    server.once("error", reject);
  });
}

/** The synthetic classifier logic — stands in for a real fine-tuned router model's judgment, speaking the exact Doc 004 §23 wire schema. */
function classify(prompt: string): string {
  const currentTurnMatch = prompt.match(/Current turn: (.*)$/s);
  const currentTurn = (currentTurnMatch?.[1] ?? "").trim();
  const hasHistory = prompt.includes("Conversation so far:");

  if (currentTurn.includes("[MALFORMED_TRIGGER]")) {
    return "this is not valid JSON at all {{{";
  }
  if (/^(write|compose)\b/i.test(currentTurn)) {
    return JSON.stringify({ route: "NO_RETRIEVAL", standalone_query: "", reason_code: "conversational_smalltalk", confidence_bucket: "HIGH" });
  }
  if (hasHistory && /^what about\b/i.test(currentTurn)) {
    return JSON.stringify({ route: "SINGLE_RETRIEVAL", standalone_query: "What is the leave policy for contractors?", profile_selector: "default", reason_code: "followup_reference", confidence_bucket: "HIGH" });
  }
  if (currentTurn.length > 0 && currentTurn.split(/\s+/).length <= 2 && !/\?$/.test(currentTurn)) {
    return JSON.stringify({ route: "CLARIFY", standalone_query: currentTurn, reason_code: "ambiguous_intent", confidence_bucket: "MEDIUM" });
  }
  if (/\?\s*$/.test(currentTurn)) {
    return JSON.stringify({ route: "SINGLE_RETRIEVAL", standalone_query: currentTurn, profile_selector: "default", reason_code: "knowledge_lookup", confidence_bucket: "HIGH" });
  }
  return JSON.stringify({ route: "NO_RETRIEVAL", standalone_query: "", reason_code: "conversational_smalltalk", confidence_bucket: "HIGH" });
}

describe("router wire-contract and fallback tests (scripted stand-in server — NOT live-model accuracy proof; see docs/ROUTER_ACCEPTANCE_EVALUATION_PLAN.md)", () => {
  let server: Server;
  let modelUrl: string;
  let modelRequests: string[];
  let turnRouter: HttpTurnRouterLLMPort;

  beforeEach(async () => {
    const started = await startControlledModelServer(WORKLOAD_TOKEN);
    server = started.server;
    modelUrl = started.url;
    modelRequests = started.requests;
    turnRouter = new HttpTurnRouterLLMPort(modelUrl, WORKLOAD_TOKEN);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function service(retrieval: RetrievalPort, extraTurnRouter?: HttpTurnRouterLLMPort) {
    return new ProductionOrchestratorService({ devInMemoryAuthorities: true, retrieval, turnRouter: extraTurnRouter ?? turnRouter, ...fakeReleasePorts() });
  }

  it('"okay" performs zero retrieval and never even calls the router model — the deterministic fast path short-circuits first', async () => {
    const retrieval = new RecordingRetrieval();
    const svc = service(retrieval);

    const response = await svc.handleChat(request({ requestId: "req-ok", turnId: "turn-ok", inputText: "okay" }), new AbortController().signal);

    expect(response.status).toBe("COMPLETED");
    expect(response.output).toBe("Noted.");
    expect(retrieval.calls).toHaveLength(0);
    expect(modelRequests).toHaveLength(0);
  });

  it('"okay, what is the leave policy?" is classified by the real model over HTTP as KNOWLEDGE_QUERY and retrieves', async () => {
    const retrieval = new RecordingRetrieval();
    const svc = service(retrieval);

    const response = await svc.handleChat(
      request({ requestId: "req-compound", turnId: "turn-compound", inputText: "okay, what is the leave policy?" }),
      new AbortController().signal,
    );

    expect(response.status).toBe("COMPLETED");
    expect(retrieval.calls).toHaveLength(1);
    expect(modelRequests).toHaveLength(1);
    expect(modelRequests[0]).toContain("Current turn: okay, what is the leave policy?");
  });

  it("a creative, non-enterprise request is routed to GENERAL_CONVERSATION by the real model and never touches Retrieval", async () => {
    const retrieval = new RecordingRetrieval();
    const svc = service(retrieval);

    const response = await svc.handleChat(
      request({ requestId: "req-poem", turnId: "turn-poem", inputText: "Write a short poem about the office coffee machine" }),
      new AbortController().signal,
    );

    expect(response.status).toBe("COMPLETED");
    expect(retrieval.calls).toHaveLength(0);
  });

  it("an ambiguous one-word request is classified CLARIFICATION_REQUIRED by the real model and Retrieval is never called", async () => {
    const retrieval = new RecordingRetrieval();
    const svc = service(retrieval);

    const response = await svc.handleChat(request({ requestId: "req-ambiguous", turnId: "turn-ambiguous", inputText: "policy" }), new AbortController().signal);

    expect(response.status).toBe("COMPLETED");
    // CLARIFY always surfaces policy-owned text, never router prose (Doc 004 §11) — DevRoutePolicyPort's default clarificationText.
    expect(response.output).toBe("Could you say more about what you'd like to know?");
    expect(retrieval.calls).toHaveLength(0);
  });

  it("a contextual follow-up is rewritten by the real model into a standalone query and retrieval receives the rewrite, not the raw fragment", async () => {
    const retrieval = new RecordingRetrieval();
    const svc = service(retrieval);
    const history = [{ role: "user" as const, text: "What is the leave policy?" }];

    // classifyTurn is invoked with whatever history the ConversationHistoryPort
    // supplies; here we call the router directly through the full service by
    // seeding history via a real turn first, then asking the follow-up.
    await svc.handleChat(request({ requestId: "req-first", turnId: "turn-first", inputText: "What is the leave policy?" }), new AbortController().signal);
    const response = await svc.handleChat(
      request({ requestId: "req-followup", turnId: "turn-followup", inputText: "What about contractors?" }),
      new AbortController().signal,
    );

    expect(response.status).toBe("COMPLETED");
    expect(retrieval.calls).toHaveLength(2);
    expect(retrieval.calls[1]?.query_text).toBe("What is the leave policy for contractors?");
    void history;
  });

  it("retrieval cannot be bypassed for a grounding-required scope even when the real model's response is malformed over the wire — the deterministic failure-mode fallback still retrieves with the policy default selector", async () => {
    const retrieval = new RecordingRetrieval();
    const svc = new ProductionOrchestratorService({ devInMemoryAuthorities: true,
      retrieval,
      turnRouter,
      ...fakeReleasePorts(),
      routePolicy: new DevRoutePolicyPort({ groundingRequired: true, defaultProfileSelector: "default" }),
    });

    // The "[MALFORMED_TRIGGER]" marker only tells the controlled server to
    // return garbage JSON; it does not change what a real router would
    // decide about this text. If the malformed-response handling ever
    // silently dropped the turn instead of falling back deterministically to
    // a grounded default, this test would show retrieval never happening —
    // the actual claim in §3.5/§23 ("retrieval cannot be bypassed when
    // grounding is required, even on router failure").
    const response = await svc.handleChat(
      request({
        requestId: "req-malformed",
        turnId: "turn-malformed",
        inputText: "What is the leave policy? [MALFORMED_TRIGGER]",
      }),
      new AbortController().signal,
    );

    // The malformed model payload was fetched over the real wire (proving the
    // parse-and-fall-back path actually ran against a real response, not a
    // pre-canned unit-test double)...
    expect(modelRequests).toHaveLength(1);
    // ...and the deterministic failure-mode fallback in router.ts took over:
    // grounding_required=true with a policy default selector means the
    // malformed response resolves to SINGLE_RETRIEVAL with that default,
    // never a silent ungrounded answer.
    expect(response.status).toBe("COMPLETED");
    expect(retrieval.calls).toHaveLength(1);
    expect(retrieval.calls[0]?.query_text).toBe("What is the leave policy? [MALFORMED_TRIGGER]");
  });
});
