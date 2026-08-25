import { createHash } from "node:crypto";
import { AuthorityReceiptIssuer, type SignedAuthorityReceipt } from "../security/authorityReceipt";
import type { PgPool, PgQuery } from "../storage/pgPool";
import {
  CostAuthorityError,
  SUB_ENVELOPE_CLASSES,
  type ConsumeSubEnvelopeInput,
  type CostAuthorityPort,
  type FinalizeSubEnvelopeInput,
  type ReserveWorkflowBudgetInput,
  type SubEnvelopeClass,
  type SubEnvelopeStatus,
  type WorkflowBudgetStatus,
} from "./CostAuthority";

export class PostgresCostAuthority implements CostAuthorityPort {
  constructor(
    private readonly pool: PgPool,
    private readonly issuer: AuthorityReceiptIssuer,
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs = 30_000,
    private readonly hooks: { afterReserveParent?: () => Promise<void> | void; afterConsumeIncrement?: () => Promise<void> | void } = {},
  ) {}

  async ready(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS cost_reservations (
        reservation_ref TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        input_digest TEXT NOT NULL DEFAULT '',
        workflow_profile_digest TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL,
        revision INTEGER NOT NULL,
        expires_at BIGINT NOT NULL,
        created_at BIGINT NOT NULL
      )`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS cost_sub_envelopes (
        reservation_ref TEXT NOT NULL,
        sub_envelope TEXT NOT NULL,
        maximum_units DOUBLE PRECISION NOT NULL,
        consumed_units DOUBLE PRECISION NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'OPEN',
        expires_at BIGINT NOT NULL,
        PRIMARY KEY (reservation_ref, sub_envelope)
      )`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS cost_idempotency (
        reservation_ref TEXT NOT NULL,
        sub_envelope TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        units DOUBLE PRECISION NOT NULL,
        input_digest TEXT NOT NULL DEFAULT '',
        result TEXT NOT NULL,
        PRIMARY KEY (reservation_ref, sub_envelope, idempotency_key)
      )`);
  }

  async reserveWorkflowBudget(input: ReserveWorkflowBudgetInput, _signal?: AbortSignal): Promise<{ reservationRef: string; revision: number }> {
    void _signal;
    for (const subEnvelope of SUB_ENVELOPE_CLASSES) {
      const limits = input.subEnvelopes[subEnvelope];
      if (!limits || !Number.isFinite(limits.maximumUnits) || limits.maximumUnits <= 0) {
        throw new CostAuthorityError("FORBIDDEN", `Sub-envelope ${subEnvelope} requires a positive maximumUnits.`);
      }
    }
    const now = this.now();
    if (input.expiresAt <= now) throw new CostAuthorityError("STALE_AUTHORITY", "Reservation expiry is already in the past.");

    const digest = createHash("sha256").update(JSON.stringify({
      requestId: input.requestId,
      turnId: input.turnId,
      subEnvelopes: input.subEnvelopes,
      expiresAt: input.expiresAt,
      workflowProfileDigest: input.workflowProfileDigest ?? "",
    })).digest("hex");
    return this.pool.transaction(async (query) => {
      const existing = await query<{ idempotency_key: string; revision: number; input_digest: string }>(
        "SELECT idempotency_key, revision, input_digest FROM cost_reservations WHERE reservation_ref = $1 FOR UPDATE",
        [input.reservationRef],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].idempotency_key !== input.idempotencyKey || existing.rows[0].input_digest !== digest) {
          throw new CostAuthorityError("CONFLICT", "A different reservation already exists under this reservationRef.");
        }
        return { reservationRef: input.reservationRef, revision: Number(existing.rows[0].revision) };
      }
      const inserted = await query(
        `INSERT INTO cost_reservations (reservation_ref, request_id, turn_id, idempotency_key, input_digest, workflow_profile_digest, state, revision, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,'OPEN',1,$7,$8) ON CONFLICT (reservation_ref) DO NOTHING`,
        [input.reservationRef, input.requestId, input.turnId, input.idempotencyKey, digest, input.workflowProfileDigest ?? "", input.expiresAt, now],
      );
      if (inserted.rowCount !== 1) {
        const raced = await query<{ idempotency_key: string; revision: number }>(
          "SELECT idempotency_key, revision FROM cost_reservations WHERE reservation_ref = $1",
          [input.reservationRef],
        );
        if (!raced.rows[0] || raced.rows[0].idempotency_key !== input.idempotencyKey) {
          throw new CostAuthorityError("CONFLICT", "A different reservation already exists under this reservationRef.");
        }
        return { reservationRef: input.reservationRef, revision: Number(raced.rows[0].revision) };
      }
      await this.hooks.afterReserveParent?.();
      for (const subEnvelope of SUB_ENVELOPE_CLASSES) {
        await query(
          "INSERT INTO cost_sub_envelopes (reservation_ref, sub_envelope, maximum_units, consumed_units, state, expires_at) VALUES ($1,$2,$3,0,'OPEN',$4)",
          [input.reservationRef, subEnvelope, input.subEnvelopes[subEnvelope].maximumUnits, input.expiresAt],
        );
      }
      return { reservationRef: input.reservationRef, revision: 1 };
    });
  }

  async consumeSubEnvelope(input: ConsumeSubEnvelopeInput, _signal?: AbortSignal): Promise<SignedAuthorityReceipt> {
    void _signal;
    if (input.units <= 0) throw new CostAuthorityError("FORBIDDEN", "Consumption units must be positive.");
    return this.pool.transaction(async (query) => this.consumeInTx(query, input));
  }

  private async consumeInTx(query: PgQuery, input: ConsumeSubEnvelopeInput): Promise<SignedAuthorityReceipt> {
    const reservation = await query<{ state: string; expires_at: number }>(
      "SELECT state, expires_at FROM cost_reservations WHERE reservation_ref = $1 FOR UPDATE",
      [input.reservationRef],
    );
    const digest = createHash("sha256").update(JSON.stringify({
      requestId: input.requestId,
      turnId: input.turnId,
      stepId: input.stepId,
      units: input.units,
      expiresAt: input.expiresAt,
    })).digest("hex");
    const idempotent = await query<{ units: number; result: string; input_digest: string }>(
      "SELECT units, result, input_digest FROM cost_idempotency WHERE reservation_ref = $1 AND sub_envelope = $2 AND idempotency_key = $3",
      [input.reservationRef, input.subEnvelope, input.idempotencyKey],
    );
    if (idempotent.rows[0]) {
      if (Number(idempotent.rows[0].units) !== input.units || idempotent.rows[0].input_digest !== digest) {
        throw new CostAuthorityError("CONFLICT", "This idempotency key was already used for a different unit amount.");
      }
      return JSON.parse(idempotent.rows[0].result) as SignedAuthorityReceipt;
    }
    if (!reservation.rows[0]) throw new CostAuthorityError("NOT_FOUND", "No such workflow reservation.");
    if (reservation.rows[0].state !== "OPEN") throw new CostAuthorityError("FORBIDDEN", "The workflow reservation is closed.");
    if (Number(reservation.rows[0].expires_at) <= this.now()) throw new CostAuthorityError("STALE_AUTHORITY", "The workflow reservation has expired.");
    const updated = await query(
      `UPDATE cost_sub_envelopes SET consumed_units = consumed_units + $1
       WHERE reservation_ref = $2 AND sub_envelope = $3 AND state = 'OPEN' AND consumed_units + $4 <= maximum_units`,
      [input.units, input.reservationRef, input.subEnvelope, input.units],
    );
    if (updated.rowCount !== 1) throw new CostAuthorityError("OVERSPEND", `Sub-envelope ${input.subEnvelope} would exceed its maximum.`);
    await this.hooks.afterConsumeIncrement?.();
    const receipt = this.issuer.issue({
      purpose: "cost_sub_envelope_consumption",
      issuer: "authority-cost",
      requestId: input.requestId,
      turnId: input.turnId,
      stepId: input.stepId,
      reservationRef: input.reservationRef,
      subEnvelope: input.subEnvelope,
      boundDigest: `sha256:${createHash("sha256").update(`${input.reservationRef}:${input.subEnvelope}:${input.stepId}:${input.units}`).digest("hex")}`,
      revision: 1,
    }, this.ttlMs);
    const stored = await query(
      "INSERT INTO cost_idempotency (reservation_ref, sub_envelope, idempotency_key, units, input_digest, result) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
      [input.reservationRef, input.subEnvelope, input.idempotencyKey, input.units, digest, JSON.stringify(receipt)],
    );
    if (stored.rowCount !== 1) {
      throw new CostAuthorityError("CONFLICT", "This idempotency key was already used for a different unit amount.");
    }
    return receipt;
  }

  async finalizeSubEnvelope(input: FinalizeSubEnvelopeInput, _signal?: AbortSignal): Promise<void> {
    void _signal;
    if (input.measuredUnits < 0) throw new CostAuthorityError("FORBIDDEN", "Measured units cannot be negative.");
    await this.pool.transaction(async (query) => {
      const envelope = await query<{ state: string }>(
        "SELECT state FROM cost_sub_envelopes WHERE reservation_ref = $1 AND sub_envelope = $2 FOR UPDATE",
        [input.reservationRef, input.subEnvelope],
      );
      if (!envelope.rows[0]) throw new CostAuthorityError("NOT_FOUND", `No such sub-envelope: ${input.subEnvelope}.`);
      if (envelope.rows[0].state === "FINALIZED") return;
      const updated = await query(
        `UPDATE cost_sub_envelopes
         SET state = 'FINALIZED', consumed_units = LEAST(maximum_units, GREATEST(consumed_units, $1))
         WHERE reservation_ref = $2 AND sub_envelope = $3 AND state = 'OPEN'`,
        [input.measuredUnits, input.reservationRef, input.subEnvelope],
      );
      if (updated.rowCount !== 1) throw new CostAuthorityError("CONFLICT", "The sub-envelope was finalized concurrently.");
    });
  }

  async closeWorkflowBudget(reservationRef: string, _signal?: AbortSignal): Promise<void> {
    void _signal;
    await this.pool.transaction(async (query) => {
      const reservation = await query<{ state: string }>("SELECT state FROM cost_reservations WHERE reservation_ref = $1 FOR UPDATE", [reservationRef]);
      if (!reservation.rows[0]) throw new CostAuthorityError("NOT_FOUND", "No such workflow reservation.");
      if (reservation.rows[0].state === "CLOSED") return;
      await query(
        "UPDATE cost_sub_envelopes SET state = 'FINALIZED' WHERE reservation_ref = $1 AND state = 'OPEN'",
        [reservationRef],
      );
      await query("UPDATE cost_reservations SET state = 'CLOSED' WHERE reservation_ref = $1 AND state = 'OPEN'", [reservationRef]);
    });
  }

  async getWorkflowBudgetStatus(reservationRef: string, _signal?: AbortSignal): Promise<WorkflowBudgetStatus> {
    void _signal;
    const reservation = await this.pool.query<{ request_id: string; turn_id: string; state: string; revision: number }>(
      "SELECT request_id, turn_id, state, revision FROM cost_reservations WHERE reservation_ref = $1",
      [reservationRef],
    );
    if (!reservation.rows[0]) throw new CostAuthorityError("NOT_FOUND", "No such workflow reservation.");
    const rows = await this.pool.query<{ sub_envelope: string; maximum_units: number; consumed_units: number; state: string; expires_at: number }>(
      "SELECT sub_envelope, maximum_units, consumed_units, state, expires_at FROM cost_sub_envelopes WHERE reservation_ref = $1",
      [reservationRef],
    );
    const subEnvelopes = {} as Record<SubEnvelopeClass, SubEnvelopeStatus>;
    for (const row of rows.rows) {
      subEnvelopes[row.sub_envelope as SubEnvelopeClass] = {
        maximumUnits: Number(row.maximum_units),
        consumedUnits: Number(row.consumed_units),
        state: row.state as "OPEN" | "FINALIZED",
        expiresAt: Number(row.expires_at),
      };
    }
    return {
      reservationRef,
      requestId: reservation.rows[0].request_id,
      turnId: reservation.rows[0].turn_id,
      state: reservation.rows[0].state as "OPEN" | "CLOSED",
      revision: Number(reservation.rows[0].revision),
      subEnvelopes,
    };
  }
}
