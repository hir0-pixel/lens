/**
 * Doc 012 per-serving-cell RuntimeAttemptStore. Status is read from this store only —
 * never inferred from sockets. ACCEPTED_NOT_CONTACTED is persisted before any runtime
 * contact is possible; CONTACT_INTENT_COMMITTED is the last write before a request byte
 * may leave the cell. Unresolved contacted states become OUTCOME_UNKNOWN and are never
 * automatically replayed. At most one accepted attempt exists per reservation_id.
 */
export const RUNTIME_ATTEMPT_STATES = [
  "ACCEPTED_NOT_CONTACTED",
  "CONTACT_INTENT_COMMITTED",
  "RUNTIME_STARTED",
  "STREAMING",
  "CANCEL_REQUESTED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "NOT_STARTED",
  "OUTCOME_UNKNOWN",
] as const;

export type RuntimeAttemptState = (typeof RUNTIME_ATTEMPT_STATES)[number];

export const LEGAL_ATTEMPT_TRANSITIONS: Record<RuntimeAttemptState, readonly RuntimeAttemptState[]> = {
  ACCEPTED_NOT_CONTACTED: ["CONTACT_INTENT_COMMITTED", "NOT_STARTED", "FAILED", "CANCELLED"],
  CONTACT_INTENT_COMMITTED: ["RUNTIME_STARTED", "OUTCOME_UNKNOWN", "CANCEL_REQUESTED", "FAILED"],
  RUNTIME_STARTED: ["STREAMING", "COMPLETED", "FAILED", "CANCELLED", "CANCEL_REQUESTED", "OUTCOME_UNKNOWN"],
  STREAMING: ["STREAMING", "COMPLETED", "FAILED", "CANCELLED", "CANCEL_REQUESTED", "OUTCOME_UNKNOWN"],
  CANCEL_REQUESTED: ["CANCELLED", "OUTCOME_UNKNOWN", "FAILED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  NOT_STARTED: [],
  OUTCOME_UNKNOWN: [],
};

export class RuntimeAttemptError extends Error {
  constructor(readonly code: "CONFLICT" | "NOT_FOUND" | "FORBIDDEN" | "UNAVAILABLE", message: string) {
    super(message);
  }
}

export interface AcceptAttemptInput {
  reservationId: string;
  logicalAttemptId: string;
  attemptGeneration: number;
  requestId: string;
  turnId: string;
  stepId: string;
  requestDigest: string;
  modelRef: string;
  artifactDigest: `sha256:${string}`;
  endpointGeneration: string;
  deadlineAt: number;
}

export interface BeginDispatchAttemptInput {
  logicalAttemptId: string;
  requestId: string;
  turnId: string;
  stepId: string;
  requestDigest: string;
  modelRef: string;
  artifactDigest: `sha256:${string}`;
  endpointGeneration: string;
  deadlineAt: number;
}

export interface SchedulerLeaseBinding {
  fence: number;
  endpointRef: string;
  endpointGeneration: string;
  requestDigest: string;
  expiresAt: number;
  leaseToken?: string;
}

export interface RuntimeAttemptRecord {
  reservationId: string;
  logicalAttemptId?: string;
  attemptGeneration?: number;
  requestId: string;
  turnId: string;
  stepId: string;
  requestDigest: string;
  modelRef: string;
  artifactDigest: string;
  endpointGeneration: string;
  endpointRef?: string;
  leaseExpiresAt?: number;
  state: RuntimeAttemptState;
  fence: number;
  contactIntentCommitted: boolean;
  usageEventId?: string;
  usageSignature?: string;
  generatedTokens?: number;
}

export interface RuntimeAttemptStore {
  allocateGeneration(logicalAttemptId: string): Promise<number>;
  listLogicalAttempts(logicalAttemptId: string): Promise<RuntimeAttemptRecord[]>;
  /**
   * Atomically (re)validates prior attempts, allocates the next generation, and durably
   * creates the new attempt in one transaction. This is the durable uniqueness contract:
   * a new generation is created only when every prior attempt is explicitly pre-contact
   * NOT_STARTED (never OUTCOME_UNKNOWN, never a contacted/terminal attempt). Concurrent
   * callers racing the same retry serialize here — exactly one creates an attempt; the
   * rest receive a FORBIDDEN/CONFLICT error and never contact the runtime.
   */
  beginDispatchAttempt(input: BeginDispatchAttemptInput): Promise<RuntimeAttemptRecord>;
  accept(input: AcceptAttemptInput): Promise<RuntimeAttemptRecord>;
  bindSchedulerLease(reservationId: string, lease: SchedulerLeaseBinding): Promise<RuntimeAttemptRecord>;
  commitContactIntent(reservationId: string): Promise<RuntimeAttemptRecord>;
  transitionTo(reservationId: string, to: RuntimeAttemptState): Promise<RuntimeAttemptRecord>;
  markNotStarted(reservationId: string, proofNoContact: true): Promise<RuntimeAttemptRecord>;
  markOutcomeUnknown(reservationId: string): Promise<RuntimeAttemptRecord>;
  completeWithUsage(reservationId: string, usage: { usageEventId: string; generatedTokens: number; signature: string; terminal: "COMPLETED" | "FAILED" | "CANCELLED" }): Promise<RuntimeAttemptRecord>;
  reconcileExpired(now: number): Promise<number>;
  getAttemptStatus(reservationId: string): Promise<RuntimeAttemptRecord>;
}

export function isTerminalAttempt(state: RuntimeAttemptState): boolean {
  return state === "COMPLETED" || state === "FAILED" || state === "CANCELLED" || state === "NOT_STARTED" || state === "OUTCOME_UNKNOWN";
}

export class FailClosedRuntimeAttemptStore implements RuntimeAttemptStore {
  async allocateGeneration(): Promise<never> { throw new RuntimeAttemptError("UNAVAILABLE", ""); }
  async listLogicalAttempts(): Promise<never> { throw new RuntimeAttemptError("UNAVAILABLE", ""); }
  async beginDispatchAttempt(): Promise<never> { throw new RuntimeAttemptError("UNAVAILABLE", "RuntimeAttemptStore is unavailable."); }
  async accept(): Promise<never> { throw new RuntimeAttemptError("UNAVAILABLE", ""); }
  async bindSchedulerLease(): Promise<never> { throw new RuntimeAttemptError("UNAVAILABLE", "RuntimeAttemptStore is unavailable."); }
  async commitContactIntent(): Promise<never> { throw new RuntimeAttemptError("UNAVAILABLE", "RuntimeAttemptStore is unavailable."); }
  async transitionTo(): Promise<never> { throw new RuntimeAttemptError("UNAVAILABLE", "RuntimeAttemptStore is unavailable."); }
  async markNotStarted(): Promise<never> { throw new RuntimeAttemptError("UNAVAILABLE", "RuntimeAttemptStore is unavailable."); }
  async markOutcomeUnknown(): Promise<never> { throw new RuntimeAttemptError("UNAVAILABLE", "RuntimeAttemptStore is unavailable."); }
  async completeWithUsage(): Promise<never> { throw new RuntimeAttemptError("UNAVAILABLE", "RuntimeAttemptStore is unavailable."); }
  async reconcileExpired(): Promise<never> { throw new RuntimeAttemptError("UNAVAILABLE", "RuntimeAttemptStore is unavailable."); }
  async getAttemptStatus(): Promise<never> { throw new RuntimeAttemptError("UNAVAILABLE", "RuntimeAttemptStore is unavailable."); }
}

export const RUNTIME_ATTEMPT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS runtime_attempt_generations (
    logical_attempt_id TEXT PRIMARY KEY,
    next_generation INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS runtime_attempts (
    reservation_id TEXT PRIMARY KEY,
    logical_attempt_id TEXT NOT NULL DEFAULT '',
    attempt_generation INTEGER NOT NULL DEFAULT 0,
    request_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    model_ref TEXT NOT NULL,
    artifact_digest TEXT NOT NULL,
    endpoint_generation TEXT NOT NULL,
    endpoint_ref TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL,
    fence INTEGER NOT NULL,
    contact_intent INTEGER NOT NULL DEFAULT 0,
    usage_event_id TEXT,
    usage_signature TEXT,
    generated_tokens INTEGER,
    deadline_at BIGINT NOT NULL,
    lease_expires_at BIGINT NOT NULL DEFAULT 0,
    UNIQUE (logical_attempt_id, attempt_generation)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS runtime_attempts_usage_event ON runtime_attempts (usage_event_id) WHERE usage_event_id IS NOT NULL;
`;
