import { createHash } from "node:crypto";
import { AuthorityReceiptIssuer, type SignedAuthorityReceipt } from "../security/authorityReceipt";
import type { PgPool } from "../storage/pgPool";
import { SchedulerError, type SchedulerLease, type SchedulerReserveInput } from "./GpuScheduler";

/**
 * Cell-owned durable scheduler. Capacity and fence sequence live in SQL so replicas
 * of the same cell share admission. Development still uses in-memory `GpuScheduler`.
 *
 * All lease rows carry `cell_id` and every capacity count, reclaim, and state
 * transition is scoped to that cell. Admission serializes on the `scheduler_meta`
 * row for the requested cell (locked `FOR UPDATE` before the active-count is read),
 * so two concurrent schedulers against the same Postgres database can never both
 * admit the last capacity slot.
 */
export class SqlGpuScheduler {
  constructor(
    private readonly pool: PgPool,
    private readonly issuer: AuthorityReceiptIssuer,
    private readonly cellId: string,
    private readonly capacity: number,
    private readonly now = () => Date.now(),
  ) {
    if (!cellId || capacity < 0 || !Number.isSafeInteger(capacity)) {
      throw new SchedulerError("STALE_FENCE");
    }
  }

  async ready(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS scheduler_meta (
        cell_id TEXT PRIMARY KEY,
        capacity INTEGER NOT NULL,
        fence_seq INTEGER NOT NULL
      )`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS scheduler_leases (
        reservation_id TEXT PRIMARY KEY,
        cell_id TEXT NOT NULL,
        request_digest TEXT NOT NULL,
        endpoint_ref TEXT NOT NULL,
        endpoint_generation TEXT NOT NULL,
        fence INTEGER NOT NULL,
        expires_at BIGINT NOT NULL,
        state TEXT NOT NULL,
        lease_token TEXT NOT NULL,
        input_digest TEXT NOT NULL
      )`);
    // Migration-safe: a pre-cell-isolation deployment already has `scheduler_leases`
    // without `cell_id`. CREATE TABLE IF NOT EXISTS will not add the column, so add
    // it explicitly and idempotently. This is a targeted, single-column ALTER — never
    // a broad/recreating DDL — and is swallowed when the column already exists.
    await this.migrateLeaseCellColumn();
    await this.pool.query(
      "INSERT INTO scheduler_meta (cell_id, capacity, fence_seq) VALUES ($1,$2,0) ON CONFLICT (cell_id) DO NOTHING",
      [this.cellId, this.capacity],
    );
  }

  private async migrateLeaseCellColumn(): Promise<void> {
    try {
      await this.pool.query(`ALTER TABLE scheduler_leases ADD COLUMN cell_id TEXT NOT NULL DEFAULT ''`);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const message = error instanceof Error ? error.message : "";
      const alreadyExists = code === "42701" || /duplicate column/i.test(message) || /already exists/i.test(message);
      if (!alreadyExists) throw error;
    }
  }

  async reclaim(now = this.now()): Promise<number> {
    const expired = await this.pool.query(
      `UPDATE scheduler_leases SET state = 'EXPIRED'
       WHERE cell_id = $1 AND state IN ('RESERVED','STARTED') AND expires_at <= $2`,
      [this.cellId, now],
    );
    return expired.rowCount;
  }

  async reserve(input: SchedulerReserveInput): Promise<SchedulerLease> {
    const digest = createHash("sha256").update(JSON.stringify({
      reservationId: input.reservationId,
      requestId: input.requestId,
      turnId: input.turnId,
      stepId: input.stepId,
      requestDigest: input.requestDigest,
      modelRef: input.modelRef,
      artifactDigest: input.artifactDigest,
      endpointRef: input.endpointRef,
      endpointGeneration: input.endpointGeneration,
      expiresAt: input.expiresAt,
    })).digest("hex");
    return this.pool.transaction(async (query) => {
      // Expire this cell's stale leases within the admission transaction.
      await query(
        `UPDATE scheduler_leases SET state = 'EXPIRED'
         WHERE cell_id = $1 AND state IN ('RESERVED','STARTED') AND expires_at <= $2`,
        [this.cellId, this.now()],
      );
      // Idempotent re-reservation is scoped to this cell.
      const existing = await query<{
        request_digest: string; endpoint_ref: string; endpoint_generation: string; fence: number;
        expires_at: number; state: string; lease_token: string; input_digest: string;
      }>("SELECT * FROM scheduler_leases WHERE cell_id = $1 AND reservation_id = $2 FOR UPDATE", [this.cellId, input.reservationId]);
      if (existing.rows[0]) {
        if (existing.rows[0].input_digest !== digest) throw new SchedulerError("CONFLICT");
        const row = existing.rows[0];
        return {
          reservationId: input.reservationId,
          requestDigest: row.request_digest,
          endpointRef: row.endpoint_ref,
          endpointGeneration: row.endpoint_generation,
          fence: Number(row.fence),
          expiresAt: Number(row.expires_at),
          state: row.state as SchedulerLease["state"],
          leaseToken: row.lease_token,
        };
      }
      // Lock the requested scheduler_meta cell row BEFORE counting active leases so
      // concurrent schedulers serialize on the same database row, not an in-memory lock.
      await query(
        "INSERT INTO scheduler_meta (cell_id, capacity, fence_seq) VALUES ($1,$2,0) ON CONFLICT (cell_id) DO NOTHING",
        [this.cellId, this.capacity],
      );
      const meta = await query<{ capacity: number; fence_seq: number }>(
        "SELECT capacity, fence_seq FROM scheduler_meta WHERE cell_id = $1 FOR UPDATE",
        [this.cellId],
      );
      const cap = Number(meta.rows[0]?.capacity ?? this.capacity);
      // Count only this cell's active leases within the same transaction.
      const active = await query<{ n: number }>(
        "SELECT COUNT(*) AS n FROM scheduler_leases WHERE cell_id = $1 AND state IN ('RESERVED','STARTED')",
        [this.cellId],
      );
      if (Number(active.rows[0]?.n ?? 0) >= cap) throw new SchedulerError("OVERLOADED");
      if (input.expiresAt <= this.now()) throw new SchedulerError("STALE_FENCE");
      await query("UPDATE scheduler_meta SET fence_seq = fence_seq + 1 WHERE cell_id = $1", [this.cellId]);
      const seq = await query<{ fence_seq: number }>("SELECT fence_seq FROM scheduler_meta WHERE cell_id = $1", [this.cellId]);
      const fence = Number(seq.rows[0]?.fence_seq);
      const issued: SignedAuthorityReceipt = this.issuer.issue({
        purpose: "scheduler_lease",
        issuer: "authority-scheduler",
        requestId: input.requestId,
        turnId: input.turnId,
        stepId: input.stepId,
        modelRef: input.modelRef,
        artifactDigest: input.artifactDigest,
        reservationRef: input.reservationId,
        boundDigest: `sha256:${createHash("sha256").update(`${input.requestDigest}|${input.endpointRef}|${input.endpointGeneration}|${input.artifactDigest}`).digest("hex")}`,
        revision: fence,
      }, Math.min(60_000, Math.max(1, input.expiresAt - this.now())));
      await query(
        `INSERT INTO scheduler_leases (reservation_id, cell_id, request_digest, endpoint_ref, endpoint_generation, fence, expires_at, state, lease_token, input_digest)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'RESERVED',$8,$9)`,
        [input.reservationId, this.cellId, input.requestDigest, input.endpointRef, input.endpointGeneration, fence, input.expiresAt, issued.token, digest],
      );
      return {
        reservationId: input.reservationId,
        requestDigest: input.requestDigest,
        endpointRef: input.endpointRef,
        endpointGeneration: input.endpointGeneration,
        fence,
        expiresAt: input.expiresAt,
        state: "RESERVED",
        leaseToken: issued.token,
      };
    });
  }

  async start(reservationId: string, requestDigest: string, fence: number): Promise<SchedulerLease> {
    const updated = await this.pool.query(
      `UPDATE scheduler_leases SET state = 'STARTED'
       WHERE cell_id = $1 AND reservation_id = $2 AND request_digest = $3 AND fence = $4 AND state = 'RESERVED' AND expires_at > $5`,
      [this.cellId, reservationId, requestDigest, fence, this.now()],
    );
    if (updated.rowCount !== 1) throw new SchedulerError("STALE_FENCE");
    const row = await this.pool.query("SELECT * FROM scheduler_leases WHERE cell_id = $1 AND reservation_id = $2", [this.cellId, reservationId]);
    const record = row.rows[0] as Record<string, unknown>;
    return {
      reservationId,
      requestDigest: String(record.request_digest),
      endpointRef: String(record.endpoint_ref),
      endpointGeneration: String(record.endpoint_generation),
      fence: Number(record.fence),
      expiresAt: Number(record.expires_at),
      state: "STARTED",
      leaseToken: String(record.lease_token),
    };
  }

  async release(reservationId: string, fence: number): Promise<void> {
    const updated = await this.pool.query(
      `UPDATE scheduler_leases SET state = 'RELEASED' WHERE cell_id = $1 AND reservation_id = $2 AND fence = $3 AND state <> 'RELEASED'`,
      [this.cellId, reservationId, fence],
    );
    if (updated.rowCount !== 1) {
      const existing = await this.pool.query(
        "SELECT state FROM scheduler_leases WHERE cell_id = $1 AND reservation_id = $2 AND fence = $3",
        [this.cellId, reservationId, fence],
      );
      if (existing.rows[0]?.state === "RELEASED") return;
      throw new SchedulerError("STALE_FENCE");
    }
  }
}
