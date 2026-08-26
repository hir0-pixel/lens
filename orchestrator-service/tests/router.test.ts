import { describe, expect, it } from "vitest";
import { classifyTurn, isUnambiguousAcknowledgement } from "../src/router";
import type { RoutePolicyResult } from "../src/groundingPolicy";

const signal = () => new AbortController().signal;

function policy(overrides: Partial<RoutePolicyResult> = {}): RoutePolicyResult {
  return {
    applicationRef: "lens-employee-client",
    workspaceRef: "default-workspace",
    purposeRef: "assistant",
    requestClass: "enterprise-grounded",
    routePolicyRevision: 7,
    routePolicyDigest: `sha256:${"a".repeat(64)}`,
    groundingRequired: false,
    routerModelRef: "router-test-v1",
    allowedProfileSelectors: ["default", "policy-docs"],
    allowedProfileSetDigest: `sha256:${"b".repeat(64)}`,
    defaultProfileSelector: "default",
    noDefaultSelectorBehavior: "CLARIFY",
    clarificationText: "Could you say more about what you'd like to know?",
    ...overrides,
  };
}

describe("router: deterministic acknowledgement fast path", () => {
  it("routes greetings to GENERAL_CONVERSATION without calling the router model", async () => {
    let called = 0;
    const llm = { classify: async () => { called += 1; return {}; } };
    const result = await classifyTurn({ text: "hello", history: [], requestId: "req-1", turnId: "turn-1", deadlineAt: Date.now() + 30_000 }, llm, policy({ groundingRequired: false }), signal());
    expect(called).toBe(0);
    expect(result.decision.route).toBe("GENERAL_CONVERSATION");
    expect(result.routeOutput).toBe("NO_RETRIEVAL");
  });

  it("treats bare acknowledgements as zero-retrieval ACKNOWLEDGEMENT", () => {
    for (const text of ["okay", "Okay!", "thanks", "Thank you.", "got it", "ok", "yes"]) {
      expect(isUnambiguousAcknowledgement(text)).toBe(true);
    }
  });

  it("does not treat a compound acknowledgement-plus-question as an acknowledgement", () => {
    expect(isUnambiguousAcknowledgement("okay, what is the leave policy?")).toBe(false);
  });

  it("routes a bare acknowledgement to ACKNOWLEDGEMENT with no LLM call when policy does not require grounding", async () => {
    const result = await classifyTurn({ text: "thanks", history: [], requestId: "req-1", turnId: "turn-1", deadlineAt: Date.now() + 30_000 }, undefined, policy({ groundingRequired: false }), signal());
    expect(result.decision).toEqual({ route: "ACKNOWLEDGEMENT", queryText: "thanks" });
    expect(result.routeOutput).toBe("NO_RETRIEVAL");
    expect(result.enforcement).toBeUndefined();
  });

  it("does not force retrieval for a bare yes when grounding is not required", async () => {
    const result = await classifyTurn({ text: "yes", history: [], requestId: "req-1", turnId: "turn-1", deadlineAt: Date.now() + 30_000 }, undefined, policy({ groundingRequired: false }), signal());
    expect(result.decision.route).toBe("ACKNOWLEDGEMENT");
    expect(result.routeOutput).toBe("NO_RETRIEVAL");
  });

  it("does NOT let an acknowledgement skip retrieval when the pre-resolved policy requires grounding — overrides to SINGLE_RETRIEVAL with the default selector and records enforcement provenance", async () => {
    const result = await classifyTurn({ text: "okay", history: [], requestId: "req-1", turnId: "turn-1", deadlineAt: Date.now() + 30_000 }, undefined, policy({ groundingRequired: true, defaultProfileSelector: "default" }), signal());
    expect(result.decision.route).toBe("KNOWLEDGE_QUERY");
    expect(result.routeOutput).toBe("SINGLE_RETRIEVAL");
    expect(result.profileSelector).toBe("default");
    expect(result.enforcement).toMatchObject({
      attemptedRoute: "NO_RETRIEVAL",
      attemptedReasonCode: "unambiguous_acknowledgement",
      attemptedConfidenceBucket: "HIGH",
      overrideReason: "grounding_required_violation",
    });
  });

  it("fails closed to CLARIFY (never a silent ungrounded answer) when grounding is required, the ack fast path fires, and no default selector exists", async () => {
    const result = await classifyTurn(
      { text: "yes", history: [], requestId: "req-1", turnId: "turn-1", deadlineAt: Date.now() + 30_000 },
      undefined,
      policy({ groundingRequired: true, defaultProfileSelector: undefined, noDefaultSelectorBehavior: "CLARIFY" }),
      signal(),
    );
    expect(result.decision.route).toBe("CLARIFICATION_REQUIRED");
    expect(result.decision.clarifyQuestion).toBe("Could you say more about what you'd like to know?");
    expect(result.enforcement?.overrideReason).toBe("grounding_default_unavailable");
  });

  it("fails closed with a typed error (not a route) when grounding is required, no default selector exists, and policy specifies FAIL_CLOSED", async () => {
    const result = await classifyTurn(
      { text: "yes", history: [], requestId: "req-1", turnId: "turn-1", deadlineAt: Date.now() + 30_000 },
      undefined,
      policy({ groundingRequired: true, defaultProfileSelector: undefined, noDefaultSelectorBehavior: "FAIL_CLOSED" }),
      signal(),
    );
    expect(result.failClosed).toEqual({ reason: "grounding_default_unavailable" });
  });
});

