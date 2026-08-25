import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RuntimeAttemptError, type BeginDispatchAttemptInput } from "../../services/runtime-attempt/RuntimeAttemptStore";
import { RelationalRuntimeAttemptStore } from "../../services/runtime-attempt/RelationalRuntimeAttemptStore";
import { createSqlitePgCompatPool } from "../../services/storage/pgPool";

const ARTIFACT = "sha256:model-digest-1234567890123456789012345678901234567890" as const;

function dispatchInput(logicalId: string): BeginDispatchAttemptInput {
  const [requestId, turnId, stepId] = logicalId.split(":");
  return {
    logicalAttemptId: logicalId,
    requestId,
    turnId,
    stepId,
    requestDigest: "request-digest",
    modelRef: "model-default",
    artifactDigest: ARTIFACT,
    endpointGeneration: "gen-1",
    deadlineAt: 2_000,
  };
}

describe("durable attempt generations", () => {
  it("allocates distinct generations concurrently and never resets after reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "attempt-gen-"));
    const path = join(dir, "attempts.db");
    const pool = createSqlitePgCompatPool(path);
    const store = new RelationalRuntimeAttemptStore(pool);
    await store.ready();
    const [a, b] = await Promise.all([store.allocateGeneration("req:turn:step"), store.allocateGeneration("req:turn:step")]);
    expect(new Set([a, b]).size).toBe(2);
    pool.closeSync();
    const reopenedPool = createSqlitePgCompatPool(path);
    const reopened = new RelationalRuntimeAttemptStore(reopenedPool);
    await reopened.ready();
    expect(await reopened.allocateGeneration("req:turn:step")).toBe(3);
    reopenedPool.closeSync();
  });

  it("separateStoreInstancesCannotBothCreateRetryGenerationAfterSameNotStartedPredecessor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "retry-race-"));
    const path = join(dir, "attempts.db");
    const logicalId = "request-1:turn-1:step-1";
    const input = dispatchInput(logicalId);

    // Seed a single pre-contact NOT_STARTED predecessor (generation 1) via one store instance.
    const seeder = new RelationalRuntimeAttemptStore(createSqlitePgCompatPool(path));
    await seeder.ready();
    const g1 = await seeder.beginDispatchAttempt(input);
    expect(g1.attemptGeneration).toBe(1);
    await seeder.markNotStarted(g1.reservationId, true);

    // Two SEPARATE store instances sharing the same durable backend race the same retry.
    // The durable generation guard (not any in-process claim store) must be the proof.
    const storeA = new RelationalRuntimeAttemptStore(createSqlitePgCompatPool(path));
    const storeB = new RelationalRuntimeAttemptStore(createSqlitePgCompatPool(path));
    await storeA.ready();
    await storeB.ready();

    const [a, b] = await Promise.allSettled([
      storeA.beginDispatchAttempt(input),
      storeB.beginDispatchAttempt(input),
    ]);
    const succeeded = [a, b].filter((r) => r.status === "fulfilled");
    const failed = [a, b].filter((r) => r.status === "rejected");
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    if (failed[0].status === "rejected") {
      expect((failed[0].reason as RuntimeAttemptError).code).toBe("FORBIDDEN");
    }

    // Exactly one retry generation created; the loser never persisted an attempt.
    const listed = await storeA.listLogicalAttempts(logicalId);
    expect(listed.map((r) => r.attemptGeneration)).toEqual([1, 2]);
    expect(listed.filter((r) => r.attemptGeneration === 2).length).toBe(1);
  });
});
