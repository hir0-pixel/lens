import type { PgPool, PgQuery } from "../storage/pgPool";
import {
  LEGAL_ATTEMPT_TRANSITIONS,
  RuntimeAttemptError,
  RUNTIME_ATTEMPT_SCHEMA,
  type AcceptAttemptInput,
  type BeginDispatchAttemptInput,
  type RuntimeAttemptRecord,
  type RuntimeAttemptState,
  type RuntimeAttemptStore,
  type SchedulerLeaseBinding,
} from "./RuntimeAttemptStore";

function rowToRecord(row: Record<string, unknown>): RuntimeAttemptRecord {
  return {
    reservationId: String(row.reservation_id),
    logicalAttemptId: row.logical_attempt_id ? String(row.logical_attempt_id) : undefined,
    attemptGeneration: row.attempt_generation == null ? undefined : Number(row.attempt_generation),
    requestId: String(row.request_id),
    turnId: String(row.turn_id),
    stepId: String(row.step_id),
    requestDigest: String(row.request_digest),
    modelRef: String(row.model_ref),
    artifactDigest: String(row.artifact_digest),
    endpointGeneration: String(row.endpoint_generation),
    endpointRef: row.endpoint_ref ? String(row.endpoint_ref) : undefined,
    leaseExpiresAt: row.lease_expires_at == null ? undefined : Number(row.lease_expires_at),
    state: row.state as RuntimeAttemptState,
    fence: Number(row.fence),
    contactIntentCommitted: Number(row.contact_intent) === 1,
    usageEventId: row.usage_event_id ? String(row.usage_event_id) : undefined,
    usageSignature: row.usage_signature ? String(row.usage_signature) : undefined,
    generatedTokens: row.generated_tokens == null ? undefined : Number(row.generated_tokens),
  };
}

export class RelationalRuntimeAttemptStore implements RuntimeAttemptStore {
  constructor(
    private readonly pool: PgPool,
    private readonly hooks: {
      afterAccept?: () => Promise<void> | void;
      afterContactIntent?: () => Promise<void> | void;
      afterUsage?: () => Promise<void> | void;
    } = {},
  ) {}

  async ready(): Promise<void> {
    for (const statement of RUNTIME_ATTEMPT_SCHEMA.split(";").map((part) => part.trim()).filter(Boolean)) {
      await this.pool.query(`${statement}`);
    }
  }

  async allocateGeneration(logicalAttemptId: string): Promise<number> {
    if (!logicalAttemptId) throw new RuntimeAttemptError("FORBIDDEN", "logical_attempt_id is required.");
    return this.pool.transaction((query) => this.allocateGenerationWithin(query, logicalAttemptId));
  }

