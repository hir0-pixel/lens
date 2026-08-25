import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AuthorityReceiptIssuer } from "../../services/security/authorityReceipt";
import { SqlGpuScheduler } from "../../services/gpu-scheduler/SqlGpuScheduler";
import { createSqlitePgCompatPool } from "../../services/storage/pgPool";
import { SchedulerError } from "../../services/gpu-scheduler/GpuScheduler";

const ARTIFACT = `sha256:${"a".repeat(64)}` as const;

function makeInput(reservationId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    reservationId,
    requestId: "r",
    turnId: "t",
    stepId: "s",
    requestDigest: "digest",
    modelRef: "m",
    artifactDigest: ARTIFACT,
    endpointRef: "ep",
    endpointGeneration: "g",
    expiresAt: Date.now() + 30_000,
    ...overrides,
  };
}

describe("SqlGpuScheduler", () => {
  it("shares fence and capacity across replicas, reclaims expired leases, and is idempotent", async () => {
    const keys = generateKeyPairSync("ed25519");
    const issuer = new AuthorityReceiptIssuer(keys.privateKey);
    const pool = createSqlitePgCompatPool(":memory:");
    const a = new SqlGpuScheduler(pool, issuer, "cell-a", 1);
    const b = new SqlGpuScheduler(pool, issuer, "cell-a", 1);
    await a.ready();
    const input = makeInput("reservation:1");
    const first = await a.reserve(input);
    const replay = await b.reserve(input);
    expect(replay.fence).toBe(first.fence);
    await expect(b.reserve(makeInput("reservation:2"))).rejects.toBeInstanceOf(SchedulerError);
    await a.release(first.reservationId, first.fence);
    const second = await b.reserve(makeInput("reservation:2", { requestDigest: "digest-2" }));
    expect(second.fence).toBeGreaterThan(first.fence);
  });

  it("isolates capacity per cell so one cell does not consume another's slots", async () => {
    const keys = generateKeyPairSync("ed25519");
    const issuer = new AuthorityReceiptIssuer(keys.privateKey);
    const pool = createSqlitePgCompatPool(":memory:");
    const a = new SqlGpuScheduler(pool, issuer, "cell-a", 1);
    const b = new SqlGpuScheduler(pool, issuer, "cell-b", 1);
    await a.ready();
    await b.ready();

    const a1 = await a.reserve(makeInput("a1"));
    // cell-b has independent capacity and must admit even though cell-a is full.
    await expect(b.reserve(makeInput("b1"))).resolves.toBeDefined();
    // Both cells are now at capacity.
    await expect(a.reserve(makeInput("a2"))).rejects.toBeInstanceOf(SchedulerError);
    await expect(b.reserve(makeInput("b2"))).rejects.toBeInstanceOf(SchedulerError);

    // Releasing within a cell frees only that cell's capacity.
    await a.release(a1.reservationId, a1.fence);
    await expect(a.reserve(makeInput("a2"))).resolves.toBeDefined();
    // cell-b remains full until its own lease is released.
    await expect(b.reserve(makeInput("b3"))).rejects.toBeInstanceOf(SchedulerError);
  });

  it("scopes reclaim to the cell and does not affect another cell's active leases", async () => {
    const keys = generateKeyPairSync("ed25519");
    const issuer = new AuthorityReceiptIssuer(keys.privateKey);
    const pool = createSqlitePgCompatPool(":memory:");
    const a = new SqlGpuScheduler(pool, issuer, "cell-a", 2);
    const b = new SqlGpuScheduler(pool, issuer, "cell-b", 2);
    await a.ready();
    await b.ready();

    const aActive = await a.reserve(makeInput("a-active"));
    const aExpired = await a.reserve(makeInput("a-expired", { expiresAt: Date.now() + 50 }));
    const bActive = await b.reserve(makeInput("b-active"));

    // Reclaim only cell-a with a future clock: should expire a-expired but leave
    // a-active (still within its own expiry) and b-active (different cell) untouched.
    const future = Date.now() + 10_000;
    const reclaimedA = await a.reclaim(future);
    expect(reclaimedA).toBe(1);
    const reclaimedB = await b.reclaim(future);
    expect(reclaimedB).toBe(0);

    // cell-b's active lease is still usable (state untouched by cell-a's reclaim).
    await expect(b.start(bActive.reservationId, bActive.requestDigest, bActive.fence)).resolves.toBeDefined();
    // cell-a's expired lease cannot be started.
    await expect(a.start(aExpired.reservationId, aExpired.requestDigest, aExpired.fence)).rejects.toBeInstanceOf(SchedulerError);
    await a.release(aActive.reservationId, aActive.fence);
  });

  it("scopes start/release to the cell and rejects operating on another cell's lease", async () => {
    const keys = generateKeyPairSync("ed25519");
    const issuer = new AuthorityReceiptIssuer(keys.privateKey);
    const pool = createSqlitePgCompatPool(":memory:");
    const a = new SqlGpuScheduler(pool, issuer, "cell-a", 2);
    const b = new SqlGpuScheduler(pool, issuer, "cell-b", 2);
    await a.ready();
    await b.ready();

    const aLease = await a.reserve(makeInput("shared-reservation-id"));
    // Another cell must not be able to start/release a lease owned by cell-a.
    await expect(b.start("shared-reservation-id", aLease.requestDigest, aLease.fence)).rejects.toBeInstanceOf(SchedulerError);
    await expect(b.release("shared-reservation-id", aLease.fence)).rejects.toBeInstanceOf(SchedulerError);
    // The owning cell can still start/release it.
    await expect(a.start(aLease.reservationId, aLease.requestDigest, aLease.fence)).resolves.toBeDefined();
    await a.release(aLease.reservationId, aLease.fence);
  });

  it("serializes admission across separate scheduler instances on the same database", async () => {
    const keys = generateKeyPairSync("ed25519");
    const issuer = new AuthorityReceiptIssuer(keys.privateKey);
    // Two distinct scheduler instances bound to the SAME database. The admission
    // transaction locks the cell's scheduler_meta row (FOR UPDATE on Postgres; a
    // serialized BEGIN IMMEDIATE on the dev/test SQLite adapter) before counting
    // active leases, so concurrent reserves can never both admit the last slot.
    const pool = createSqlitePgCompatPool(":memory:");
    const a = new SqlGpuScheduler(pool, issuer, "cell-a", 1);
    const b = new SqlGpuScheduler(pool, issuer, "cell-a", 1);
    await a.ready();

    const results = await Promise.allSettled([
      a.reserve(makeInput("res-1")),
      b.reserve(makeInput("res-2")),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as SchedulerError;
    expect(reason).toBeInstanceOf(SchedulerError);
    expect(reason.code).toBe("OVERLOADED");
  });
});
