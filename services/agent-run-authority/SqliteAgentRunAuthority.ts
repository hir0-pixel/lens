import { AuthorityReceiptIssuer, type SignedAuthorityReceipt } from "../security/authorityReceipt";
import { PostgresAgentRunAuthority } from "./PostgresAgentRunAuthority";
import { createSqlitePgCompatPool, type SqlitePgCompatPool } from "../storage/pgPool";
import type {
  AgentRunAuthorityPort,
  AgentRunStatus,
  BeginAgentRunInput,
  ReserveAgentStepInput,
} from "./AgentRunAuthority";

export class SqliteAgentRunAuthority implements AgentRunAuthorityPort {
  private readonly pool: SqlitePgCompatPool;
  private readonly inner: PostgresAgentRunAuthority;
  private prepared: Promise<void> | undefined;

  constructor(
    dbPath: string,
    issuer: AuthorityReceiptIssuer,
    now: () => number = () => Date.now(),
    ttlMs = 30_000,
    hooks?: { afterBeginInsert?: () => Promise<void> | void; afterStepInsert?: () => Promise<void> | void },
  ) {
    this.pool = createSqlitePgCompatPool(dbPath);
    this.inner = new PostgresAgentRunAuthority(this.pool, issuer, now, ttlMs, hooks);
  }

  close(): void {
    this.pool.closeSync();
  }

  private async readyInner(): Promise<void> {
    this.prepared ??= this.inner.ready();
    await this.prepared;
  }

  async beginAgentRun(input: BeginAgentRunInput, signal: AbortSignal): Promise<{ runId: string; envelopeRevision: number }> {
    await this.readyInner();
    return this.inner.beginAgentRun(input, signal);
  }

  async reserveAgentStep(input: ReserveAgentStepInput, signal: AbortSignal): Promise<SignedAuthorityReceipt> {
    await this.readyInner();
    return this.inner.reserveAgentStep(input, signal);
  }

  async consumeAgentStep(runId: string, stepId: string, receiptId: string, signal: AbortSignal): Promise<void> {
    await this.readyInner();
    return this.inner.consumeAgentStep(runId, stepId, receiptId, signal);
  }

  async finalizeAgentStep(runId: string, stepId: string, signal: AbortSignal): Promise<void> {
    await this.readyInner();
    return this.inner.finalizeAgentStep(runId, stepId, signal);
  }

  async closeAgentRun(runId: string, signal: AbortSignal): Promise<void> {
    await this.readyInner();
    return this.inner.closeAgentRun(runId, signal);
  }

  async getAgentRunStatus(runId: string, signal: AbortSignal): Promise<AgentRunStatus> {
    await this.readyInner();
    return this.inner.getAgentRunStatus(runId, signal);
  }
}
