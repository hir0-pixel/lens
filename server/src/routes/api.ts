import { randomUUID } from "node:crypto";
import { Router } from "express";
import { getConfig } from "../config";
import type { AuthService } from "../auth/authService";
import { createRateLimiter } from "../middleware/rateLimit";

const MAX_PROMPT_LENGTH = 12_000;

export interface RagHandlerResult {
  output: string;
  citations: readonly { source: string; section: string }[];
}

export function createApiRouter(options: {
  auth: AuthService;
  ragHandler?: (input: { requestId: string; query: string; subject: string; sessionRef: string; deviceRef: string }, signal: AbortSignal) => Promise<RagHandlerResult>;
}): Router {
  const router = Router();
  const cfg = getConfig();
  const rateLimiter = createRateLimiter({
    key: (req) => {
      const cookieValue = req.cookies?.[cfg.SESSION_COOKIE_NAME];
      const principal = options.auth.getRateLimitPrincipal(cookieValue) ?? "anonymous";
      return `${principal}|network:${req.ip ?? "unknown"}|route:${req.path}`;
    },
  });

  router.get("/session", rateLimiter, async (req, res) => {
    const cookieValue = req.cookies?.[cfg.SESSION_COOKIE_NAME];
    const session = await options.auth.getSessionInfo(cookieValue);
    res.json(session);
  });

  router.post("/rag/ask", rateLimiter, async (req, res) => {
    const cookieValue = req.cookies?.[cfg.SESSION_COOKIE_NAME];
    const session = await options.auth.getTrustedSession(cookieValue);
    if (!session.authenticated || !session.subject || !session.sessionRef || !session.deviceRef) {
      res.status(401).json({ error: "UNAUTHENTICATED" });
      return;
    }
    const query = req.body?.query;
    if (typeof query !== "string" || query.trim().length === 0 || query.length > MAX_PROMPT_LENGTH) {
      res.status(400).json({ error: "INVALID_ARGUMENT" });
      return;
    }
    if (!options.ragHandler) {
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
      return;
    }

    const controller = new AbortController();
    req.once("aborted", () => controller.abort());
    try {
      const result = await options.ragHandler(
        { requestId: randomUUID(), query, subject: session.subject, sessionRef: session.sessionRef, deviceRef: session.deviceRef },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      res.json({ output: result.output, citations: result.citations });
    } catch {
      if (!res.headersSent) res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
    }
  });

  return router;
}
