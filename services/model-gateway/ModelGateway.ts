export class ModelGatewayError extends Error { constructor(readonly code: "FORBIDDEN" | "OVERLOADED" | "STALE_AUTHORITY" | "CANCELLED" | "DEPENDENCY_UNAVAILABLE") { super(code); } }
export interface ModelEligibilityPort { resolve(input: { capability: string; artifactDigest: string; denyEpoch: number }): Promise<{ endpointRef: string; snapshotExpiresAt: number; external: boolean }>; }
export interface BudgetPort { validate(input: { reservationRef: string; requestId: string; estimateDigest: string; expiresAt: number }): Promise<void>; finalize(input: { reservationRef: string; usageEventId: string; measuredCost: number }): Promise<void>; }
export interface SchedulerPort { reserve(input: { reservationId: string; requestDigest: string; endpointRef: string; expiresAt: number }): Promise<{ reservationId: string; requestDigest: string; endpointRef: string; fence: number; expiresAt: number }>; start(reservationId: string, requestDigest: string, fence: number): Promise<void>; release(reservationId: string, fence: number): Promise<void>; }
export interface RuntimePort { execute(input: { reservationId: string; fence: number; endpointRef: string; scopeId: string; deadlineAt: number; chunks: readonly string[] }, signal: AbortSignal): Promise<{ output: string; receipt: { usageEventId: string; generatedTokens: number; terminal: "completed" | "cancelled" } }>; }

/** Routes only current approved internal artifacts; no retry or provider fallback path exists. */
export class ModelGateway {
  private readonly dispatched = new Set<string>();
  constructor(private readonly registry: ModelEligibilityPort, private readonly budgets: BudgetPort, private readonly scheduler: SchedulerPort, private readonly runtime: RuntimePort, private readonly now = () => Date.now()) {}
  async generate(input: { requestId: string; requestDigest: string; capability: string; artifactDigest: string; denyEpoch: number; budgetReservationRef: string; estimateDigest: string; deadlineAt: number; contextFence: string; scopeId: string; chunks: readonly string[] }, signal: AbortSignal): Promise<{ output: string; usageEventId: string }> {
    if (signal.aborted) throw new ModelGatewayError("CANCELLED");
    if (!input.contextFence || !input.scopeId || input.deadlineAt <= this.now()) throw new ModelGatewayError("STALE_AUTHORITY");
    if (this.dispatched.has(input.requestId)) throw new ModelGatewayError("STALE_AUTHORITY");
    const model = await this.registry.resolve({ capability: input.capability, artifactDigest: input.artifactDigest, denyEpoch: input.denyEpoch });
    if (model.external || model.snapshotExpiresAt <= this.now()) throw new ModelGatewayError("FORBIDDEN");
    await this.budgets.validate({ reservationRef: input.budgetReservationRef, requestId: input.requestId, estimateDigest: input.estimateDigest, expiresAt: input.deadlineAt });
    let lease;
    try { lease = await this.scheduler.reserve({ reservationId: `reservation:${input.requestId}`, requestDigest: input.requestDigest, endpointRef: model.endpointRef, expiresAt: input.deadlineAt }); }
    catch (error) { if (error instanceof Error && error.message === "OVERLOADED") throw new ModelGatewayError("OVERLOADED"); throw new ModelGatewayError("DEPENDENCY_UNAVAILABLE"); }
    this.dispatched.add(input.requestId);
    try { await this.scheduler.start(lease.reservationId, input.requestDigest, lease.fence); const result = await this.runtime.execute({ reservationId: lease.reservationId, fence: lease.fence, endpointRef: lease.endpointRef, scopeId: input.scopeId, deadlineAt: input.deadlineAt, chunks: input.chunks }, signal); await this.budgets.finalize({ reservationRef: input.budgetReservationRef, usageEventId: result.receipt.usageEventId, measuredCost: result.receipt.generatedTokens }); return { output: result.output, usageEventId: result.receipt.usageEventId }; }
    catch (error) {
      if (signal.aborted || error instanceof Error && error.message === "CANCELLED") throw new ModelGatewayError("CANCELLED");
      if (error instanceof ModelGatewayError) throw error;
      throw new ModelGatewayError("DEPENDENCY_UNAVAILABLE");
    }
    finally { await this.scheduler.release(lease.reservationId, lease.fence).catch(() => undefined); }
  }
}
