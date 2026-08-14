import { GatewayAuditProducer } from "./auditProducer";
import {
  GatewayError,
  type GatewayAdmission,
  type GatewayRequest,
  type SessionAuthenticator,
} from "./types";

interface TokenBucket {
  tokens: number;
  updatedAt: number;
}

export interface GatewayAdmissionOptions {
  authenticator: SessionAuthenticator;
  audit: GatewayAuditProducer;
  now?: () => Date;
  rateLimit?: { capacity: number; refillPerSecond: number };
  maxConcurrentInteractive?: number;
  maxConcurrentManagement?: number;
}

function isDigest(value: string): value is `sha256:${string}` {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}

function safeCorrelationId(value: string | undefined, fallback: string): string {
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : fallback;
}

export class GatewayAdmissionController {
  private requestSequence = 0;
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly active = new Map<GatewayRequest["bulkhead"], number>();
  private readonly now: () => Date;
  private readonly rateLimit: { capacity: number; refillPerSecond: number };
  private readonly maxConcurrent: Record<GatewayRequest["bulkhead"], number>;

  constructor(private readonly options: GatewayAdmissionOptions) {
    this.now = options.now ?? (() => new Date());
    this.rateLimit = options.rateLimit ?? { capacity: 20, refillPerSecond: 10 };
    this.maxConcurrent = {
      interactive: options.maxConcurrentInteractive ?? 20,
      management: options.maxConcurrentManagement ?? 2,
    };
  }

  async admit(request: GatewayRequest): Promise<GatewayAdmission> {
    const requestId = `gw-${String(++this.requestSequence).padStart(8, "0")}`;
    const correlationId = safeCorrelationId(request.correlationId, requestId);
    const now = this.now();
    const deadline = new Date(request.deadlineAt);

    if (Number.isNaN(deadline.valueOf()) || deadline <= now) {
      throw new GatewayError("DEADLINE_EXCEEDED", "The request deadline has elapsed.", correlationId, false);
    }
    if (!isDigest(request.payloadDigest)) {
      throw new GatewayError("INVALID_ARGUMENT", "Request metadata is invalid.", correlationId, false);
    }
    if (this.requiresIdempotencyKey(request) && !this.validIdempotencyKey(request.idempotencyKey)) {
      throw new GatewayError("INVALID_ARGUMENT", "Request metadata is invalid.", correlationId, false);
    }

    const identity = await this.options.authenticator.authenticate(request.session, now);
    if (!identity || new Date(identity.expiresAt) <= now) {
      throw new GatewayError("UNAUTHENTICATED", "Authentication is required.", correlationId, false);
    }
    if (request.protected && identity.authenticationMethods.length === 0) {
      throw new GatewayError("UNAUTHENTICATED", "Authentication is required.", correlationId, false);
    }
    this.validatePrivilegedChange(request, identity.subjectRef, now, correlationId);

    this.consumeBucket(`${identity.subjectRef}:${request.route}`, now, correlationId);
    this.acquireBulkhead(request.bulkhead, correlationId);

    const cancellationController = new AbortController();
    let released = false;
    const admission: GatewayAdmission = {
      requestId,
      correlationId,
      identity,
      route: request.route,
      deadlineAt: request.deadlineAt,
      bulkhead: request.bulkhead,
      idempotencyKey: request.idempotencyKey,
      cancellation: cancellationController.signal,
      release: () => {
        if (released) return;
        released = true;
        cancellationController.abort();
        this.releaseBulkhead(request.bulkhead);
      },
    };

    try {
      await this.options.audit.recordAdmission(admission, request.payloadDigest);
      return admission;
    } catch (error) {
      admission.release();
      throw error;
    }
  }

  private requiresIdempotencyKey(request: GatewayRequest): boolean {
    return request.method === "POST" && (request.route === "/v1/agent" || request.route === "/v1/tool");
  }

  private validIdempotencyKey(value: string | undefined): boolean {
    return value !== undefined && /^[A-Za-z0-9._:-]{16,128}$/.test(value);
  }

  private validatePrivilegedChange(
    request: GatewayRequest,
    subjectRef: string,
    now: Date,
    correlationId: string,
  ): void {
    const change = request.privilegedChange;
    if (!change) return;
    const expiresAt = new Date(change.expiresAt);
    const invalid = request.bulkhead !== "management"
      || change.actorSubjectRef !== subjectRef
      || change.approverSubjectRef === subjectRef
      || !/^[A-Za-z0-9._:-]{16,128}$/.test(change.fenceId)
      || Number.isNaN(expiresAt.valueOf())
      || expiresAt <= now;
    if (invalid) {
      throw new GatewayError("FORBIDDEN", "The privileged change cannot be admitted.", correlationId, false);
    }
  }

  private consumeBucket(key: string, now: Date, correlationId: string): void {
    const current = this.buckets.get(key) ?? { tokens: this.rateLimit.capacity, updatedAt: now.valueOf() };
    const elapsedSeconds = Math.max(0, (now.valueOf() - current.updatedAt) / 1000);
    current.tokens = Math.min(this.rateLimit.capacity, current.tokens + elapsedSeconds * this.rateLimit.refillPerSecond);
    current.updatedAt = now.valueOf();
    if (current.tokens < 1) {
      this.buckets.set(key, current);
      throw new GatewayError("RATE_LIMITED", "Request admission is temporarily limited.", correlationId, true, 100);
    }
    current.tokens -= 1;
    this.buckets.set(key, current);
  }

  private acquireBulkhead(bulkhead: GatewayRequest["bulkhead"], correlationId: string): void {
    const active = this.active.get(bulkhead) ?? 0;
    if (active >= this.maxConcurrent[bulkhead]) {
      throw new GatewayError("OVERLOADED", "Request admission is temporarily unavailable.", correlationId, true, 100);
    }
    this.active.set(bulkhead, active + 1);
  }

  private releaseBulkhead(bulkhead: GatewayRequest["bulkhead"]): void {
    const active = this.active.get(bulkhead) ?? 0;
    this.active.set(bulkhead, Math.max(0, active - 1));
  }
}
