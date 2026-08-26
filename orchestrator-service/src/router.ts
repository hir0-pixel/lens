import type { TurnRoute } from "../../services/orchestrator/types";
import type { ModelGatewayAuthority } from "../../services/model-gateway/ModelGateway";
import type { RoutePolicyResult } from "./groundingPolicy";

export const MAX_ROUTER_QUERY_CHARS = 12_000;
const MAX_HISTORY_TURNS = 8;

export interface ConversationTurnRecord {
  role: "user" | "assistant";
  text: string;
}

/** The architecture's route output (Doc 004 §23). This — not the legacy TurnRoute vocabulary — is the router's actual wire contract. */
export type RouteOutput = "NO_RETRIEVAL" | "SINGLE_RETRIEVAL" | "MULTI_RETRIEVAL" | "CLARIFY";
export type ConfidenceBucket = "LOW" | "MEDIUM" | "HIGH";

const ROUTE_OUTPUTS: readonly RouteOutput[] = ["NO_RETRIEVAL", "SINGLE_RETRIEVAL", "MULTI_RETRIEVAL", "CLARIFY"];

/**
 * Capability metadata: the route outputs this deployment actually implements. MULTI_RETRIEVAL
 * is a member of the architecture-level RouteOutput union but is deliberately excluded here —
 * bounded multi-topic fan-out, per-candidate live authorization, and multi-source citation
 * lineage are not implemented (see classifyTurn's rejection below). This constant is the single
 * source of truth for that unsupported status: it is never advertised in the router prompt
 * (buildRouterPrompt in service.ts), any wire value outside it is rejected outright by
 * classifyTurn, and no readiness/product claim may assert MULTI_RETRIEVAL support while it is
 * absent from this set.
 */
export const SUPPORTED_ROUTE_OUTPUTS: ReadonlySet<RouteOutput> = new Set(["NO_RETRIEVAL", "SINGLE_RETRIEVAL", "CLARIFY"]);
const CONFIDENCE_BUCKETS: readonly ConfidenceBucket[] = ["LOW", "MEDIUM", "HIGH"];

/**
 * Versioned, bounded router reason-code enum. Free-form reason codes let a router model (or
 * a compromised/misbehaving one) put arbitrary text into Audit, lineage, and telemetry; every
 * reason code that reaches those surfaces — model-generated or internal fallback/enforcement —
 * must be a member of this set. Bumping ROUTER_REASON_CODE_SET_VERSION is a breaking wire-schema
 * change for the router prompt and every deployed router model.
 */
export const ROUTER_REASON_CODE_SET_VERSION = 1;

export const ROUTER_REASON_CODES = [
  // model-attempted reasons for the route it chose
  "no_retrieval_needed",
  "conversational_smalltalk",
  "clarification_needed",
  "ambiguous_intent",
  "knowledge_lookup",
  "followup_reference",
  "out_of_scope",
  "insufficient_context",
  // internal fast-path / fallback / enforcement reasons — never model-generated
  "unambiguous_acknowledgement",
  "router_unavailable",
  "router_unavailable_grounding_required",
  "grounding_default_unavailable",
  "grounding_required_override",
] as const;

export type RouterReasonCode = (typeof ROUTER_REASON_CODES)[number];
const ROUTER_REASON_CODE_SET: ReadonlySet<string> = new Set(ROUTER_REASON_CODES);

/** The router's actual wire schema. Nothing beyond these fields is ever trusted. */
export interface RouterWireDecision {
  route: RouteOutput;
  standaloneQuery: string;
  profileSelector?: string;
  reasonCode: RouterReasonCode;
  confidenceBucket: ConfidenceBucket;
}

export interface TurnRouterLLMPort {
  classify(
    input: {
      text: string;
      history: readonly ConversationTurnRecord[];
      requestId: string;
      turnId: string;
      deadlineAt: number;
      /** The exact platform-owned router model reference from the signed route policy — never the employee-selected model_ref. */
      routerModelRef: string;
      /** The router model's resolved artifact digest, the workflow Cost reservation it draws from, and this step's full receipt bundle — present only when the caller has already minted live model-use/cost/agent-step authorization for this exact dispatch (see `classifyRoute` in service.ts). A `TurnRouterLLMPort` that dispatches through `ModelGateway` requires all three; a caller that omits them gets whatever that implementation does when unauthorized (`GatewayTurnRouterLLMPort` throws). */
      artifactDigest?: `sha256:${string}`;
      workflowReservationRef?: string;
      authority?: ModelGatewayAuthority;
    },
    signal: AbortSignal,
  ): Promise<unknown>;
}

