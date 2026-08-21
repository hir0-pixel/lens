import express, { NextFunction, Request, Response } from "express";
import cookieParser from "cookie-parser";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig, validateProductionConfig } from "./config";
import { createAuthService } from "./auth/authService";
import { createAuthRouter } from "./routes/auth";
import { createApiRouter } from "./routes/api";
import { corsMiddleware } from "./middleware/cors";
import { csrfProtection } from "./middleware/csrf";
import { createSessionManager } from "./auth/sessionManager";
import { OrchestratorClient } from "./rag/orchestratorClient";

export function createApp(options?: {
  authService?: ReturnType<typeof createAuthService>;
  generateHandler?: (input: { prompt: string; subject: string }) => Promise<string>;
  ragHandler?: (input: { requestId: string; query: string; subject: string; sessionRef: string; deviceRef: string }, signal: AbortSignal) => Promise<{ output: string; citations: readonly { source: string; section: string }[] }>;
  logger?: Pick<typeof console, "error" | "warn">;
}) {
  validateProductionConfig();
  const cfg = getConfig();
  const sessionManager = createSessionManager();
  const auth = options?.authService ?? createAuthService({ sessionManager });
  const logger = options?.logger ?? console;

  const orchestratorClient = cfg.RAG_PROVIDER_MODE === "internal" && cfg.ORCHESTRATOR_URL && cfg.ORCHESTRATOR_TOKEN
    ? new OrchestratorClient(cfg.ORCHESTRATOR_URL, cfg.ORCHESTRATOR_TOKEN)
    : undefined;
  const ragHandler = options?.ragHandler ?? (orchestratorClient
    ? (input: { requestId: string; query: string; subject: string; sessionRef: string; deviceRef: string }, signal: AbortSignal) => orchestratorClient.ask({
        requestId: input.requestId,
        query: input.query,
        subjectRef: input.subject,
        sessionRef: input.sessionRef,
        deviceRef: input.deviceRef,
        applicationId: "lens-employee-client",
        purposeRef: "assistant",
        retrievalClass: "enterprise-grounded",
        deadlineMs: 60_000,
        retryBudget: 0,
      }, signal)
    : undefined);

  const app = express();
  app.disable("x-powered-by");

  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "32kb", strict: true, type: "application/json" }));
  app.use(cookieParser());
  app.use(corsMiddleware());

  app.use("/auth", createAuthRouter({ auth }));
  app.use("/api", csrfProtection({ getSessionCsrf: (cookieValue) => sessionManager.readSession(cookieValue)?.csrfToken }));
  app.use("/api", createApiRouter({ auth, ragHandler }));

  app.use("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "NOT_FOUND" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const bodyError = err as { type?: unknown; status?: unknown; name?: unknown };
    if (bodyError?.type === "entity.too.large" || bodyError?.status === 413) {
      res.status(413).json({ error: "PAYLOAD_TOO_LARGE" });
      return;
    }
    if (bodyError?.type === "entity.parse.failed") {
      res.status(400).json({ error: "INVALID_JSON" });
      return;
    }
    logger.error("Unhandled error", { name: typeof bodyError?.name === "string" ? bodyError.name : "Error" });
    res.status(500).json({ error: "INTERNAL_ERROR" });
  });

  return app;
}

export function startServer(): void {
  const cfg = getConfig();
  const app = createApp();
  app.listen(cfg.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Lens BFF listening on :${cfg.PORT}`);
  });
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  startServer();
}
