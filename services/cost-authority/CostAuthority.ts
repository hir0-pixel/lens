/**
 * The Doc 019 Cost owner as a real port: one whole-workflow reservation per turn, with four
 * non-interchangeable sub-envelopes (`route`, `retrieval`, `final_generation`, `tool`) that
 * cannot borrow from one another. `ModelGateway` verifies a `cost_sub_envelope_consumption`
 * receipt from `consumeSubEnvelope` before every dispatch — a process-local ledger cannot
 * issue those receipts honestly for more than one process, which is exactly why production
 * must use `SqliteCostAuthority` (or a real network client to an equivalent service), never
 * `services/cost-controller/CostController.ts`.
 */
import type { SignedAuthorityReceipt } from "../security/authorityReceipt";

export type SubEnvelopeClass = "route" | "retrieval" | "final_generation" | "tool";
export const SUB_ENVELOPE_CLASSES: readonly SubEnvelopeClass[] = ["route", "retrieval", "final_generation", "tool"];

export class CostAuthorityError extends Error {
  constructor(readonly code: "CONFLICT" | "FORBIDDEN" | "OVERSPEND" | "NOT_FOUND" | "STALE_AUTHORITY" | "UNAVAILABLE", message: string) {
    super(message);
  }
}

export interface SubEnvelopeLimits {
  maximumUnits: number;
}

export interface ReserveWorkflowBudgetInput {
  requestId: string;
  turnId: string;
  reservationRef: string;
  idempotencyKey: string;
  subEnvelopes: Record<SubEnvelopeClass, SubEnvelopeLimits>;
  expiresAt: number;
  workflowProfileDigest?: `sha256:${string}`;
}

export interface ConsumeSubEnvelopeInput {
  reservationRef: string;
  subEnvelope: SubEnvelopeClass;
  units: number;
  requestId: string;
  turnId: string;
  stepId: string;
  idempotencyKey: string;
  expiresAt: number;
}

export interface FinalizeSubEnvelopeInput {
  reservationRef: string;
  subEnvelope: SubEnvelopeClass;
  measuredUnits: number;
  idempotencyKey: string;
}

export interface SubEnvelopeStatus {
  maximumUnits: number;
  consumedUnits: number;
  state: "OPEN" | "FINALIZED";
  expiresAt: number;
}

export interface WorkflowBudgetStatus {
  reservationRef: string;
  requestId: string;
  turnId: string;
  state: "OPEN" | "CLOSED";
  revision: number;
  subEnvelopes: Record<SubEnvelopeClass, SubEnvelopeStatus>;
}

export interface CostAuthorityPort {
  reserveWorkflowBudget(input: ReserveWorkflowBudgetInput, signal: AbortSignal): Promise<{ reservationRef: string; revision: number }>;
  consumeSubEnvelope(input: ConsumeSubEnvelopeInput, signal: AbortSignal): Promise<SignedAuthorityReceipt>;
  finalizeSubEnvelope(input: FinalizeSubEnvelopeInput, signal: AbortSignal): Promise<void>;
  closeWorkflowBudget(reservationRef: string, signal: AbortSignal): Promise<void>;
  getWorkflowBudgetStatus(reservationRef: string, signal: AbortSignal): Promise<WorkflowBudgetStatus>;
}

/** Production default when no real Cost authority is wired: fails closed on every operation. */
export class FailClosedCostAuthority implements CostAuthorityPort {
  async reserveWorkflowBudget(): Promise<{ reservationRef: string; revision: number }> {
    throw new CostAuthorityError("UNAVAILABLE", "No Cost authority is configured.");
  }
  async consumeSubEnvelope(): Promise<SignedAuthorityReceipt> {
    throw new CostAuthorityError("UNAVAILABLE", "No Cost authority is configured.");
  }
  async finalizeSubEnvelope(): Promise<void> {
    throw new CostAuthorityError("UNAVAILABLE", "No Cost authority is configured.");
  }
  async closeWorkflowBudget(): Promise<void> {
    throw new CostAuthorityError("UNAVAILABLE", "No Cost authority is configured.");
  }
  async getWorkflowBudgetStatus(): Promise<WorkflowBudgetStatus> {
    throw new CostAuthorityError("UNAVAILABLE", "No Cost authority is configured.");
  }
}
