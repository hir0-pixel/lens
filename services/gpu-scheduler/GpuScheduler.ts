import { createHash } from "node:crypto";
import { AuthorityReceiptIssuer, type SignedAuthorityReceipt } from "../security/authorityReceipt";

export type LeaseState = "RESERVED" | "STARTED" | "RELEASED" | "EXPIRED";
export class SchedulerError extends Error { constructor(readonly code: "OVERLOADED" | "CONFLICT" | "STALE_FENCE") { super(code); } }

export interface SchedulerReserveInput {
  reservationId: string;
  requestId: string;
  turnId: string;
  stepId: string;
  requestDigest: string;
  modelRef: string;
  artifactDigest: `sha256:${string}`;
  endpointRef: string;
  endpointGeneration: string;
  expiresAt: number;
}

export interface SchedulerLease {
  reservationId: string;
  requestDigest: string;
  endpointRef: string;
  endpointGeneration: string;
  fence: number;
  expiresAt: number;
  state: LeaseState;
  leaseToken: string;
}

export class GpuScheduler {
  private readonly leases = new Map<string, SchedulerLease>();
  private active = 0;
  private fence = 0;

  constructor(
    private readonly capacity: number,
    private readonly now = () => Date.now(),
    private readonly issuer?: AuthorityReceiptIssuer,
  ) {}

  reserve(input: SchedulerReserveInput): SchedulerLease {
    const existing = this.leases.get(input.reservationId);
    if (existing) {
      if (existing.requestDigest !== input.requestDigest) throw new SchedulerError("CONFLICT");
      return { ...existing };
    }
    if (this.active >= this.capacity) throw new SchedulerError("OVERLOADED");
    if (input.expiresAt <= this.now()) throw new SchedulerError("STALE_FENCE");
    const fence = ++this.fence;
    if (!this.issuer) throw new SchedulerError("STALE_FENCE");
    const issued: SignedAuthorityReceipt = this.issuer.issue({
      purpose: "scheduler_lease",
      issuer: "authority-scheduler",
      requestId: input.requestId,
      turnId: input.turnId,
      stepId: input.stepId,
      modelRef: input.modelRef,
      artifactDigest: input.artifactDigest,
      reservationRef: input.reservationId,
      boundDigest: `sha256:${createHash("sha256").update(`${input.requestDigest}|${input.endpointRef}|${input.endpointGeneration}|${input.artifactDigest}`).digest("hex")}`,
      revision: fence,
    }, Math.min(60_000, Math.max(1, input.expiresAt - this.now())));
    const lease: SchedulerLease = {
      reservationId: input.reservationId,
      requestDigest: input.requestDigest,
      endpointRef: input.endpointRef,
      endpointGeneration: input.endpointGeneration,
      fence,
      expiresAt: input.expiresAt,
      state: "RESERVED",
      leaseToken: issued.token,
    };
    this.leases.set(input.reservationId, lease);
    this.active++;
    return { ...lease };
  }

  start(reservationId: string, requestDigest: string, fence: number): SchedulerLease {
    const lease = this.leases.get(reservationId);
    if (!lease || lease.requestDigest !== requestDigest || lease.fence !== fence || lease.expiresAt <= this.now() || lease.state !== "RESERVED") {
      throw new SchedulerError("STALE_FENCE");
    }
    lease.state = "STARTED";
    return { ...lease };
  }

  release(reservationId: string, fence: number): void {
    const lease = this.leases.get(reservationId);
    if (!lease || lease.fence !== fence) throw new SchedulerError("STALE_FENCE");
    if (lease.state !== "RELEASED") {
      lease.state = "RELEASED";
      this.active--;
    }
  }
}
