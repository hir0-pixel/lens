export type LeaseState = "RESERVED" | "STARTED" | "RELEASED" | "EXPIRED";
export class SchedulerError extends Error { constructor(readonly code: "OVERLOADED" | "CONFLICT" | "STALE_FENCE") { super(code); } }
export interface SchedulerLease { reservationId: string; requestDigest: string; endpointRef: string; fence: number; expiresAt: number; state: LeaseState; }
export class GpuScheduler {
  private readonly leases = new Map<string, SchedulerLease>(); private active = 0; private fence = 0;
  constructor(private readonly capacity: number, private readonly now = () => Date.now()) {}
  reserve(input: { reservationId: string; requestDigest: string; endpointRef: string; expiresAt: number }): SchedulerLease {
    const existing = this.leases.get(input.reservationId);
    if (existing) { if (existing.requestDigest !== input.requestDigest) throw new SchedulerError("CONFLICT"); return { ...existing }; }
    if (this.active >= this.capacity) throw new SchedulerError("OVERLOADED");
    if (input.expiresAt <= this.now()) throw new SchedulerError("STALE_FENCE");
    const lease = { ...input, fence: ++this.fence, state: "RESERVED" as const }; this.leases.set(input.reservationId, lease); this.active++; return { ...lease };
  }
  start(reservationId: string, requestDigest: string, fence: number): SchedulerLease {
    const lease = this.leases.get(reservationId);
    if (!lease || lease.requestDigest !== requestDigest || lease.fence !== fence || lease.expiresAt <= this.now() || lease.state !== "RESERVED") throw new SchedulerError("STALE_FENCE");
    lease.state = "STARTED"; return { ...lease };
  }
  release(reservationId: string, fence: number): void { const lease = this.leases.get(reservationId); if (!lease || lease.fence !== fence) throw new SchedulerError("STALE_FENCE"); if (lease.state !== "RELEASED") { lease.state = "RELEASED"; this.active--; } }
}
