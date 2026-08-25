import { describe, expect, it } from "vitest";
import { ProductionOrchestratorService, type RetrievalPort } from "../src/service";
import type { OrchestratorChatRequest } from "../src/http";
import type { RetrievalResult } from "../../libs/rag-contracts";
import { InMemoryConversationHistory, type ConversationHistoryPort } from "../src/conversationHistory";
import { DevRoutePolicyPort } from "../src/groundingPolicy";

/**
 * Item 8 ("authority quorum loss fails closed"): this repository has no quorum mechanism, so
 * the honest coverage for that requirement is proving that an UNREACHABLE shared authority —
 * modeled here as the production-default `FailClosed*` bundle every `ProductionOrchestratorService`
 * gets unless `devInMemoryAuthorities: true` or explicit adapters are supplied — denies every
 * turn outright, before Memory, the router, retrieval, or Model Gateway are ever touched. Every
 * OTHER test in this package passes `devInMemoryAuthorities: true`, so nothing else proves these
 * defaults do anything; this file is the only place that constructs the service without it.
 */

const NOW = 1_700_000_000_000;

function request(overrides: Partial<OrchestratorChatRequest> = {}): OrchestratorChatRequest {
  return {
    requestId: "req-failclosed-1",
    turnId: "turn-failclosed-1",
    subjectRef: "subject-1",
    sessionRef: "session-1",
    conversationRef: "conversation-1",
    deviceRef: "device-1",
    applicationId: "lens-employee-client",
    purposeRef: "assistant",
    retrievalClass: "enterprise-grounded",
    workspaceRef: "default-workspace",
    capability: "grounded-assistant",
    inputText: "What is the leave policy?",
    queryDigest: `sha256:${"a".repeat(64)}`,
    deadlineAt: NOW + 30_000,
    retryBudget: 0,
    bulkhead: "interactive",
    delegatedSessionAssertion: "test-delegated-session-assertion",
    ...overrides,
  };
}

class NeverCallRetrievalPort implements RetrievalPort {
  async retrieve(): Promise<RetrievalResult> {
    throw new Error("Retrieval must not be called when the shared authority bundle is unreachable.");
  }
}

class RecordingConversationHistory implements ConversationHistoryPort {
  readonly events: string[] = [];
  private readonly delegate: ConversationHistoryPort = new InMemoryConversationHistory();
  async get(input: Parameters<ConversationHistoryPort["get"]>[0], signal: AbortSignal) {
    this.events.push("memory:get");
    return this.delegate.get(input, signal);
  }
  async beginTurn(input: Parameters<ConversationHistoryPort["beginTurn"]>[0], signal: AbortSignal) {
    this.events.push("memory:begin");
    return this.delegate.beginTurn(input, signal);
  }
  async finalizeTurn(input: Parameters<ConversationHistoryPort["finalizeTurn"]>[0], signal: AbortSignal) {
    this.events.push("memory:finalize");
    return this.delegate.finalizeTurn(input, signal);
  }
  async append(input: Parameters<ConversationHistoryPort["append"]>[0], signal: AbortSignal) {
    return this.delegate.append(input, signal);
  }
}

describe("production defaults: an unreachable shared authority bundle fails every turn closed", () => {
  it("with no devInMemoryAuthorities flag and no explicit adapters, a turn is denied with zero Memory/router/retrieval calls", async () => {
    const history = new RecordingConversationHistory();
    let routerCalled = false;
    const service = new ProductionOrchestratorService({
      retrieval: new NeverCallRetrievalPort(),
      conversationHistory: history,
      turnRouter: { classify: async () => { routerCalled = true; return { route: "NO_RETRIEVAL", standalone_query: "", reason_code: "conversational_smalltalk", confidence_bucket: "HIGH" }; } },
      routePolicy: new DevRoutePolicyPort(),
      now: () => NOW,
    });

    const response = await service.handleChat(request(), new AbortController().signal);

    expect(response.status).not.toBe("COMPLETED");
    expect(history.events).toEqual([]);
    expect(routerCalled).toBe(false);
  });
});
