import { createHash } from "node:crypto";
import type { ReceiptVerifier } from "../security/authorityReceipt";
import type { ClaimStore } from "../security/replayClaimStore";
import type { RuntimeAttemptStore } from "../runtime-attempt/RuntimeAttemptStore";
import { RuntimeAttemptError } from "../runtime-attempt/RuntimeAttemptStore";

export class ModelGatewayError extends Error { constructor(readonly code: "FORBIDDEN" | "OVERLOADED" | "STALE_AUTHORITY" | "CANCELLED" | "DEPENDENCY_UNAVAILABLE") { super(code); } }
export interface ModelEligibilityPort { resolve(input: { capability: string; artifactDigest: string; denyEpoch: number }): Promise<{ endpointRef: string; snapshotExpiresAt: number; external: boolean; endpointGeneration?: string }>; }
export interface SchedulerReservation {
  reservationId: string;
  requestDigest: string;
  endpointRef: string;
  endpointGeneration: string;
  fence: number;
  expiresAt: number;
  leaseToken: string;
}
export interface SchedulerPort {
  reserve(input: {
    reservationId: string;
    requestId: string;
    turnId: string;
    stepId: string;
    requestDigest: string;
    modelRef: string;
    artifactDigest: `sha256:${string}`;
    endpointRef: string;
    endpointGeneration: string;
    expiresAt: number;
  }): Promise<SchedulerReservation>;
  start(reservationId: string, requestDigest: string, fence: number): Promise<void>;
  release(reservationId: string, fence: number): Promise<void>;
}
/**
 * The full typed sidecar usage receipt. Every field is required (no silent
 * zero/empty defaults) so a dropped or tampered value fails type-checking and
 * is rejected rather than settled as a blank. The shape mirrors `SidecarUsagePayload`
 * exactly so `verifySidecarUsage` can re-check the signed bound values end to end.
 */
export interface RuntimeReceipt {
  schemaVersion: number;
  reservationId: string;
  requestId: string;
  turnId: string;
  stepId: string;
  fence: number;
  artifactDigest: string;
  endpointGeneration: string;
  usageEventId: string;
  measuredUnits: number;
  terminal: "completed" | "cancelled" | "failed";
  usageSignature?: string;
}

export interface RuntimePort {
  execute(input: {
    reservationId: string;
    fence: number;
    endpointRef: string;
    scopeId: string;
    deadlineAt: number;
    chunks: readonly string[];
    leaseToken?: string;
    requestDigest?: string;
    endpointGeneration?: string;
    requestId?: string;
    turnId?: string;
    stepId?: string;
    artifactDigest?: string;
  }, signal: AbortSignal): Promise<{ output: string; receipt: RuntimeReceipt }>;
}

export interface ModelGatewayAuthority {
  generationDecision: string;
  modelUseDecision: string;
  costConsumption: string;
  agentStep: string;
}

export interface ModelGatewayDispatchInput {
  requestId: string;
  turnId: string;
  stepId: string;
  stepClass: "route" | "final_generation" | "tool";
  requestDigest: string;
  capability: string;
  artifactDigest: string;
  modelRef: string;
  denyEpoch: number;
  workflowReservationRef: string;
  deadlineAt: number;
  scopeId: string;
  chunks: readonly string[];
  authority: ModelGatewayAuthority;
}

export class ModelGateway {
  constructor(
    private readonly registry: ModelEligibilityPort,
    private readonly scheduler: SchedulerPort,
    private readonly runtime: RuntimePort,
    private readonly receipts: ReceiptVerifier,
    private readonly claims: ClaimStore,
    private readonly attempts: RuntimeAttemptStore,
    private readonly now = () => Date.now(),
  ) {}

