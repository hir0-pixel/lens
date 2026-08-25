import type { PgPool } from "../storage/pgPool";
import type { ClaimStore } from "./replayClaimStore";

export class PostgresClaimStore implements ClaimStore {
  constructor(private readonly pool: PgPool) {}

  async ready(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS authority_claims (
        kind TEXT NOT NULL,
        claim_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        claimed_at BIGINT NOT NULL,
        PRIMARY KEY (kind, claim_id)
      )
    `);
  }

  async claim(kind: string, claimId: string, requestId: string, now: number): Promise<boolean> {
    const inserted = await this.pool.query(
      "INSERT INTO authority_claims (kind, claim_id, request_id, claimed_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
      [kind, claimId, requestId, now],
    );
    return inserted.rowCount === 1;
  }
}
