import { createHmac } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { DistributedAdmissionClient } from "../admission/distributedAdmissionClient";
import { getConfig } from "../config";

interface GcraState {
  theoreticalArrivalAt: number;
  lastSeenAt: number;
}

interface AdmissionDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

const MAX_LOCAL_KEYS = 50_000;

function localGcra(windowMs: number, capacity: number, now: () => number = () => Date.now()) {
  const states = new Map<string, GcraState>();
  const increment = windowMs / capacity;
  const burstTolerance = Math.max(0, capacity - 1) * increment;
  let operations = 0;

  return (key: string): AdmissionDecision => {
    const current = now();
    operations += 1;
    if (operations % 1_024 === 0) {
      for (const [candidate, state] of states) {
        if (state.lastSeenAt + windowMs <= current) states.delete(candidate);
      }
    }

    const existing = states.get(key);
    if (!existing && states.size >= MAX_LOCAL_KEYS) {
      return { allowed: false, remaining: 0, retryAfterMs: Math.ceil(increment) };
    }
    const theoreticalArrivalAt = existing?.theoreticalArrivalAt ?? current;
    const allowAt = theoreticalArrivalAt - burstTolerance;
    if (current < allowAt) {
      if (existing) existing.lastSeenAt = current;
      return { allowed: false, remaining: 0, retryAfterMs: Math.ceil(allowAt - current) };
    }
    const nextArrivalAt = Math.max(current, theoreticalArrivalAt) + increment;
    states.set(key, { theoreticalArrivalAt: nextArrivalAt, lastSeenAt: current });
    const remaining = Math.max(0, Math.min(capacity - 1, Math.floor((current + burstTolerance - nextArrivalAt) / increment) + 1));
    return { allowed: true, remaining, retryAfterMs: 0 };
  };
}

export function createRateLimiter(options?: {
  windowMs?: number;
  maxRequests?: number;
  key?: (req: Request) => string;
}): (req: Request, res: Response, next: NextFunction) => void {
  const cfg = getConfig();
  const windowMs = options?.windowMs ?? cfg.RATE_LIMIT_WINDOW_MS;
  const maxRequests = options?.maxRequests ?? cfg.RATE_LIMIT_MAX_REQUESTS;
  if (!Number.isSafeInteger(windowMs) || windowMs < 100 || !Number.isSafeInteger(maxRequests) || maxRequests < 1) {
    throw new Error("Rate-limit policy is invalid.");
  }

  const keyFn = options?.key ?? ((req: Request) => `network:${req.ip ?? "unknown"}|route:${req.path}`);
  const localAdmission = localGcra(windowMs, maxRequests);
  const distributed = cfg.NODE_ENV === "production"
    ? new DistributedAdmissionClient(cfg.ADMISSION_API_ORIGIN ?? "", cfg.ADMISSION_WORKLOAD_TOKEN ?? "")
    : undefined;
  const keySecret = cfg.RATE_LIMIT_KEY_SECRET ?? cfg.SESSION_SECRET;

  return (req: Request, res: Response, next: NextFunction) => {
    const route = `${req.baseUrl}${req.path}` || "/";
    const rawKey = keyFn(req);
    const keyDigest = createHmac("sha256", keySecret).update(rawKey).digest("hex");
    const decide = distributed
      ? distributed.check({
          keyDigest,
          route,
          capacity: maxRequests,
          refillTokens: maxRequests,
          refillIntervalMs: windowMs,
          cost: 1,
          deadlineAt: Date.now() + 2_000,
        })
      : Promise.resolve(localAdmission(keyDigest));

    void decide.then((decision) => {
      res.setHeader("X-RateLimit-Limit", String(maxRequests));
      res.setHeader("X-RateLimit-Remaining", String(decision.remaining));
      if (!decision.allowed) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil(decision.retryAfterMs / 1_000))));
        res.status(429).json({ error: "RATE_LIMITED" });
        return;
      }
      next();
    }).catch(() => {
      res.setHeader("Retry-After", "1");
      res.status(503).json({ error: "ADMISSION_UNAVAILABLE" });
    });
  };
}

export function createAuthRateLimiter() {
  const cfg = getConfig();
  return createRateLimiter({
    windowMs: cfg.RATE_LIMIT_WINDOW_MS,
    maxRequests: cfg.AUTH_RATE_LIMIT_MAX_REQUESTS,
    key: (req) => `network:${req.ip ?? "unknown"}|route:${req.path}`,
  });
}