/** The legacy internal turn-routing vocabulary the rest of the Orchestrator (GROUNDING_ROUTES, service.ts's route switch) is built on. RouteOutput is mapped onto this at exactly one seam — see `toRouteDecision` below. */
export interface RouteDecision {
  route: TurnRoute;
  /** The text to use for retrieval/generation: the original input, or the router's standalone-query rewrite. */
  queryText: string;
  /** Set only for CLARIFICATION_REQUIRED. Always policy-owned text — CLARIFY never surfaces router prose. */
  clarifyQuestion?: string;
}

export interface RouteEnforcementProvenance {
  attemptedRoute: RouteOutput;
  attemptedReasonCode: RouterReasonCode;
  attemptedConfidenceBucket: ConfidenceBucket;
  attemptedProfileSelector?: string;
  overrideReason: "grounding_required_violation" | "grounding_default_unavailable";
}

export interface ClassifyTurnResult {
  decision: RouteDecision;
  /** The final architecture-level route actually acted on, after any enforcement override — for audit/lineage. */
  routeOutput: RouteOutput;
  profileSelector?: string;
  /** The effective (post-override) reason code and confidence bucket — always present, for full turn/audit lineage cross-checking even when no override occurred. */
  reasonCode: RouterReasonCode;
  confidenceBucket: ConfidenceBucket;
  /** Present only when the router's own (or fast-path) result was overridden because it violated a signed grounding requirement. */
  enforcement?: RouteEnforcementProvenance;
  /**
   * Present only when the signed route-policy revision defines no valid
   * default selector for this scope AND specifies FAIL_CLOSED behavior. The
   * caller must deny the turn outright rather than act on `decision`.
   */
  failClosed?: { reason: "grounding_default_unavailable" | "multi_retrieval_unsupported" };
}

const ACK_PHRASES = new Set([
  "ok", "okay", "k", "kk", "kk thanks", "thanks", "thank you", "thanks a lot",
  "thx", "ty", "np", "no problem", "got it", "gotcha", "cool", "great",
  "sounds good", "perfect", "alright", "sure", "yep", "yes", "noted",
  "understood", "will do", "makes sense", "appreciate it", "appreciated",
]);

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/[.!,;:]+$/g, "").trim();
}

/** Unambiguous, closed-set acknowledgements only. Anything with additional content falls through to routing. */
const GREETING_PHRASES = new Set(["hi", "hello", "hey", "good morning", "good afternoon", "good evening"]);

function isConversationalGreeting(text: string): boolean {
  const normalized = normalize(text);
  if (normalized.length === 0 || normalized.length > 24) return false;
  if (normalized.includes("?")) return false;
  return GREETING_PHRASES.has(normalized);
}

export function isUnambiguousAcknowledgement(text: string): boolean {
  const normalized = normalize(text);
  if (normalized.length === 0 || normalized.length > 24) return false;
  if (normalized.includes("?")) return false;
  return ACK_PHRASES.has(normalized);
}

/**
 * Development-only turn router used when the gateway LLM router is disabled.
 * Classifies enterprise/doc questions into SINGLE_RETRIEVAL and leaves greetings,
 * acknowledgements (handled upstream), and unrelated chat as NO_RETRIEVAL so
 * general conversation still works without forcing corpus grounding.
 */
