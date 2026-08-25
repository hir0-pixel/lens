/**
 * One durable, cross-replica single-use claim table, shared by every consumer that used to
 * keep its own process-local `Set<string>` for one-use enforcement: `ModelGateway`'s
 * `dispatched` set and `PolicyDecisionPoint`'s `consumedFences` set both retire onto this.
 * `claim()` is an atomic "insert or tell me I lost" — under concurrent replicas racing the
 * same receipt id, exactly one call returns `true`.
 */
import { DatabaseSync } from "node:sqlite";

export interface ClaimStore {
  /** Atomically claims `claimId` for `kind`. Returns true exactly once per (kind, claimId) — every subsequent or concurrent caller gets false. */
  claim(kind: string, claimId: string, requestId: string, now: number): Promise<boolean>;
}

/** Durable, cross-process claim store backed by SQLite (Node's built-in `node:sqlite`). SQLite WAL over a shared file path is this repository's proven multi-replica-safe pattern (see `multiReplica.test.ts`); production should point every replica's DatabaseSync at the same durable path/volume. */
export class SqliteClaimStore implements ClaimStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS authority_claims (
        kind TEXT NOT NULL,
        claim_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        claimed_at INTEGER NOT NULL,
        PRIMARY KEY (kind, claim_id)
      );
    `);
  }

  async claim(kind: string, claimId: string, requestId: string, now: number): Promise<boolean> {
    try {
      const result = this.db
        .prepare("INSERT INTO authority_claims (kind, claim_id, request_id, claimed_at) VALUES (?, ?, ?, ?)")
        .run(kind, claimId, requestId, now);
      return Number(result.changes) === 1;
    } catch {
      // UNIQUE/PRIMARY KEY violation: another caller (this replica or another) already won.
      return false;
    }
  }

  close(): void {
    this.db.close();
  }
}

/** Development/test-only, single-process claim store. Never cross-replica-safe — production startup must reject it. */
export class InMemoryClaimStore implements ClaimStore {
  readonly devOnly = true as const;
  private readonly claimed = new Set<string>();

  async claim(kind: string, claimId: string): Promise<boolean> {
    const key = `${kind}:${claimId}`;
    if (this.claimed.has(key)) return false;
    this.claimed.add(key);
    return true;
  }
}

/** Production default when no durable claim store is configured: fails closed rather than silently granting every claim. */
export class FailClosedClaimStore implements ClaimStore {
  async claim(): Promise<boolean> {
    throw new Error("No durable authority claim store is configured.");
  }
}