  async generate(input: ModelGatewayDispatchInput, signal: AbortSignal): Promise<{ output: string; receipt: RuntimeReceipt }> {
    if (signal.aborted) throw new ModelGatewayError("CANCELLED");
    if (input.deadlineAt <= this.now()) throw new ModelGatewayError("STALE_AUTHORITY");

    let generationDecision, modelUseDecision, costConsumption, agentStep;
    try {
      generationDecision = this.receipts.verify(input.authority.generationDecision, {
        purpose: "authorize_generate",
        requestId: input.requestId,
      });
      modelUseDecision = this.receipts.verify(input.authority.modelUseDecision, {
        purpose: "authorize_model_use",
        requestId: input.requestId,
        turnId: input.turnId,
        stepId: input.stepId,
        stepClass: input.stepClass,
        modelRef: input.modelRef,
        artifactDigest: input.artifactDigest as `sha256:${string}`,
        capability: input.capability,
      });
      costConsumption = this.receipts.verify(input.authority.costConsumption, {
        purpose: "cost_sub_envelope_consumption",
        requestId: input.requestId,
        stepId: input.stepId,
        subEnvelope: input.stepClass,
        reservationRef: input.workflowReservationRef,
      });
      agentStep = this.receipts.verify(input.authority.agentStep, {
        purpose: "agent_step",
        requestId: input.requestId,
        turnId: input.turnId,
        stepId: input.stepId,
        stepClass: input.stepClass,
      });
    } catch {
      throw new ModelGatewayError("STALE_AUTHORITY");
    }
    void generationDecision;
    void modelUseDecision;
    void costConsumption;

    const expectedAgentStepBinding = `sha256:${createHash("sha256").update(input.authority.modelUseDecision).digest("hex")}`;
    if (agentStep.boundDigest !== expectedAgentStepBinding) throw new ModelGatewayError("STALE_AUTHORITY");

    const model = await this.registry.resolve({ capability: input.capability, artifactDigest: input.artifactDigest, denyEpoch: input.denyEpoch });
    if (model.external || model.snapshotExpiresAt <= this.now()) throw new ModelGatewayError("FORBIDDEN");
    const endpointGeneration = model.endpointGeneration ?? String(model.snapshotExpiresAt);

    const logicalAttemptId = `${input.requestId}:${input.turnId}:${input.stepId}`;
    const prior = await this.attempts.listLogicalAttempts(logicalAttemptId);
    if (prior.some((row) => row.state === "OUTCOME_UNKNOWN")) throw new ModelGatewayError("STALE_AUTHORITY");
    if (prior.some((row) => row.state !== "NOT_STARTED")) throw new ModelGatewayError("STALE_AUTHORITY");
    const isRetry = prior.length > 0;

    // Durable authorization gate (Option B: a durable single retry permit tied to the
    // logical attempt). The original, non-retry generation consumes the one-use agent-step
    // receipt exactly once. A retry generation MUST NOT reuse that exhausted receipt as a
    // fresh authorization; instead it must win a durable retry permit keyed by the base
    // NOT_STARTED generation it is retrying. Concurrent replicas racing the same retry
    // resolve to exactly one permit winner, so at most one authorized attempt may contact
    // the runtime. See tests: retryUsesDurableSinglePermitPerLogicalAttempt,
    // concurrentRetryYieldsAtMostOneRuntimeContact, duplicateRetryCallerDoesNotCreateSecondGeneration.
    let permitClaimed = false;
    if (!isRetry) {
      permitClaimed = await this.claims.claim("agent_step_dispatch", agentStep.receiptId, input.requestId, this.now());
    } else {
      const baseGeneration = Math.max(0, ...prior.map((row) => row.attemptGeneration ?? 0));
      permitClaimed = await this.claims.claim("retry_permit", `${logicalAttemptId}:from:g${baseGeneration}`, input.requestId, this.now());
    }
    if (!permitClaimed) throw new ModelGatewayError("STALE_AUTHORITY");

    // Atomically (re)validate the prior state, allocate the next generation, and durably
    // create the attempt in a single transaction. This is the durable uniqueness contract:
    // only the permit winner that also passes the atomic pre-contact NOT_STARTED check may
    // create a new generation. OUTCOME_UNKNOWN and any contacted/terminal attempt make the
    // next generation impossible, and every duplicate/concurrent loser is rejected here and
    // never contacts the runtime.
    const accepted = await this.attempts.beginDispatchAttempt({
      logicalAttemptId,
      requestId: input.requestId,
      turnId: input.turnId,
      stepId: input.stepId,
      requestDigest: input.requestDigest,
      modelRef: input.modelRef,
      artifactDigest: input.artifactDigest as `sha256:${string}`,
      endpointGeneration,
      deadlineAt: input.deadlineAt,
    }).catch((error) => {
      if (error instanceof RuntimeAttemptError && (error.code === "CONFLICT" || error.code === "FORBIDDEN")) throw new ModelGatewayError("STALE_AUTHORITY");
      throw new ModelGatewayError("DEPENDENCY_UNAVAILABLE");
    });
    const reservationId = accepted.reservationId;

    let lease: SchedulerReservation | undefined;
    try {
      lease = await this.scheduler.reserve({
        reservationId,
        requestId: input.requestId,
        turnId: input.turnId,
        stepId: input.stepId,
        requestDigest: input.requestDigest,
        modelRef: input.modelRef,
        artifactDigest: input.artifactDigest as `sha256:${string}`,
        endpointRef: model.endpointRef,
        endpointGeneration,
        expiresAt: input.deadlineAt,
      });
    } catch (error) {
      await this.attempts.markNotStarted(reservationId, true).catch(() => undefined);
      if (error instanceof Error && error.message === "OVERLOADED") throw new ModelGatewayError("OVERLOADED");
      throw new ModelGatewayError("DEPENDENCY_UNAVAILABLE");
    }

    try {
      await this.attempts.bindSchedulerLease(reservationId, {
        fence: lease.fence,
        endpointRef: lease.endpointRef,
        endpointGeneration: lease.endpointGeneration,
        requestDigest: input.requestDigest,
        expiresAt: lease.expiresAt,
        leaseToken: lease.leaseToken,
      });
      const leaseClaims = this.receipts.verify(lease.leaseToken, {
        purpose: "scheduler_lease",
        issuer: "authority-scheduler",
        requestId: input.requestId,
        turnId: input.turnId,
        stepId: input.stepId,
        reservationRef: reservationId,
        modelRef: input.modelRef,
        artifactDigest: input.artifactDigest as `sha256:${string}`,
        revision: lease.fence,
      });
      const expectedBound = `sha256:${createHash("sha256").update(`${input.requestDigest}|${lease.endpointRef}|${endpointGeneration}|${input.artifactDigest}`).digest("hex")}`;
      if (
        leaseClaims.boundDigest !== expectedBound
        || lease.fence !== leaseClaims.revision
        || lease.endpointRef !== model.endpointRef
        || lease.endpointGeneration !== endpointGeneration
        || lease.requestDigest !== input.requestDigest
        || leaseClaims.issuedAt >= leaseClaims.expiresAt
        || lease.expiresAt > input.deadlineAt
      ) {
        throw new ModelGatewayError("STALE_AUTHORITY");
      }
    } catch {
      await this.attempts.markNotStarted(reservationId, true).catch(() => undefined);
      throw new ModelGatewayError("STALE_AUTHORITY");
    }

    try {
      await this.attempts.commitContactIntent(reservationId);
    } catch {
      await this.attempts.markOutcomeUnknown(reservationId).catch(() => undefined);
      throw new ModelGatewayError("DEPENDENCY_UNAVAILABLE");
    }

    try {
      await this.scheduler.start(lease.reservationId, input.requestDigest, lease.fence);
      const result = await this.runtime.execute({
        reservationId: lease.reservationId,
        fence: lease.fence,
        endpointRef: lease.endpointRef,
        scopeId: input.scopeId,
        deadlineAt: input.deadlineAt,
        chunks: input.chunks,
        leaseToken: lease.leaseToken,
        requestDigest: input.requestDigest,
        endpointGeneration: lease.endpointGeneration,
        requestId: input.requestId,
        turnId: input.turnId,
        stepId: input.stepId,
        artifactDigest: input.artifactDigest,
      }, signal);
      const confirmed = await this.attempts.getAttemptStatus(reservationId);
      if (confirmed.state === "OUTCOME_UNKNOWN") throw new ModelGatewayError("STALE_AUTHORITY");
      return {
        output: result.output,
        receipt: result.receipt,
      };
    } catch (error) {
      const status = await this.attempts.getAttemptStatus(reservationId).catch(() => undefined);
      if (status && (status.state === "CONTACT_INTENT_COMMITTED" || status.state === "RUNTIME_STARTED" || status.state === "STREAMING" || status.state === "CANCEL_REQUESTED")) {
        await this.attempts.markOutcomeUnknown(reservationId).catch(() => undefined);
      }
      if (signal.aborted || error instanceof Error && error.message === "CANCELLED") throw new ModelGatewayError("CANCELLED");
      if (error instanceof ModelGatewayError) throw error;
      throw new ModelGatewayError("DEPENDENCY_UNAVAILABLE");
    } finally {
      if (lease) await this.scheduler.release(lease.reservationId, lease.fence).catch(() => undefined);
    }
  }
}