export class DevelopmentHeuristicTurnRouter implements TurnRouterLLMPort {
  async classify(
    input: {
      text: string;
      history: readonly ConversationTurnRecord[];
      requestId: string;
      turnId: string;
      deadlineAt: number;
      routerModelRef: string;
    },
    _signal: AbortSignal,
  ): Promise<unknown> {
    const text = input.text.trim();
    if (looksLikeEnterpriseKnowledgeQuery(text)) {
      return {
        route: "SINGLE_RETRIEVAL",
        standalone_query: text.slice(0, MAX_ROUTER_QUERY_CHARS),
        profile_selector: "default",
        reason_code: "knowledge_lookup",
        confidence_bucket: "MEDIUM",
      };
    }
    return {
      route: "NO_RETRIEVAL",
      standalone_query: "",
      reason_code: "conversational_smalltalk",
      confidence_bucket: "MEDIUM",
    };
  }
}

/** Conservative: prefer retrieval for company/policy/doc phrasing; otherwise chat. */
export function looksLikeEnterpriseKnowledgeQuery(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (lower.length < 6) return false;
  if (/\b(policy|policies|handbook|procedure|budget|leave|expense|document|manual|guideline|spending|approval|approve|director|quarterly|stipend|remote.?work|corpus|ingested)\b/.test(lower)) {
    return true;
  }
  if (/\b(what does|according to|in the (doc|policy|handbook)|from the (doc|policy|handbook)|our (company|corp|enterprise))\b/.test(lower)) {
    return true;
  }
  return false;
}

/**
 * Validates and narrows the router LLM's structured output against the
 * exact Doc 004 §23 wire schema, including that any returned
 * `profile_selector` is a member of the policy's pre-scoped allowed set.
 * Returns undefined on ANY schema violation, including an out-of-set
 * selector or a LOW-confidence NO_RETRIEVAL (which is never trusted as a
 * valid result — see classifyTurn) — callers must fall back deterministically.
 */
function parseRouterWireDecision(raw: unknown, policy: RoutePolicyResult): RouterWireDecision | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;

  if (typeof record.route !== "string" || !(ROUTE_OUTPUTS as string[]).includes(record.route)) return undefined;
  const route = record.route as RouteOutput;

  // Bounded, versioned reason-code enum: an unknown value (including any model-invented
  // string) is rejected as a schema violation, exactly like an out-of-set profile selector —
  // callers fall back deterministically, never pass it through to Audit/lineage/telemetry.
  if (typeof record.reason_code !== "string" || !ROUTER_REASON_CODE_SET.has(record.reason_code.trim())) return undefined;
  const reasonCode = record.reason_code.trim() as RouterReasonCode;

  if (typeof record.confidence_bucket !== "string" || !(CONFIDENCE_BUCKETS as string[]).includes(record.confidence_bucket)) return undefined;
  const confidenceBucket = record.confidence_bucket as ConfidenceBucket;

  if (typeof record.standalone_query !== "string" || record.standalone_query.length > MAX_ROUTER_QUERY_CHARS) return undefined;
  const standaloneQuery = record.standalone_query.trim();

  if (route === "SINGLE_RETRIEVAL" || route === "MULTI_RETRIEVAL") {
    if (standaloneQuery.length === 0) return undefined;
    if (typeof record.profile_selector !== "string" || !policy.allowedProfileSelectors.includes(record.profile_selector)) {
      // Out-of-set (or missing) selector: reject outright, never map to a retrieval_profile_ref.
      return undefined;
    }
    return { route, standaloneQuery, profileSelector: record.profile_selector, reasonCode, confidenceBucket };
  }

  // A schema-valid, LOW-confidence NO_RETRIEVAL is never trusted as a real result.
  if (route === "NO_RETRIEVAL" && confidenceBucket === "LOW") return undefined;

  return { route, standaloneQuery, reasonCode, confidenceBucket };
}

/**
 * The deterministic failure-mode fallback (Doc 004 item 17 / §23): used when
 * no LLM router is configured, the router call fails, times out, is denied
 * admission/budget, or its output fails schema validation (including an
 * out-of-set selector or an untrusted LOW-confidence NO_RETRIEVAL). This is
 * NOT the same code path as the grounding-required enforcement override
 * below — there is no "attempted" router result to record provenance for,
 * because the router never produced a usable one.
 */
