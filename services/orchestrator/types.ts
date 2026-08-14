export type OrchestratorState =
  | "RECEIVED"
  | "AUTHORIZED"
  | "TURN_INTENT_COMMITTED"
  | "CONTEXT_RESOLVED"
  | "AGENT_RUN_ADMITTED"
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

export interface ChatRequest {
  requestId: string;
  subjectRef: string;
  deviceRef: string;
  conversationRef: string;
  inputDigest: `sha256:${string}`;
  idempotencyKey?: string;
  deadlineAt: number;
  requireGroundedContext: boolean;
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
  stepFence: string;
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
  resolveContext(request: ChatRequest, turn: TurnIntent, signal: AbortSignal): Promise<ContextManifest>;
  authorizeContextUse(request: ChatRequest, context: ContextManifest, signal: AbortSignal): Promise<void>;
  reserveBudget(request: ChatRequest, context: ContextManifest, signal: AbortSignal): Promise<string>;
  beginAgentRun(request: ChatRequest, budgetRef: string, signal: AbortSignal): Promise<AgentRun>;
  admitAudit(kind: "generation" | "release", request: ChatRequest, turn: TurnIntent, signal: AbortSignal): Promise<string>;
  generate(input: { request: ChatRequest; context: ContextManifest; run: AgentRun; budgetRef: string }, signal: AbortSignal): AsyncIterable<string>;
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
