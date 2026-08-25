/**
 * The Doc 014 Agent-run/step authority as a real port: `BeginAgentRun` opens one run per turn;
 * `ReserveAgentStep` issues a signed, one-use `agent_step` receipt for exactly one route/
 * final-generation/tool step, bound to its step class/index, exact model_ref/artifactDigest,
 * the workflow reservation and sub-envelope it draws from, its deadline, and the policy/model
 * authorization decision digests that admitted it; `ConsumeAgentStep`/`FinalizeAgentStep`
 * record the step's durable lifecycle; `CloseAgentRun`/`GetAgentRunStatus` close out and
 * report the run. `ModelGateway` verifies the `agent_step` receipt itself (signature, purpose,
 * exact field match, expiry) and claims its `receiptId` exactly once in the shared
 * `ClaimStore` before dispatch — this authority's own step-state table is the durable Doc 014
 * lifecycle record, a second, independent guarantee, not a substitute for that claim.
 */
import type { SignedAuthorityReceipt } from "../security/authorityReceipt";
import type { AgentStepClass, SubEnvelopeClass } from "../security/authorityReceipt";

export class AgentRunAuthorityError extends Error {
  constructor(readonly code: "NOT_FOUND" | "CONFLICT" | "FORBIDDEN" | "STALE_AUTHORITY" | "UNAVAILABLE", message: string) {
    super(message);
  }
}

export interface BeginAgentRunInput {
  requestId: string;
  turnId: string;
  runId: string;
  workflowReservationRef: string;
  /** Digest of the signed workflow profile (route policy revision/digest, model catalog snapshot, etc.) this run was admitted under. */
  workflowProfileDigest: `sha256:${string}`;
  idempotencyKey: string;
  expiresAt: number;
}

export interface ReserveAgentStepInput {
  runId: string;
  requestId: string;
  turnId: string;
  stepId: string;
  stepClass: AgentStepClass;
  stepIndex: number;
  modelRef: string;
  artifactDigest: `sha256:${string}`;
  capability: string;
  workflowReservationRef: string;
  subEnvelope: SubEnvelopeClass;
  /** Digest of the PDP AuthorizeModelUse decision that admitted this step — binds the step receipt to that specific decision, not just "some" authorization happened. */
  modelAuthorizationDigest: `sha256:${string}`;
  idempotencyKey: string;
  deadlineAt: number;
}

export interface AgentStepStatus {
  stepId: string;
  stepClass: AgentStepClass;
  stepIndex: number;
  state: "RESERVED" | "CONSUMED" | "FINALIZED";
  receiptId: string;
}

export interface AgentRunStatus {
  runId: string;
  requestId: string;
  turnId: string;
  state: "OPEN" | "CLOSED";
  envelopeRevision: number;
  steps: readonly AgentStepStatus[];
}

export interface AgentRunAuthorityPort {
  beginAgentRun(input: BeginAgentRunInput, signal: AbortSignal): Promise<{ runId: string; envelopeRevision: number }>;
  reserveAgentStep(input: ReserveAgentStepInput, signal: AbortSignal): Promise<SignedAuthorityReceipt>;
  consumeAgentStep(runId: string, stepId: string, receiptId: string, signal: AbortSignal): Promise<void>;
  finalizeAgentStep(runId: string, stepId: string, signal: AbortSignal): Promise<void>;
  closeAgentRun(runId: string, signal: AbortSignal): Promise<void>;
  getAgentRunStatus(runId: string, signal: AbortSignal): Promise<AgentRunStatus>;
}

/** Production default when no real Agent-run authority is wired: fails closed on every operation. */
export class FailClosedAgentRunAuthority implements AgentRunAuthorityPort {
  async beginAgentRun(): Promise<{ runId: string; envelopeRevision: number }> {
    throw new AgentRunAuthorityError("UNAVAILABLE", "No Agent-run authority is configured.");
  }
  async reserveAgentStep(): Promise<SignedAuthorityReceipt> {
    throw new AgentRunAuthorityError("UNAVAILABLE", "No Agent-run authority is configured.");
  }
  async consumeAgentStep(): Promise<void> {
    throw new AgentRunAuthorityError("UNAVAILABLE", "No Agent-run authority is configured.");
  }
  async finalizeAgentStep(): Promise<void> {
    throw new AgentRunAuthorityError("UNAVAILABLE", "No Agent-run authority is configured.");
  }
  async closeAgentRun(): Promise<void> {
    throw new AgentRunAuthorityError("UNAVAILABLE", "No Agent-run authority is configured.");
  }
  async getAgentRunStatus(): Promise<AgentRunStatus> {
    throw new AgentRunAuthorityError("UNAVAILABLE", "No Agent-run authority is configured.");
  }
}
