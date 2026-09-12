/**
 * Cross-replica single-use fence consumption for `PolicyDecisionPoint`. `consume()` is an atomic
 * "insert or tell me I lost" — under concurrent replicas racing the same fence id, exactly one
 * call returns `true`.
 */
import { DatabaseSync } from "node:sqlite";

export interface FenceLedger {
  /** Atomically consumes `fenceId`. Returns true exactly once per id — every subsequent or concurrent caller gets false. */
  consume(fenceId: string): boolean;
}

/** Default, single-process ledger — matches pre-B1 in-process `Set` behavior. */
export class InMemoryFenceLedger implements FenceLedger {
  private readonly consumed = new Set<string>();

  consume(fenceId: string): boolean {
    if (this.consumed.has(fenceId)) return false;
    this.consumed.add(fenceId);
    return true;
  }
}

/** Durable, cross-replica ledger backed by SQLite (Node's built-in `node:sqlite`). */
export class SqliteFenceLedger implements FenceLedger {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pdp_fence_consumptions (
        fence_id TEXT PRIMARY KEY,
        consumed_at INTEGER NOT NULL
      );
    `);
  }

  consume(fenceId: string): boolean {
    try {
      const result = this.db
        .prepare("INSERT INTO pdp_fence_consumptions (fence_id, consumed_at) VALUES (?, ?)")
        .run(fenceId, Date.now());
      return Number(result.changes) === 1;
    } catch {
      // PRIMARY KEY violation: another caller (this replica or another) already won.
      return false;
    }
  }

  close(): void {
    this.db.close();
  }
}

export type AuthorityProfile = "development" | "test" | "production";

export function createAgentFenceLedger(
  dbPath: string | undefined,
  authorityProfile: AuthorityProfile,
): FenceLedger {
  if (!dbPath) return new InMemoryFenceLedger();
  if (authorityProfile === "production" && dbPath === ":memory:") {
    throw new Error(
      "Production must not use an in-memory agent fence ledger (LENS_AGENT_FENCE_LEDGER_PATH=:memory:); a persistent ledger is required.",
    );
  }
  return new SqliteFenceLedger(dbPath);
}