  private async allocateGenerationWithin(query: PgQuery, logicalAttemptId: string): Promise<number> {
    if (!logicalAttemptId) throw new RuntimeAttemptError("FORBIDDEN", "logical_attempt_id is required.");
    await query(
      "INSERT INTO runtime_attempt_generations (logical_attempt_id, next_generation) VALUES ($1, 0) ON CONFLICT (logical_attempt_id) DO NOTHING",
      [logicalAttemptId],
    );
    await query(
      "UPDATE runtime_attempt_generations SET next_generation = next_generation + 1 WHERE logical_attempt_id = $1",
      [logicalAttemptId],
    );
    const row = await query<{ next_generation: number }>(
      "SELECT next_generation FROM runtime_attempt_generations WHERE logical_attempt_id = $1",
      [logicalAttemptId],
    );
    const generation = Number(row.rows[0]?.next_generation);
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new RuntimeAttemptError("UNAVAILABLE", "Failed to allocate an attempt generation.");
    }
    return generation;
  }

  async beginDispatchAttempt(input: BeginDispatchAttemptInput): Promise<RuntimeAttemptRecord> {
    const logicalAttemptId = input.logicalAttemptId || `${input.requestId}:${input.turnId}:${input.stepId}`;
    return this.pool.transaction(async (query) => {
      // Lock order is unambiguous: the logical_attempt generation/guard row is the serializing
      // point, NOT the attempts rows. We create-or-lock it FIRST so two concurrent retry callers
      // cannot both evaluate eligibility against stale history before generation allocation.
      await query(
        "INSERT INTO runtime_attempt_generations (logical_attempt_id, next_generation) VALUES ($1, 0) ON CONFLICT (logical_attempt_id) DO NOTHING",
        [logicalAttemptId],
      );
      await query(
        "SELECT next_generation FROM runtime_attempt_generations WHERE logical_attempt_id = $1 FOR UPDATE",
        [logicalAttemptId],
      );
      // Revalidate ALL attempts for the logical id AFTER holding the generation guard lock, so the
      // snapshot is consistent for every concurrent caller that also holds the same guard lock.
      const priorResult = await query<Record<string, unknown>>(
        "SELECT * FROM runtime_attempts WHERE logical_attempt_id = $1",
        [logicalAttemptId],
      );
      const prior = priorResult.rows.map((row) => rowToRecord(row as Record<string, unknown>));
      if (prior.some((row) => row.state === "OUTCOME_UNKNOWN")) {
        throw new RuntimeAttemptError("FORBIDDEN", "An OUTCOME_UNKNOWN attempt must never be retried.");
      }
      if (prior.some((row) => row.state !== "NOT_STARTED")) {
        throw new RuntimeAttemptError("FORBIDDEN", "A new generation is only permitted when every prior attempt is pre-contact NOT_STARTED.");
      }
      const generation = await this.allocateGenerationWithin(query, logicalAttemptId);
      const reservationId = `reservation:${logicalAttemptId}:g${generation}`;
      const inserted = await query(
        `INSERT INTO runtime_attempts (
          reservation_id, logical_attempt_id, attempt_generation, request_id, turn_id, step_id, request_digest, model_ref, artifact_digest,
          endpoint_generation, endpoint_ref, state, fence, contact_intent, deadline_at, lease_expires_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'','ACCEPTED_NOT_CONTACTED',0,0,$11,0)
        ON CONFLICT (reservation_id) DO NOTHING`,
        [
          reservationId,
          logicalAttemptId,
          generation,
          input.requestId,
          input.turnId,
          input.stepId,
          input.requestDigest,
          input.modelRef,
          input.artifactDigest,
          input.endpointGeneration,
          input.deadlineAt,
        ],
      );
      if (inserted.rowCount !== 1) {
        throw new RuntimeAttemptError("CONFLICT", "An attempt already exists for this reservation_id.");
      }
      const created = await query<Record<string, unknown>>("SELECT * FROM runtime_attempts WHERE reservation_id = $1", [reservationId]);
      const record = rowToRecord(created.rows[0] as Record<string, unknown>);
      await this.hooks.afterAccept?.();
      return record;
    });
  }

  async listLogicalAttempts(logicalAttemptId: string): Promise<RuntimeAttemptRecord[]> {
    const result = await this.pool.query("SELECT * FROM runtime_attempts WHERE logical_attempt_id = $1", [logicalAttemptId]);
    return result.rows.map((row) => rowToRecord(row as Record<string, unknown>));
  }

  async accept(input: AcceptAttemptInput): Promise<RuntimeAttemptRecord> {
    const logicalAttemptId = input.logicalAttemptId || `${input.requestId}:${input.turnId}:${input.stepId}`;
    const attemptGeneration = input.attemptGeneration;
    if (!Number.isSafeInteger(attemptGeneration) || attemptGeneration < 1) {
      throw new RuntimeAttemptError("FORBIDDEN", "attempt_generation must be a positive integer.");
    }
    const inserted = await this.pool.query(
      `INSERT INTO runtime_attempts (
        reservation_id, logical_attempt_id, attempt_generation, request_id, turn_id, step_id, request_digest, model_ref, artifact_digest,
        endpoint_generation, endpoint_ref, state, fence, contact_intent, deadline_at, lease_expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'','ACCEPTED_NOT_CONTACTED',0,0,$11,0)
      ON CONFLICT (reservation_id) DO NOTHING`,
      [
        input.reservationId,
        logicalAttemptId,
        attemptGeneration,
        input.requestId,
        input.turnId,
        input.stepId,
        input.requestDigest,
        input.modelRef,
        input.artifactDigest,
        input.endpointGeneration,
        input.deadlineAt,
      ],
    );
    if (inserted.rowCount !== 1) {
      throw new RuntimeAttemptError("CONFLICT", "An attempt already exists for this reservation_id.");
    }
    await this.hooks.afterAccept?.();
    return this.getAttemptStatus(input.reservationId);
  }

  async bindSchedulerLease(reservationId: string, lease: SchedulerLeaseBinding): Promise<RuntimeAttemptRecord> {
    if (!Number.isSafeInteger(lease.fence) || lease.fence < 1) {
      throw new RuntimeAttemptError("FORBIDDEN", "Scheduler fence must be a positive integer.");
    }
    const updated = await this.pool.query(
      `UPDATE runtime_attempts
       SET fence = $1, endpoint_ref = $2, endpoint_generation = $3, request_digest = $4, lease_expires_at = $5
       WHERE reservation_id = $6 AND state = 'ACCEPTED_NOT_CONTACTED' AND contact_intent = 0`,
      [lease.fence, lease.endpointRef, lease.endpointGeneration, lease.requestDigest, lease.expiresAt, reservationId],
    );
    if (updated.rowCount !== 1) {
      throw new RuntimeAttemptError("FORBIDDEN", "Scheduler lease can only bind to ACCEPTED_NOT_CONTACTED attempts.");
    }
    return this.getAttemptStatus(reservationId);
  }

  async commitContactIntent(reservationId: string): Promise<RuntimeAttemptRecord> {
    const updated = await this.pool.query(
      `UPDATE runtime_attempts SET state = 'CONTACT_INTENT_COMMITTED', contact_intent = 1
       WHERE reservation_id = $1 AND state = 'ACCEPTED_NOT_CONTACTED' AND contact_intent = 0 AND fence >= 1 AND endpoint_ref <> ''`,
      [reservationId],
    );
    if (updated.rowCount !== 1) {
      throw new RuntimeAttemptError("FORBIDDEN", "Contact intent cannot be committed from the current attempt state.");
    }
    await this.hooks.afterContactIntent?.();
    return this.getAttemptStatus(reservationId);
  }

  async transitionTo(reservationId: string, to: RuntimeAttemptState): Promise<RuntimeAttemptRecord> {
    const current = await this.getAttemptStatus(reservationId);
    const allowed = LEGAL_ATTEMPT_TRANSITIONS[current.state];
    if (!allowed.includes(to)) {
      throw new RuntimeAttemptError("FORBIDDEN", `Illegal attempt transition ${current.state} -> ${to}.`);
    }
    const updated = await this.pool.query(
      "UPDATE runtime_attempts SET state = $1 WHERE reservation_id = $2 AND state = $3",
      [to, reservationId, current.state],
    );
    if (updated.rowCount !== 1) {
      throw new RuntimeAttemptError("FORBIDDEN", `Cannot transition to ${to} from the current attempt state.`);
    }
    return this.getAttemptStatus(reservationId);
  }

  async markNotStarted(reservationId: string, proofNoContact: true): Promise<RuntimeAttemptRecord> {
    if (proofNoContact !== true) throw new RuntimeAttemptError("FORBIDDEN", "NOT_STARTED requires fenced proof that no contact path executed.");
    const updated = await this.pool.query(
      `UPDATE runtime_attempts SET state = 'NOT_STARTED'
       WHERE reservation_id = $1 AND state = 'ACCEPTED_NOT_CONTACTED' AND contact_intent = 0`,
      [reservationId],
    );
    if (updated.rowCount !== 1) {
      throw new RuntimeAttemptError("FORBIDDEN", "ACCEPTED_NOT_CONTACTED can become NOT_STARTED only with proof no contact path executed.");
    }
    return this.getAttemptStatus(reservationId);
  }

  async markOutcomeUnknown(reservationId: string): Promise<RuntimeAttemptRecord> {
    const updated = await this.pool.query(
      `UPDATE runtime_attempts SET state = 'OUTCOME_UNKNOWN'
       WHERE reservation_id = $1 AND state IN ('CONTACT_INTENT_COMMITTED','RUNTIME_STARTED','STREAMING','CANCEL_REQUESTED')`,
      [reservationId],
    );
    if (updated.rowCount !== 1) {
      throw new RuntimeAttemptError("FORBIDDEN", "Only unresolved contacted attempts become OUTCOME_UNKNOWN.");
    }
    return this.getAttemptStatus(reservationId);
  }

  async completeWithUsage(
    reservationId: string,
    usage: { usageEventId: string; generatedTokens: number; signature: string; terminal: "COMPLETED" | "FAILED" | "CANCELLED" },
  ): Promise<RuntimeAttemptRecord> {
    if (!Number.isSafeInteger(usage.generatedTokens) || usage.generatedTokens < 0 || usage.generatedTokens > 1_000_000) {
      throw new RuntimeAttemptError("FORBIDDEN", "Measured usage must be a bounded non-negative integer.");
    }
    return this.pool.transaction(async (query) => {
      const existing = await query<{ state: string; usage_event_id: string | null }>(
        "SELECT state, usage_event_id FROM runtime_attempts WHERE reservation_id = $1 FOR UPDATE",
        [reservationId],
      );
      const row = existing.rows[0];
      if (!row) throw new RuntimeAttemptError("NOT_FOUND", "No runtime attempt exists for this reservation.");
      if (row.usage_event_id && row.usage_event_id !== usage.usageEventId) {
        throw new RuntimeAttemptError("CONFLICT", "Usage for this attempt was already settled.");
      }
      if (row.usage_event_id === usage.usageEventId && row.state === usage.terminal) {
        const done = await query("SELECT * FROM runtime_attempts WHERE reservation_id = $1", [reservationId]);
        return rowToRecord(done.rows[0] as Record<string, unknown>);
      }
      const allowed = LEGAL_ATTEMPT_TRANSITIONS[row.state as RuntimeAttemptState];
      if (!allowed?.includes(usage.terminal) && row.state !== usage.terminal) {
        throw new RuntimeAttemptError("FORBIDDEN", `Illegal attempt transition ${row.state} -> ${usage.terminal}.`);
      }
      await query(
        `UPDATE runtime_attempts
         SET usage_event_id = $1, generated_tokens = $2, usage_signature = $3, state = $4
         WHERE reservation_id = $5`,
        [usage.usageEventId, usage.generatedTokens, usage.signature, usage.terminal, reservationId],
      );
      await this.hooks.afterUsage?.();
      const done = await query("SELECT * FROM runtime_attempts WHERE reservation_id = $1", [reservationId]);
      return rowToRecord(done.rows[0] as Record<string, unknown>);
    });
  }

  async reconcileExpired(now: number): Promise<number> {
    const updated = await this.pool.query(
      `UPDATE runtime_attempts SET state = 'OUTCOME_UNKNOWN'
       WHERE state IN ('CONTACT_INTENT_COMMITTED','RUNTIME_STARTED','STREAMING','CANCEL_REQUESTED')
         AND (deadline_at <= $1 OR (lease_expires_at > 0 AND lease_expires_at <= $1))`,
      [now],
    );
    return updated.rowCount;
  }

  async getAttemptStatus(reservationId: string): Promise<RuntimeAttemptRecord> {
    const result = await this.pool.query("SELECT * FROM runtime_attempts WHERE reservation_id = $1", [reservationId]);
    const row = result.rows[0];
    if (!row) throw new RuntimeAttemptError("NOT_FOUND", "No runtime attempt exists for this reservation.");
    return rowToRecord(row as Record<string, unknown>);
  }
}
