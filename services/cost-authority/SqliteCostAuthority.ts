/**
 * Development/test Cost authority: same PostgreSQL-shaped transactional SQL as production,
 * executed on SQLite via SqlitePgCompatPool. Not acceptable as a production adapter.
 */
import { AuthorityReceiptIssuer, type SignedAuthorityReceipt } from "../security/authorityReceipt";
import { PostgresCostAuthority } from "./PostgresCostAuthority";
import { createSqlitePgCompatPool, type SqlitePgCompatPool } from "../storage/pgPool";
import type {
  ConsumeSubEnvelopeInput,
  CostAuthorityPort,
  FinalizeSubEnvelopeInput,
  ReserveWorkflowBudgetInput,
  WorkflowBudgetStatus,
} from "./CostAuthority";

export class SqliteCostAuthority implements CostAuthorityPort {
  private readonly pool: SqlitePgCompatPool;
  private readonly inner: PostgresCostAuthority;
  private prepared: Promise<void> | undefined;

  constructor(
    dbPath: string,
    issuer: AuthorityReceiptIssuer,
    now: () => number = () => Date.now(),
    ttlMs = 30_000,
    hooks?: { afterReserveParent?: () => Promise<void> | void; afterConsumeIncrement?: () => Promise<void> | void },
  ) {
    this.pool = createSqlitePgCompatPool(dbPath);
    this.inner = new PostgresCostAuthority(this.pool, issuer, now, ttlMs, hooks);
  }

  close(): void {
    this.pool.closeSync();
  }

  private async readyInner(): Promise<void> {
    this.prepared ??= this.inner.ready();
    await this.prepared;
  }

  async reserveWorkflowBudget(input: ReserveWorkflowBudgetInput, signal: AbortSignal): Promise<{ reservationRef: string; revision: number }> {
    await this.readyInner();
    return this.inner.reserveWorkflowBudget(input, signal);
  }

  async consumeSubEnvelope(input: ConsumeSubEnvelopeInput, signal: AbortSignal): Promise<SignedAuthorityReceipt> {
    await this.readyInner();
    return this.inner.consumeSubEnvelope(input, signal);
  }

  async finalizeSubEnvelope(input: FinalizeSubEnvelopeInput, signal: AbortSignal): Promise<void> {
    await this.readyInner();
    return this.inner.finalizeSubEnvelope(input, signal);
  }

  async closeWorkflowBudget(reservationRef: string, signal: AbortSignal): Promise<void> {
    await this.readyInner();
    return this.inner.closeWorkflowBudget(reservationRef, signal);
  }

  async getWorkflowBudgetStatus(reservationRef: string, signal: AbortSignal): Promise<WorkflowBudgetStatus> {
    await this.readyInner();
    return this.inner.getWorkflowBudgetStatus(reservationRef, signal);
  }
}