function failureModeFallback(policy: RoutePolicyResult): RouterWireDecision | { failClosed: true } {
  if (!policy.groundingRequired) {
    return { route: "CLARIFY", standaloneQuery: "", reasonCode: "router_unavailable", confidenceBucket: "LOW" };
  }
  if (policy.defaultProfileSelector) {
    return {
      route: "SINGLE_RETRIEVAL",
      standaloneQuery: "",
      profileSelector: policy.defaultProfileSelector,
      reasonCode: "router_unavailable_grounding_required",
      confidenceBucket: "LOW",
    };
  }
  if (policy.noDefaultSelectorBehavior === "CLARIFY") {
    return { route: "CLARIFY", standaloneQuery: "", reasonCode: "grounding_default_unavailable", confidenceBucket: "LOW" };
  }
  return { failClosed: true };
}

/**
 * Grounding-required enforcement (Doc 004 §23): prevention, not detection.
 * Applied to EVERY router result — including the deterministic
 * acknowledgement fast path, which is itself just a confident, schema-valid
 * NO_RETRIEVAL by another name — before it is acted on. Untrusted router
 * output (or a fast-path heuristic) can never weaken a server-owned
 * `grounding_required=true`.
 */
function enforceGroundingRequirement(
  attempted: RouterWireDecision,
  policy: RoutePolicyResult,
): { decision: RouterWireDecision; enforcement?: RouteEnforcementProvenance } | { failClosed: true; enforcement: RouteEnforcementProvenance } {
  if (!policy.groundingRequired || attempted.route !== "NO_RETRIEVAL") {
    return { decision: attempted };
  }
  const provenance = (overrideReason: RouteEnforcementProvenance["overrideReason"]): RouteEnforcementProvenance => ({
    attemptedRoute: attempted.route,
    attemptedReasonCode: attempted.reasonCode,
    attemptedConfidenceBucket: attempted.confidenceBucket,
    attemptedProfileSelector: attempted.profileSelector,
    overrideReason,
  });
  if (policy.defaultProfileSelector) {
    return {
      decision: {
        route: "SINGLE_RETRIEVAL",
        standaloneQuery: attempted.standaloneQuery,
        profileSelector: policy.defaultProfileSelector,
        reasonCode: "grounding_required_override",
        confidenceBucket: attempted.confidenceBucket,
      },
      enforcement: provenance("grounding_required_violation"),
    };
  }
  if (policy.noDefaultSelectorBehavior === "CLARIFY") {
    return {
      decision: { route: "CLARIFY", standaloneQuery: attempted.standaloneQuery, reasonCode: "grounding_default_unavailable", confidenceBucket: attempted.confidenceBucket },
      enforcement: provenance("grounding_default_unavailable"),
    };
  }
  return { failClosed: true, enforcement: provenance("grounding_default_unavailable") };
}

/** The one seam that maps the architecture's RouteOutput onto the legacy TurnRoute vocabulary the rest of the Orchestrator is built on. */
function toRouteDecision(
  wire: RouterWireDecision,
  originalText: string,
  historyLength: number,
  wasFastPathAcknowledgement: boolean,
  policy: RoutePolicyResult,
): RouteDecision {
  const queryText = wire.standaloneQuery.length > 0 ? wire.standaloneQuery : originalText.trim();
  switch (wire.route) {
    case "NO_RETRIEVAL":
      return wasFastPathAcknowledgement
        ? { route: "ACKNOWLEDGEMENT", queryText }
        : { route: "GENERAL_CONVERSATION", queryText };
    case "SINGLE_RETRIEVAL":
      return historyLength > 0
        ? { route: "CONTEXTUAL_FOLLOW_UP", queryText }
        : { route: "KNOWLEDGE_QUERY", queryText };
    case "CLARIFY":
      // Never router prose (Doc 004 §11): the clarification text is always policy-owned.
      return { route: "CLARIFICATION_REQUIRED", queryText, clarifyQuestion: policy.clarificationText };
    case "MULTI_RETRIEVAL":
      // classifyTurn rejects MULTI_RETRIEVAL as unsupported before this
      // function is ever reached (bounded fan-out is not implemented) — this
      // branch exists only so the switch stays exhaustive under the
      // architecture's RouteOutput union.
      throw new Error("MULTI_RETRIEVAL must be rejected before toRouteDecision — this indicates a router.ts bug, not a runtime condition.");
  }
}