describe("router: deterministic failure-mode fallback (no LLM configured, or the LLM is unusable)", () => {
  it("falls back to CLARIFY — never a fabricated KNOWLEDGE_QUERY guess — when grounding is not required", async () => {
    const result = await classifyTurn({ text: "What does our remote-work policy say?", history: [], requestId: "req-1", turnId: "turn-1", deadlineAt: Date.now() + 30_000 }, undefined, policy({ groundingRequired: false }), signal());
    expect(result.decision.route).toBe("CLARIFICATION_REQUIRED");
    expect(result.routeOutput).toBe("CLARIFY");
  });

  it("falls back to SINGLE_RETRIEVAL with the policy default selector when grounding is required", async () => {
    const result = await classifyTurn(
      { text: "What does our remote-work policy say?", history: [], requestId: "req-1", turnId: "turn-1", deadlineAt: Date.now() + 30_000 },
      undefined,
      policy({ groundingRequired: true, defaultProfileSelector: "policy-docs" }),
      signal(),
    );
    expect(result.decision.route).toBe("KNOWLEDGE_QUERY");
    expect(result.routeOutput).toBe("SINGLE_RETRIEVAL");
    expect(result.profileSelector).toBe("policy-docs");
    // Failure-mode fallback is not an enforcement override — there was no admissible attempted result to override.
    expect(result.enforcement).toBeUndefined();
  });

  it("routes a follow-up-shaped fallback to CONTEXTUAL_FOLLOW_UP when prior history exists", async () => {
    const history = [
      { role: "user" as const, text: "What is the leave policy?" },
      { role: "assistant" as const, text: "Employees get 20 days of leave per year." },
    ];
    const result = await classifyTurn({ text: "What about contractors?", history, requestId: "req-1", turnId: "turn-1", deadlineAt: Date.now() + 30_000 }, undefined, policy({ groundingRequired: true, defaultProfileSelector: "default" }), signal());
    expect(result.decision.route).toBe("CONTEXTUAL_FOLLOW_UP");
  });
});

