import { Router, Response } from "express";
import { getConfig } from "../config";
import type { AuthService } from "../auth/authService";
import { createRateLimiter } from "../middleware/rateLimit";

const MAX_PROMPT_LENGTH = 12_000;
const MAX_OUTPUT_LENGTH = 1_000_000;

export function createApiRouter(options: {
  auth: AuthService;
  generateHandler: (input: { prompt: string; subject: string }) => Promise<string>;
}): Router {
  const router = Router();
  const cfg = getConfig();
  const rateLimiter = createRateLimiter();

  router.get("/session", rateLimiter, async (req, res) => {
    const cookieValue = req.cookies?.[cfg.SESSION_COOKIE_NAME];
    const session = await options.auth.getSessionInfo(cookieValue);
    res.json(session);
  });

  router.post("/generate", rateLimiter, async (req, res) => {
    const cookieValue = req.cookies?.[cfg.SESSION_COOKIE_NAME];
    const session = await options.auth.getSessionInfo(cookieValue);
    if (!session.authenticated || !session.subject) {
      res.status(401).json({ error: "UNAUTHENTICATED" });
      return;
    }
    const prompt = req.body?.prompt;
    if (typeof prompt !== "string" || prompt.trim().length === 0 || prompt.length > MAX_PROMPT_LENGTH) {
      res.status(400).json({ error: "INVALID_REQUEST" });
      return;
    }
    try {
      const output = await options.generateHandler(
        { prompt, subject: session.subject },
      );
      if (typeof output !== "string" || output.length > MAX_OUTPUT_LENGTH) {
        res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
        return;
      }
      res.json({ output });
    } catch {
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
    }
  });

  return router;
}
