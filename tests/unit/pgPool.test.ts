import { describe, expect, it } from "vitest";
import { PostgresPool, createSqlitePgCompatPool, rewritePostgresSqlForSqlite } from "../../services/storage/pgPool";
import { RelationalRuntimeAttemptStore } from "../../services/runtime-attempt/RelationalRuntimeAttemptStore";
import { PostgresCostAuthority } from "../../services/cost-authority/PostgresCostAuthority";
import { AuthorityReceiptIssuer } from "../../services/security/authorityReceipt";
import { generateKeyPairSync } from "node:crypto";

describe("PostgreSQL SQL shape and pool construction", () => {
  it("rewrites LEAST/GREATEST and FOR UPDATE for SQLite", () => {
    const sql = rewritePostgresSqlForSqlite("UPDATE t SET x = LEAST(maximum_units, GREATEST(consumed_units, $1)) WHERE id = $2 FOR UPDATE");
    expect(sql).toContain("MIN(");
    expect(sql).toContain("MAX(");
    expect(sql).not.toContain("FOR UPDATE");
    expect(sql).not.toContain("$1");
  });

  it("rejects non-internal PostgreSQL URLs and constructs a Pool-backed adapter", () => {
    expect(() => new PostgresPool("postgres://user@example.com/db")).toThrow(/internal/);
    const pool = new PostgresPool("postgres://lens@127.0.0.1/lens", { max: 4, connectionTimeoutMillis: 1_000, queryTimeoutMillis: 2_000 });
    expect(pool).toBeInstanceOf(PostgresPool);
  });

  it("exercises PostgresCostAuthority SQL against the SQLite dialect adapter, including LEAST finalize", async () => {
    const keys = generateKeyPairSync("ed25519");
    const issuer = new AuthorityReceiptIssuer(keys.privateKey);
    const pool = createSqlitePgCompatPool(":memory:");
    const authority = new PostgresCostAuthority(pool, issuer);
    await authority.ready();
    const signal = new AbortController().signal;
    await authority.reserveWorkflowBudget({
      requestId: "r", turnId: "t", reservationRef: "workflow:r", idempotencyKey: "r",
      subEnvelopes: { route: { maximumUnits: 10 }, retrieval: { maximumUnits: 10 }, final_generation: { maximumUnits: 10 }, tool: { maximumUnits: 10 } },
      expiresAt: Date.now() + 30_000,
    }, signal);
    await authority.consumeSubEnvelope({ reservationRef: "workflow:r", subEnvelope: "route", units: 4, requestId: "r", turnId: "t", stepId: "s", idempotencyKey: "s", expiresAt: Date.now() + 30_000 }, signal);
    await authority.finalizeSubEnvelope({ reservationRef: "workflow:r", subEnvelope: "route", measuredUnits: 1, idempotencyKey: "f" }, signal);
    expect((await authority.getWorkflowBudgetStatus("workflow:r", signal)).subEnvelopes.route.consumedUnits).toBe(4);
  });

  it("RuntimeAttemptStore binds leases, forbids illegal transitions, and reconciles stranded contact to OUTCOME_UNKNOWN", async () => {
    const store = new RelationalRuntimeAttemptStore(createSqlitePgCompatPool(":memory:"));
    await store.ready();
    const input = {
      reservationId: "reservation:1",
      logicalAttemptId: "r:t:s",
      attemptGeneration: 1,
      requestId: "r", turnId: "t", stepId: "s", requestDigest: "d",
      modelRef: "m", artifactDigest: `sha256:${"a".repeat(64)}` as const, endpointGeneration: "g", deadlineAt: Date.now() + 5_000,
    };
    await store.accept(input);
    await expect(store.commitContactIntent(input.reservationId)).rejects.toThrow(/Contact intent/);
    await store.bindSchedulerLease(input.reservationId, { fence: 2, endpointRef: "ep", endpointGeneration: "g", requestDigest: "d", expiresAt: Date.now() + 5_000 });
    await store.commitContactIntent(input.reservationId);
    await store.transitionTo(input.reservationId, "RUNTIME_STARTED");
    await store.transitionTo(input.reservationId, "STREAMING");
    await expect(store.transitionTo(input.reservationId, "NOT_STARTED")).rejects.toThrow(/Illegal/);
    await store.markOutcomeUnknown(input.reservationId);
    expect((await store.getAttemptStatus(input.reservationId)).state).toBe("OUTCOME_UNKNOWN");
    await expect(store.accept(input)).rejects.toThrow(/already exists/);
    const expired = {
      ...input, reservationId: "reservation:expired", logicalAttemptId: "r:t:expired", attemptGeneration: 1, stepId: "expired", deadlineAt: Date.now() - 1,
    };
    await store.accept(expired);
    await store.bindSchedulerLease(expired.reservationId, { fence: 3, endpointRef: "ep", endpointGeneration: "g", requestDigest: "d", expiresAt: Date.now() - 1 });
    await store.commitContactIntent(expired.reservationId);
    expect(await store.reconcileExpired(Date.now())).toBeGreaterThanOrEqual(1);
    expect((await store.getAttemptStatus(expired.reservationId)).state).toBe("OUTCOME_UNKNOWN");
  });

  it("runs live PostgreSQL integration when LENS_TEST_DATABASE_URL is set", async () => {
    const url = process.env.LENS_TEST_DATABASE_URL;
    if (!url) {
      expect(process.env.LENS_TEST_DATABASE_URL ?? "").toBe("");
      return;
    }
    const pool = new PostgresPool(url, { max: 2, connectionTimeoutMillis: 3_000 });
    await pool.connect();
    expect(await pool.ready()).toBe(true);
    const keys = generateKeyPairSync("ed25519");
    const a = new PostgresCostAuthority(pool, new AuthorityReceiptIssuer(keys.privateKey));
    const b = new PostgresCostAuthority(pool, new AuthorityReceiptIssuer(keys.privateKey));
    await a.ready();
    const ref = `workflow:pg-${Date.now()}`;
    const signal = new AbortController().signal;
    const input = {
      requestId: ref, turnId: "t", reservationRef: ref, idempotencyKey: ref,
      subEnvelopes: { route: { maximumUnits: 5 }, retrieval: { maximumUnits: 5 }, final_generation: { maximumUnits: 5 }, tool: { maximumUnits: 5 } },
      expiresAt: Date.now() + 30_000,
    };
    await a.reserveWorkflowBudget(input, signal);
    const raced = await Promise.allSettled([
      a.consumeSubEnvelope({ reservationRef: ref, subEnvelope: "route", units: 4, requestId: ref, turnId: "t", stepId: "a", idempotencyKey: "a", expiresAt: Date.now() + 30_000 }, signal),
      b.consumeSubEnvelope({ reservationRef: ref, subEnvelope: "route", units: 4, requestId: ref, turnId: "t", stepId: "b", idempotencyKey: "b", expiresAt: Date.now() + 30_000 }, signal),
    ]);
    expect(raced.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    await pool.close();
  });
});
