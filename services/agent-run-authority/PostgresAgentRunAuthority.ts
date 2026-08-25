import { createHash } from "node:crypto";
import { AuthorityReceiptIssuer, type SignedAuthorityReceipt } from "../security/authorityReceipt";
import type { PgPool } from "../storage/pgPool";
import {
  AgentRunAuthorityError,
  type AgentRunAuthorityPort,
  type AgentRunStatus,
  type AgentStepStatus,
  type BeginAgentRunInput,
  type ReserveAgentStepInput,
} from "./AgentRunAuthority";

export class PostgresAgentRunAuthority implements AgentRunAuthorityPort {
  constructor(
    private readonly pool: PgPool,
    private readonly issuer: AuthorityReceiptIssuer,
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs = 30_000,
    private readonly hooks: { afterBeginInsert?: () => Promise<void> | void; afterStepInsert?: () => Promise<void> | void } = {},
  ) {}

  async ready(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        run_id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        workflow_reservation_ref TEXT NOT NULL,
        workflow_profile_digest TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'OPEN',
        envelope_revision INTEGER NOT NULL DEFAULT 1,
        expires_at BIGINT NOT NULL
      )`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS agent_steps (
        run_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        step_class TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        model_ref TEXT NOT NULL,
        artifact_digest TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'RESERVED',
        receipt_id TEXT NOT NULL,
        receipt_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        input_digest TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (run_id, step_id),
        UNIQUE (run_id, step_index)
      )`);
  }

  async beginAgentRun(input: BeginAgentRunInput, _signal?: AbortSignal): Promise<{ runId: string; envelopeRevision: number }> {
    void _signal;
    if (input.expiresAt <= this.now()) throw new AgentRunAuthorityError("STALE_AUTHORITY", "Agent run expiry is already in the past.");
    return this.pool.transaction(async (query) => {
      const existing = await query<{ idempotency_key: string; envelope_revision: number }>(
        "SELECT idempotency_key, envelope_revision FROM agent_runs WHERE run_id = $1 FOR UPDATE",
        [input.runId],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].idempotency_key !== input.idempotencyKey) {
          throw new AgentRunAuthorityError("CONFLICT", "A different agent run already exists under this runId.");
        }
        return { runId: input.runId, envelopeRevision: Number(existing.rows[0].envelope_revision) };
      }
      const inserted = await query(
        `INSERT INTO agent_runs (run_id, request_id, turn_id, workflow_reservation_ref, workflow_profile_digest, idempotency_key, state, envelope_revision, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,'OPEN',1,$7) ON CONFLICT (run_id) DO NOTHING`,
        [input.runId, input.requestId, input.turnId, input.workflowReservationRef, input.workflowProfileDigest, input.idempotencyKey, input.expiresAt],
      );
      await this.hooks.afterBeginInsert?.();
      if (inserted.rowCount !== 1) {
        const raced = await query<{ idempotency_key: string; envelope_revision: number }>(
          "SELECT idempotency_key, envelope_revision FROM agent_runs WHERE run_id = $1",
          [input.runId],
        );
        if (!raced.rows[0] || raced.rows[0].idempotency_key !== input.idempotencyKey) {
          throw new AgentRunAuthorityError("CONFLICT", "A different agent run already exists under this runId.");
        }
        return { runId: input.runId, envelopeRevision: Number(raced.rows[0].envelope_revision) };
      }
      return { runId: input.runId, envelopeRevision: 1 };
    });
  }

  async reserveAgentStep(input: ReserveAgentStepInput, _signal?: AbortSignal): Promise<SignedAuthorityReceipt> {
    void _signal;
    return this.pool.transaction(async (query) => {
      const existing = await query<{ idempotency_key: string; receipt_json: string; step_index: number; step_class: string; input_digest: string }>(
        "SELECT idempotency_key, receipt_json, step_index, step_class, input_digest FROM agent_steps WHERE run_id = $1 AND step_id = $2 FOR UPDATE",
        [input.runId, input.stepId],
      );
      const digest = createHash("sha256").update(JSON.stringify({
        requestId: input.requestId,
        turnId: input.turnId,
        stepClass: input.stepClass,
        stepIndex: input.stepIndex,
        modelRef: input.modelRef,
        artifactDigest: input.artifactDigest,
        capability: input.capability,
        workflowReservationRef: input.workflowReservationRef,
        subEnvelope: input.subEnvelope,
        modelAuthorizationDigest: input.modelAuthorizationDigest,
        deadlineAt: input.deadlineAt,
      })).digest("hex");
      if (existing.rows[0]) {
        if (existing.rows[0].idempotency_key !== input.idempotencyKey
          || Number(existing.rows[0].step_index) !== input.stepIndex
          || existing.rows[0].step_class !== input.stepClass
          || existing.rows[0].input_digest !== digest) {
          throw new AgentRunAuthorityError("CONFLICT", "A different step reservation already exists under this stepId.");
        }
        return JSON.parse(existing.rows[0].receipt_json) as SignedAuthorityReceipt;
      }
      const run = await query<{ state: string; expires_at: number }>("SELECT state, expires_at FROM agent_runs WHERE run_id = $1 FOR UPDATE", [input.runId]);
      if (!run.rows[0]) throw new AgentRunAuthorityError("NOT_FOUND", "No such agent run.");
      if (run.rows[0].state !== "OPEN") throw new AgentRunAuthorityError("FORBIDDEN", "The agent run is closed.");
      const now = this.now();
      if (Number(run.rows[0].expires_at) <= now || input.deadlineAt <= now) {
        throw new AgentRunAuthorityError("STALE_AUTHORITY", "The agent run or step deadline has already elapsed.");
      }
      const indexTaken = await query(
        "SELECT step_id FROM agent_steps WHERE run_id = $1 AND step_index = $2",
        [input.runId, input.stepIndex],
      );
      if (indexTaken.rows[0]) throw new AgentRunAuthorityError("CONFLICT", "This step index is already reserved on the run.");
      const receipt = this.issuer.issue({
        purpose: "agent_step",
        issuer: "authority-agent-run",
        requestId: input.requestId,
        turnId: input.turnId,
        stepId: input.stepId,
        stepClass: input.stepClass,
        stepIndex: input.stepIndex,
        modelRef: input.modelRef,
        artifactDigest: input.artifactDigest,
        capability: input.capability,
        reservationRef: input.workflowReservationRef,
        subEnvelope: input.subEnvelope,
        boundDigest: input.modelAuthorizationDigest,
        revision: 1,
      }, this.ttlMs);
      const inserted = await query(
        `INSERT INTO agent_steps (run_id, step_id, step_class, step_index, model_ref, artifact_digest, state, receipt_id, receipt_json, idempotency_key, input_digest)
         VALUES ($1,$2,$3,$4,$5,$6,'RESERVED',$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [input.runId, input.stepId, input.stepClass, input.stepIndex, input.modelRef, input.artifactDigest, receipt.claims.receiptId, JSON.stringify(receipt), input.idempotencyKey, digest],
      );
      await this.hooks.afterStepInsert?.();
      if (inserted.rowCount !== 1) {
        const raced = await query<{ idempotency_key: string; receipt_json: string }>(
          "SELECT idempotency_key, receipt_json FROM agent_steps WHERE run_id = $1 AND step_id = $2",
          [input.runId, input.stepId],
        );
        if (raced.rows[0]?.idempotency_key === input.idempotencyKey) {
          return JSON.parse(raced.rows[0].receipt_json) as SignedAuthorityReceipt;
        }
        throw new AgentRunAuthorityError("CONFLICT", "This step was reserved concurrently by another caller.");
      }
      return receipt;
    });
  }

  async consumeAgentStep(runId: string, stepId: string, receiptId: string, _signal?: AbortSignal): Promise<void> {
    void _signal;
    await this.pool.transaction(async (query) => {
      const step = await query<{ state: string; receipt_id: string }>(
        "SELECT state, receipt_id FROM agent_steps WHERE run_id = $1 AND step_id = $2 FOR UPDATE",
        [runId, stepId],
      );
      if (!step.rows[0]) throw new AgentRunAuthorityError("NOT_FOUND", "No such agent step.");
      if (step.rows[0].receipt_id !== receiptId) throw new AgentRunAuthorityError("FORBIDDEN", "The receipt does not match this step's reservation.");
      if (step.rows[0].state === "CONSUMED" || step.rows[0].state === "FINALIZED") return;
      const updated = await query(
        "UPDATE agent_steps SET state = 'CONSUMED' WHERE run_id = $1 AND step_id = $2 AND state = 'RESERVED'",
        [runId, stepId],
      );
      if (updated.rowCount !== 1) throw new AgentRunAuthorityError("CONFLICT", "The step was already consumed by another caller.");
    });
  }

  async finalizeAgentStep(runId: string, stepId: string, _signal?: AbortSignal): Promise<void> {
    void _signal;
    await this.pool.transaction(async (query) => {
      const step = await query<{ state: string }>("SELECT state FROM agent_steps WHERE run_id = $1 AND step_id = $2 FOR UPDATE", [runId, stepId]);
      if (!step.rows[0]) throw new AgentRunAuthorityError("NOT_FOUND", "No such agent step.");
      if (step.rows[0].state === "FINALIZED") return;
      if (step.rows[0].state !== "CONSUMED") {
        throw new AgentRunAuthorityError("FORBIDDEN", "Agent steps must be CONSUMED before FINALIZED.");
      }
      const updated = await query(
        "UPDATE agent_steps SET state = 'FINALIZED' WHERE run_id = $1 AND step_id = $2 AND state = 'CONSUMED'",
        [runId, stepId],
      );
      if (updated.rowCount !== 1) throw new AgentRunAuthorityError("CONFLICT", "The step could not be finalized.");
    });
  }

  async closeAgentRun(runId: string, _signal?: AbortSignal): Promise<void> {
    void _signal;
    await this.pool.transaction(async (query) => {
      const run = await query<{ state: string }>("SELECT state FROM agent_runs WHERE run_id = $1 FOR UPDATE", [runId]);
      if (!run.rows[0]) throw new AgentRunAuthorityError("NOT_FOUND", "No such agent run.");
      if (run.rows[0].state === "CLOSED") return;
      const open = await query<{ n: number }>(
        "SELECT COUNT(*) AS n FROM agent_steps WHERE run_id = $1 AND state <> 'FINALIZED'",
        [runId],
      );
      if (Number(open.rows[0]?.n ?? 0) > 0) {
        throw new AgentRunAuthorityError("FORBIDDEN", "An agent run cannot close while required steps are nonterminal.");
      }
      await query("UPDATE agent_runs SET state = 'CLOSED' WHERE run_id = $1 AND state = 'OPEN'", [runId]);
    });
  }

  async getAgentRunStatus(runId: string, _signal?: AbortSignal): Promise<AgentRunStatus> {
    void _signal;
    const run = await this.pool.query<{ request_id: string; turn_id: string; state: string; envelope_revision: number }>(
      "SELECT request_id, turn_id, state, envelope_revision FROM agent_runs WHERE run_id = $1",
      [runId],
    );
    if (!run.rows[0]) throw new AgentRunAuthorityError("NOT_FOUND", "No such agent run.");
    const rows = await this.pool.query<{ step_id: string; step_class: string; step_index: number; state: string; receipt_id: string }>(
      "SELECT step_id, step_class, step_index, state, receipt_id FROM agent_steps WHERE run_id = $1 ORDER BY step_index",
      [runId],
    );
    const steps: AgentStepStatus[] = rows.rows.map((row) => ({
      stepId: row.step_id,
      stepClass: row.step_class as AgentStepStatus["stepClass"],
      stepIndex: Number(row.step_index),
      state: row.state as AgentStepStatus["state"],
      receiptId: row.receipt_id,
    }));
    return {
      runId,
      requestId: run.rows[0].request_id,
      turnId: run.rows[0].turn_id,
      state: run.rows[0].state as "OPEN" | "CLOSED",
      envelopeRevision: Number(run.rows[0].envelope_revision),
      steps,
    };
  }
}
