import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FailClosedClaimStore, InMemoryClaimStore, SqliteClaimStore } from "../../services/security/replayClaimStore";

describe("ReplayClaimStore", () => {
  it("InMemoryClaimStore grants a claim exactly once per (kind, claimId)", async () => {
    const store = new InMemoryClaimStore();
    expect(await store.claim("agent_step", "receipt-1", "req-1", 1)).toBe(true);
    expect(await store.claim("agent_step", "receipt-1", "req-1", 2)).toBe(false);
    expect(await store.claim("agent_step", "receipt-2", "req-1", 3)).toBe(true);
  });

  it("FailClosedClaimStore never grants a claim", async () => {
    const store = new FailClosedClaimStore();
    await expect(store.claim("agent_step", "receipt-1", "req-1", 1)).rejects.toThrow();
  });

  describe("SqliteClaimStore (durable, cross-replica-shaped)", () => {
    let dir: string;
    let dbPath: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "claim-store-"));
      dbPath = join(dir, "claims.db");
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("grants a claim exactly once per (kind, claimId), durably", async () => {
      const store = new SqliteClaimStore(dbPath);
      expect(await store.claim("agent_step", "receipt-1", "req-1", 1)).toBe(true);
      expect(await store.claim("agent_step", "receipt-1", "req-1", 2)).toBe(false);
      store.close();
    });

    it("two replicas racing the same receipt id, over the same shared database file, produce exactly one winner", async () => {
      const replicaA = new SqliteClaimStore(dbPath);
      const replicaB = new SqliteClaimStore(dbPath);
      const results = await Promise.all([
        replicaA.claim("agent_step", "shared-receipt", "req-1", 1),
        replicaB.claim("agent_step", "shared-receipt", "req-1", 1),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      replicaA.close();
      replicaB.close();
    });

    it("a claim persists across process/instance boundaries (a fresh instance over the same file still rejects the same claim id)", async () => {
      const first = new SqliteClaimStore(dbPath);
      expect(await first.claim("cost_sub_envelope_consumption", "receipt-x", "req-1", 1)).toBe(true);
      first.close();
      const second = new SqliteClaimStore(dbPath);
      expect(await second.claim("cost_sub_envelope_consumption", "receipt-x", "req-1", 2)).toBe(false);
      second.close();
    });

    it("different kinds do not collide even with the same claim id", async () => {
      const store = new SqliteClaimStore(dbPath);
      expect(await store.claim("agent_step", "id-1", "req-1", 1)).toBe(true);
      expect(await store.claim("cost_sub_envelope_consumption", "id-1", "req-1", 2)).toBe(true);
      store.close();
    });
  });
});
