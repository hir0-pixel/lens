export type OrchestratorState =
  | "RECEIVED"
  | "AUTHORIZED"
  | "TURN_INTENT_COMMITTED"
  | "AGENT_RUN_ADMITTED"
  | "ROUTE_CLASSIFIED"
  | "CONTEXT_RESOLVED"
  | "OUTPUT_AUDIT_ADMITTED"
  | "GENERATING"
  | "AGENT_RUN_CLOSED"
  | "FINALIZING"
  | "COMPLETED"
  | "CANCELLED"
  | "DENIED"
  | "FAILED";

export type OrchestratorFailureCode =
  | "FORBIDDEN"
  | "CANCELLED"
  | "DEADLINE_EXCEEDED"
  | "OVERLOADED"
  | "DEPENDENCY_UNAVAILABLE"
  | "EVIDENCE_REQUIRED";

export class OrchestratorError extends Error {
  constructor(readonly code: OrchestratorFailureCode, message: string) {
    super(message);
  }
}

/**
 * TOOL_ACTION is intentionally not a member: the router's wire contract (`RouteOutput` in
 * orchestrator-service/src/router.ts) never produces it, so it is unsupported, not merely
 * unimplemented. Advertise it nowhere; if a governed tool-call capability is built, it must
 * route through the existing tool controller and be added here deliberately.
 */
export type TurnRoute =
  | "ACKNOWLEDGEMENT"
  | "GENERAL_CONVERSATION"
  | "KNOWLEDGE_QUERY"
  | "CONTEXTUAL_FOLLOW_UP"
  | "CLARIFICATION_REQUIRED";

/** Routes that resolve grounded context via Retrieval; every other route skips it entirely. */
export const GROUNDING_ROUTES: ReadonlySet<TurnRoute> = new Set(["KNOWLEDGE_QUERY", "CONTEXTUAL_FOLLOW_UP"]);

export interface ChatRequest {
  requestId: string;
  subjectRef: string;
  deviceRef: string;
  conversationRef: string;
  inputDigest: `sha256:${string}`;
  idempotencyKey?: string;
  deadlineAt: number;
}

/**
 * Result of the authorized in-workflow router-classification step. Routes are no longer an
 * input to `execute` -- they are produced by `classifyRoute`, which runs after `authorizeGenerate`
 * and `beginAgentRun` so the router's own model dispatch is itself an admitted, budgeted step.
 */
export interface RouteClassification {
  route: TurnRoute;
}

export interface TurnIntent {
  turnId: string;
  sequence: number;
}

export interface ContextManifest {
  digest: `sha256:${string}`;
  noContext: boolean;
}

export interface AgentRun {
  runId: string;
  envelopeRevision: number;
}

export interface StagedOutput {
  outputRef: string;
  outputDigest: `sha256:${string}`;
  commitProof: string;
}

export interface DisclosureReservation {
  reservationRef: string;
  classificationRef: string;
}

export interface ReleaseAuthorization {
  releaseFence: string;
  obligations: readonly string[];
}

export interface OrchestratorDependencies {
  authorizeGenerate(request: ChatRequest, signal: AbortSignal): Promise<void>;
  beginTurn(request: ChatRequest, signal: AbortSignal): Promise<TurnIntent>;
  /** Creates the single, authoritative whole-workflow Cost reservation. Nothing economic happens before this. */
  reserveWorkflowBudget(request: ChatRequest, turn: TurnIntent, signal: AbortSignal): Promise<string>;
  beginAgentRun(request: ChatRequest, turn: TurnIntent, workflowReservationRef: string, signal: AbortSignal): Promise<AgentRun>;
  /**
   * The router-classification step, run as the first admitted model step of the authorized
   * workflow: fresh AuthorizeModelUse(router_model_ref), route Cost sub-envelope consumption,
   * an Agent-step reservation, a Scheduler fence, dispatch, grounding-required enforcement, and
   * durable audit of any override all happen inside this call.
   */
  classifyRoute(
    request: ChatRequest,
    turn: TurnIntent,
    run: AgentRun,
    workflowReservationRef: string,
    signal: AbortSignal,
  ): Promise<RouteClassification>;
  resolveContext(request: ChatRequest, turn: TurnIntent, route: RouteClassification, signal: AbortSignal): Promise<ContextManifest>;
  authorizeContextUse(request: ChatRequest, context: ContextManifest, signal: AbortSignal): Promise<void>;
  admitAudit(kind: "generation" | "release", request: ChatRequest, turn: TurnIntent, signal: AbortSignal): Promise<string>;
  generate(
    input: {
      request: ChatRequest;
      context: ContextManifest;
      run: AgentRun;
      workflowReservationRef: string;
      route: RouteClassification;
    },
    signal: AbortSignal,
  ): AsyncIterable<string>;
  closeAgentRun(run: AgentRun, signal: AbortSignal): Promise<string>;
  stageOutput(turn: TurnIntent, output: string, runCloseReceipt: string, signal: AbortSignal): Promise<StagedOutput>;
  reserveDisclosure(request: ChatRequest, staged: StagedOutput, runCloseReceipt: string, signal: AbortSignal): Promise<DisclosureReservation>;
  authorizeOutput(request: ChatRequest, staged: StagedOutput, reservation: DisclosureReservation, signal: AbortSignal): Promise<ReleaseAuthorization>;
  finalizeTurn(turn: TurnIntent, staged: StagedOutput, release: ReleaseAuthorization, releaseAuditReceipt: string, signal: AbortSignal): Promise<void>;
  commitDisclosure(reservation: DisclosureReservation, staged: StagedOutput, release: ReleaseAuthorization, signal: AbortSignal): Promise<void>;
  failTurn?(turn: TurnIntent, code: OrchestratorFailureCode): Promise<void>;
}

export interface SafeTurnStatus {
  requestId: string;
  turnId?: string;
  state: OrchestratorState;
  code?: OrchestratorFailureCode;
}

export type OrchestratorResult =
  | { status: SafeTurnStatus; output: string; outputDigest: `sha256:${string}` }
  | { status: SafeTurnStatus };