export async function classifyTurn(
  input: {
    text: string;
    history: readonly ConversationTurnRecord[];
    requestId: string;
    turnId: string;
    deadlineAt: number;
    artifactDigest?: `sha256:${string}`;
    workflowReservationRef?: string;
    authority?: ModelGatewayAuthority;
  },
  llm: TurnRouterLLMPort | undefined,
  policy: RoutePolicyResult,
  signal: AbortSignal,
): Promise<ClassifyTurnResult> {
  const boundedHistory = input.history.slice(-MAX_HISTORY_TURNS);
  const historyLength = boundedHistory.length;

  let attempted: RouterWireDecision | { failClosed: true };
  let wasFastPathAcknowledgement = false;

  if (isUnambiguousAcknowledgement(input.text)) {
    wasFastPathAcknowledgement = true;
    attempted = { route: "NO_RETRIEVAL", standaloneQuery: "", reasonCode: "unambiguous_acknowledgement", confidenceBucket: "HIGH" };
  } else if (isConversationalGreeting(input.text)) {
    attempted = { route: "NO_RETRIEVAL", standaloneQuery: "", reasonCode: "conversational_smalltalk", confidenceBucket: "HIGH" };
  } else if (llm) {
    let parsed: RouterWireDecision | undefined;
    try {
      const raw = await llm.classify({ text: input.text, history: boundedHistory, requestId: input.requestId, turnId: input.turnId, deadlineAt: input.deadlineAt, routerModelRef: policy.routerModelRef, artifactDigest: input.artifactDigest, workflowReservationRef: input.workflowReservationRef, authority: input.authority }, signal);
      parsed = parseRouterWireDecision(raw, policy);
    } catch {
      parsed = undefined;
    }
    attempted = parsed ?? failureModeFallback(policy);
  } else {
    attempted = failureModeFallback(policy);
  }

  if ("failClosed" in attempted) {
    return {
      decision: { route: "CLARIFICATION_REQUIRED", queryText: input.text.trim(), clarifyQuestion: policy.clarificationText },
      routeOutput: "CLARIFY",
      reasonCode: "grounding_default_unavailable",
      confidenceBucket: "LOW",
      failClosed: { reason: "grounding_default_unavailable" },
    };
  }

  const enforced = enforceGroundingRequirement(attempted, policy);
  if ("failClosed" in enforced) {
    return {
      decision: { route: "CLARIFICATION_REQUIRED", queryText: input.text.trim(), clarifyQuestion: policy.clarificationText },
      routeOutput: "CLARIFY",
      reasonCode: "grounding_default_unavailable",
      confidenceBucket: "LOW",
      enforcement: enforced.enforcement,
      failClosed: { reason: "grounding_default_unavailable" },
    };
  }

  const finalWire = enforced.decision;

  // MULTI_RETRIEVAL requires bounded query/profile fan-out, per-candidate
  // live authorization, deterministic dedup/fusion, and exact multi-source
  // citation lineage — none of which Retrieval implements today. Rather than
  // silently execute it as a single retrieval (a different route with
  // different guarantees, misreported as MULTI_RETRIEVAL for audit/lineage
  // purposes), production rejects the turn outright as unsupported.
  if (finalWire.route === "MULTI_RETRIEVAL" || !SUPPORTED_ROUTE_OUTPUTS.has(finalWire.route)) {
    return {
      decision: { route: "CLARIFICATION_REQUIRED", queryText: input.text.trim(), clarifyQuestion: policy.clarificationText },
      routeOutput: "MULTI_RETRIEVAL",
      profileSelector: finalWire.profileSelector,
      reasonCode: finalWire.reasonCode,
      confidenceBucket: finalWire.confidenceBucket,
      enforcement: enforced.enforcement,
      failClosed: { reason: "multi_retrieval_unsupported" },
    };
  }

  return {
    decision: toRouteDecision(finalWire, input.text, historyLength, wasFastPathAcknowledgement && !enforced.enforcement, policy),
    routeOutput: finalWire.route,
    profileSelector: finalWire.profileSelector,
    reasonCode: finalWire.reasonCode,
    confidenceBucket: finalWire.confidenceBucket,
    enforcement: enforced.enforcement,
  };
}
