import { NextFunction, Request, Response } from "express";
import { getConfig } from "../config";

interface RateLimitState {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options?: {
  windowMs?: number;
  maxRequests?: number;
  key?: (req: Request) => string;
}): (req: Request, res: Response, next: NextFunction) => void {
  const cfg = getConfig();
  const windowMs = options?.windowMs ?? cfg.RATE_LIMIT_WINDOW_MS;
  const maxRequests = options?.maxRequests ?? cfg.RATE_LIMIT_MAX_REQUESTS;
  const buckets = new Map<string, RateLimitState>();
  const keyFn = options?.key ?? ((req: Request) => `${req.ip ?? "unknown"}:${req.path}`);

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyFn(req);
    const now = Date.now();
    let state = buckets.get(key);
    if (!state || state.resetAt <= now) {
      state = { count: 0, resetAt: now + windowMs };
      buckets.set(key, state);
    }
    state.count += 1;
    if (state.count > maxRequests) {
      res.status(429).json({ error: "RATE_LIMITED" });
      return;
    }
    res.setHeader("X-RateLimit-Limit", String(maxRequests));
    res.setHeader("X-RateLimit-Remaining", String(maxRequests - state.count));
    next();
  };
}

export function createAuthRateLimiter() {
  const cfg = getConfig();
  return createRateLimiter({
    windowMs: cfg.RATE_LIMIT_WINDOW_MS,
    maxRequests: cfg.AUTH_RATE_LIMIT_MAX_REQUESTS,
    key: (req) => req.ip ?? "unknown",
  });
}