describe("router: LLM-backed classification against the real Doc 004 §23 wire schema", () => {
  it("accepts a valid SINGLE_RETRIEVAL decision with an in-set profile_selector", async () => {
    const result = await classifyTurn(
      { text: "What is the leave policy for remote workers?", history: [], requestId: "req-1", turnId: "turn-1", deadlineAt: Date.now() + 30_000 },
      { classify: async () => ({ route: "SINGLE_RETRIEVAL", standalone_query: "What is the leave policy for remote workers?", profile_selector: "policy-docs", reason_code: "knowledge_lookup", confidence_bucket: "HIGH" }) },
      policy(),
      signal(),
    );
    expect(result.decision).toEqual({ route: "KNOWLEDGE_QUERY", queryText: "What is the leave policy for remote workers?" });
    expect(result.profileSelector).toBe("policy-docs");
  });

  it("rejects an out-of-set profile_selector and falls back deterministically instead of trusting it", async () => {
    const result = await classifyTurn(
      { text: "What is the leave policy?", history: [], requestId: "req-1", turnId: "turn-1", deadlineAt: Date.now() + 30_000 },
      { classify: async () => ({ route: "SINGLE_RETRIEVAL", standalone_query: "What is the leave policy?", profile_selector: "not-a-real-selector", reason_code: "x", confidence_bucket: "HIGH" }) },
      policy({ groundingRequired: true, defaultProfileSelector: "default" }),
      signal(),
    );
    expect(result.profileSelector).toBe("default");
    expect(result.routeOutput).toBe("SINGLE_RETRIEVAL");
  });

  it("never trusts a schema-valid, HIGH-confidence NO_RETRIEVAL when grounding_required=true — overrides to SINGLE_RETRIEVAL with the default selector regardless of reason_code or confidence", async () => {
    const result = await classifyTurn(
      { text: "Write a poem about the office coffee machine", history: [], requestId: "req-1", turnId: "turn-1", deadlineAt: Date.now() + 30_000 },
      { classify: async () => ({ route: "NO_RETRIEVAL", standalone_query: "", reason_code: "conversational_smalltalk", confidence_bucket: "HIGH" }) },
      policy({ groundingRequired: true, defaultProfileSelector: "default" }),
      signal(),
    );
    expect(result.routeOutput).toBe("SINGLE_RETRIEVAL");
    expect(result.enforcement).toMatchObject({ attemptedRoute: "NO_RETRIEVAL", attemptedReasonCode: "conversational_smalltalk", overrideReason: "grounding_required_violation" });
  });

  it("allows a router NO_RETRIEVAL when grounding is not required", async () => {
    const result = await classifyTurn(
      { text: "Write a poem about the office coffee machine", history: [], requestId: "req-1", turnId: "turn-1", deadlineAt: Date.now() + 30_000 },
      { classify: async () => ({ route: "NO_RETRIEVAL", standalone_query: "", reason_code: "conversational_smalltalk", confidence_bucket: "HIGH" }) },
      policy({ groundingRequired: false }),
      signal(),
    );
    expect(result.decision.route).toBe("GENERAL_CONVERSATION");
    expect(result.enforcement).toBeUndefined();
  });

  it("never trusts a LOW-confidence NO_RETRIEVAL even when grounding is not required — falls back to the deterministic failure-mode path instead", async () => {
    const result = await classifyTurn(
      { text: "hmm", history: [], requestId: "req-1", turnId: "turn-1", deadlineAt: Date.now() + 30_000 },
      { classify: async () => ({ route: "NO_RETRIEVAL", standalone_query: "", reason_code: "no_retrieval_needed", confidence_bucket: "LOW" }) },
      policy({ groundingRequired: false }),
      signal(),
    );
    expect(result.routeOutput).toBe("CLARIFY");
  });

  it("falls back deterministically when the LLM router throws", async () => {
    const result = await classifyTurn(
      { text: "What is the leave policy?", history: [], requestId: "req-1", turnId: "turn-1", deadlineAt: Date.now() + 30_000 },
      { classify: async () => { throw new Error("router unavailable"); } },
      policy({ groundingRequired: true, defaultProfileSelector: "default" }),
      signal(),
    );
    expect(result.routeOutput).toBe("SINGLE_RETRIEVAL");
  });

  it("falls back deterministically when the LLM returns a malformed/unschema'd payload", async () => {
    const result = await classifyTurn(
      { text: "What is the leave policy?", history: [], requestId: "req-1", turnId: "turn-1", deadlineAt: Date.now() + 30_000 },
      { classify: async () => ({ route: "NOT_A_REAL_ROUTE" }) },
      policy({ groundingRequired: true, defaultProfileSelector: "default" }),
      signal(),
    );
    expect(result.routeOutput).toBe("SINGLE_RETRIEVAL");
  });

  it("rejects a SINGLE_RETRIEVAL payload whose standalone_query is empty", async () => {
    const result = await classifyTurn(
      { text: "What about that?", history: [{ role: "user", text: "What is the leave policy?" }], requestId: "req-1", turnId: "turn-1", deadlineAt: Date.now() + 30_000 },
      { classify: async () => ({ route: "SINGLE_RETRIEVAL", standalone_query: "   ", profile_selector: "default", reason_code: "x", confidence_bucket: "HIGH" }) },
      policy({ groundingRequired: false }),
      signal(),
    );
    // Falls back to the deterministic failure-mode path (CLARIFY, grounding not required) rather than trusting an empty rewrite.
    expect(result.routeOutput).toBe("CLARIFY");
  });

  it("never lets the LLM bypass the deterministic acknowledgement fast path", async () => {
    const result = await classifyTurn(
      { text: "thanks", history: [], requestId: "req-1", turnId: "turn-1", deadlineAt: Date.now() + 30_000 },
      { classify: async () => ({ route: "SINGLE_RETRIEVAL", standalone_query: "thanks", profile_selector: "default", reason_code: "x", confidence_bucket: "HIGH" }) },
      policy({ groundingRequired: false }),
      signal(),
    );
    expect(result.decision.route).toBe("ACKNOWLEDGEMENT");
  });

  it("rejects MULTI_RETRIEVAL as unsupported rather than silently executing it as SINGLE_RETRIEVAL", async () => {
    const result = await classifyTurn(
      { text: "Compare our leave policy against the remote-work policy", history: [], requestId: "req-1", turnId: "turn-1", deadlineAt: Date.now() + 30_000 },
      { classify: async () => ({ route: "MULTI_RETRIEVAL", standalone_query: "Compare leave policy and remote-work policy", profile_selector: "policy-docs", reason_code: "knowledge_lookup", confidence_bucket: "HIGH" }) },
      policy(),
      signal(),
    );
    expect(result.failClosed).toEqual({ reason: "multi_retrieval_unsupported" });
    expect(result.routeOutput).toBe("MULTI_RETRIEVAL");
    // The turn is denied outright — it must never be silently answered as a plain retrieval.
    expect(result.decision.route).toBe("CLARIFICATION_REQUIRED");
  });

  it("rejects MULTI_RETRIEVAL even when grounding_required enforcement would otherwise apply — the enforcement provenance (if any) still reaches the caller", async () => {
    const result = await classifyTurn(
      { text: "Compare our leave and remote-work policies", history: [], requestId: "req-1", turnId: "turn-1", deadlineAt: Date.now() + 30_000 },
      { classify: async () => ({ route: "MULTI_RETRIEVAL", standalone_query: "Compare leave and remote-work policies", profile_selector: "policy-docs", reason_code: "knowledge_lookup", confidence_bucket: "HIGH" }) },
      policy({ groundingRequired: true, defaultProfileSelector: "default" }),
      signal(),
    );
    expect(result.failClosed).toEqual({ reason: "multi_retrieval_unsupported" });
    expect(result.routeOutput).toBe("MULTI_RETRIEVAL");
  });

  it("CLARIFY always uses the policy-owned clarification text, never router-provided prose", async () => {
    const result = await classifyTurn(
      { text: "policy", history: [], requestId: "req-1", turnId: "turn-1", deadlineAt: Date.now() + 30_000 },
      { classify: async () => ({ route: "CLARIFY", standalone_query: "policy", reason_code: "ambiguous_intent", confidence_bucket: "MEDIUM", clarify_question: "router-injected prose that must be ignored" }) },
      policy({ clarificationText: "This is the policy-owned clarification text." }),
      signal(),
    );
    expect(result.decision.route).toBe("CLARIFICATION_REQUIRED");
    expect(result.decision.clarifyQuestion).toBe("This is the policy-owned clarification text.");
  });
});

