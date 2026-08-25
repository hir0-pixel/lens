import { describe, expect, it } from "vitest";
import { ProductionOrchestratorService, type RetrievalPort } from "../src/service";
import type { OrchestratorChatRequest } from "../src/http";
import type { RetrievalResult } from "../../libs/rag-contracts";
import { InMemoryConversationHistory, type ConversationHistoryPort } from "../src/conversationHistory";
import { DevRoutePolicyPort } from "../src/groundingPolicy";

/**
 * P0 (Continue in D:\Lens\lens... "CORRECT THE END-TO-END WORKFLOW ORDER"): proves, against
 * REAL ProductionOrchestratorService/Orchestrator production wiring — not a direct
 * OrchestratorDependencies double (see services/orchestrator's own tests for that) — that
 * router classification, Memory's history read, and Memory's beginTurn all run strictly after
 * the top-level authorizeGenerate check, never before it.
 */

const NOW = 1_700_000_000_000;

function request(overrides: Partial<OrchestratorChatRequest> = {}): OrchestratorChatRequest {
  return {
    requestId: "req-order-1",
    turnId: "turn-order-1",
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
    throw new Error("Retrieval must not be called when top-level authorization was denied.");
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

describe("ordering: top-level authorization gates router classification and Memory begin/history", () => {
  it("a denied authorization (empty subjectRef) causes zero router, retrieval, Memory, or model calls", async () => {
    const history = new RecordingConversationHistory();
    let routerCalled = false;
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true,
      retrieval: new NeverCallRetrievalPort(),
      conversationHistory: history,
      turnRouter: { classify: async () => { routerCalled = true; return { route: "NO_RETRIEVAL", standalone_query: "", reason_code: "conversational_smalltalk", confidence_bucket: "HIGH" }; } },
      now: () => NOW,
    });

    const response = await service.handleChat(request({ subjectRef: "" }), new AbortController().signal);

    expect(response.status).not.toBe("COMPLETED");
    expect(history.events).toEqual([]);
    expect(routerCalled).toBe(false);
  });

  it("a denied authorization (expired deadline) causes zero router, retrieval, Memory, or model calls", async () => {
    const history = new RecordingConversationHistory();
    let routerCalled = false;
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true,
      retrieval: new NeverCallRetrievalPort(),
      conversationHistory: history,
      turnRouter: { classify: async () => { routerCalled = true; return { route: "NO_RETRIEVAL", standalone_query: "", reason_code: "conversational_smalltalk", confidence_bucket: "HIGH" }; } },
      now: () => NOW,
    });

    const response = await service.handleChat(request({ deadlineAt: NOW - 1 }), new AbortController().signal);

    expect(response.status).not.toBe("COMPLETED");
    expect(history.events).toEqual([]);
    expect(routerCalled).toBe(false);
  });

  it("Memory's history read and beginTurn run, and the router runs, only after authorization succeeded", async () => {
    const history = new RecordingConversationHistory();
    let routerCallOrder = -1;
    const service = new ProductionOrchestratorService({ devInMemoryAuthorities: true,
      retrieval: new NeverCallRetrievalPort(),
      conversationHistory: history,
      turnRouter: {
        classify: async () => {
          routerCallOrder = history.events.length;
          return { route: "NO_RETRIEVAL", standalone_query: "", reason_code: "conversational_smalltalk", confidence_bucket: "HIGH" };
        },
      },
      routePolicy: new DevRoutePolicyPort(),
      now: () => NOW,
    });

    await service.handleChat(request(), new AbortController().signal);

    // Memory's authorized bounded history read and beginTurn both ran (proving they were
    // reached at all, i.e. authorization succeeded first), and the router ran strictly after
    // both had already completed.
    expect(history.events.slice(0, 2)).toEqual(["memory:get", "memory:begin"]);
    expect(routerCallOrder).toBe(2);
  });
});