describe("DevelopmentHeuristicTurnRouter", () => {
  it("routes enterprise/doc questions to SINGLE_RETRIEVAL and unrelated chat to NO_RETRIEVAL", async () => {
    const { DevelopmentHeuristicTurnRouter, looksLikeEnterpriseKnowledgeQuery } = await import("../src/router");
    expect(looksLikeEnterpriseKnowledgeQuery("What does the quarterly budget policy say?")).toBe(true);
    expect(looksLikeEnterpriseKnowledgeQuery("What is the capital of France?")).toBe(false);
    expect(looksLikeEnterpriseKnowledgeQuery("tell me a joke")).toBe(false);

    const router = new DevelopmentHeuristicTurnRouter();
    const knowledge = await router.classify({
      text: "What does the quarterly budget policy say?",
      history: [],
      requestId: "r1",
      turnId: "t1",
      deadlineAt: Date.now() + 30_000,
      routerModelRef: "default",
    }, signal());
    expect(knowledge).toMatchObject({ route: "SINGLE_RETRIEVAL", profile_selector: "default", reason_code: "knowledge_lookup" });

    const chat = await router.classify({
      text: "Write a short poem about coffee",
      history: [],
      requestId: "r2",
      turnId: "t2",
      deadlineAt: Date.now() + 30_000,
      routerModelRef: "default",
    }, signal());
    expect(chat).toMatchObject({ route: "NO_RETRIEVAL", reason_code: "conversational_smalltalk" });

    const viaClassify = await classifyTurn(
      { text: "Write a short poem about coffee", history: [], requestId: "req-h", turnId: "turn-h", deadlineAt: Date.now() + 30_000 },
      router,
      policy({ groundingRequired: false }),
      signal(),
    );
    expect(viaClassify.decision.route).toBe("GENERAL_CONVERSATION");
  });
});
