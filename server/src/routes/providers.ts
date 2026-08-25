import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { AuthService } from "../auth/authService";
import { getConfig } from "../config";
import { ProviderOnboardError, type ProviderOnboardingService } from "../../../services/provider-registry/onboard";
import { IdempotencyConflictError } from "../../../services/provider-registry/ProviderRegistry";
import type { CompanyRagProfile } from "../../../services/rag-profile/companyRagProfile";
import { employeeModelDoesNotAffectRag } from "../../../services/rag-profile/companyRagProfile";
import type { AdapterType } from "../../../services/model-provider/ProviderAdapter";

export function isAdministrator(subject: string): boolean {
  const cfg = getConfig();
  const allowed = (cfg.ADMIN_SUBJECTS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return allowed.some((candidate) => {
    const a = Buffer.from(candidate);
    const b = Buffer.from(subject);
    return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
  });
}

const onboardSchema = z.object({
  adapterType: z.enum(["openai-compatible"]),
  baseUrl: z.string().url(),
  apiKey: z.string().min(8).max(4096),
  tlsWorkloadRef: z.string().min(1).max(128),
  allowedModels: z.array(z.string().min(1).max(64)).min(1).max(64),
  capabilities: z.array(z.enum(["generate", "embed", "stream"])).min(1),
  timeoutMs: z.number().int().min(100).max(300_000),
  maxConcurrency: z.number().int().min(1).max(256),
  idempotencyKey: z.string().min(8).max(128),
});

export async function requireAdmin(auth: AuthService, cookieValue: string | undefined): Promise<{ ok: true; subject: string } | { ok: false; status: 401 | 403 }> {
  const session = await auth.getTrustedSession(cookieValue);
  if (!session.authenticated || !session.subject) return { ok: false, status: 401 };
  if (!isAdministrator(session.subject)) return { ok: false, status: 403 };
  return { ok: true, subject: session.subject };
}

export function createProviderRouter(options: {
  auth: AuthService;
  onboarding: ProviderOnboardingService;
  ragProfile?: CompanyRagProfile;
}): Router {
  const router = Router();
  const cfg = getConfig();

  router.get("/models", async (req, res) => {
    const cookieValue = req.cookies?.[cfg.SESSION_COOKIE_NAME];
    const session = await options.auth.getTrustedSession(cookieValue);
    if (!session.authenticated) {
      res.status(401).json({ error: "UNAUTHENTICATED" });
      return;
    }
    try {
      let models = [...(await options.onboarding.employeeCatalog())];
      if (options.ragProfile) {
        models = models.filter((model) => employeeModelDoesNotAffectRag(options.ragProfile!, model.modelRef));
      }
      res.json({
        models: models.map((model) => ({ modelRef: model.modelRef, label: model.label, available: model.available })),
      });
    } catch {
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
    }
  });

  router.post("/admin/providers", async (req, res) => {
    const gate = await requireAdmin(options.auth, req.cookies?.[cfg.SESSION_COOKIE_NAME]);
    if (!gate.ok) {
      res.status(gate.status).json({ error: gate.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" });
      return;
    }
    const parsed = onboardSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_ARGUMENT" });
      return;
    }
    try {
      const result = await options.onboarding.onboard({
        adapterType: parsed.data.adapterType as AdapterType,
        baseUrl: parsed.data.baseUrl,
        apiKey: parsed.data.apiKey,
        tlsWorkloadRef: parsed.data.tlsWorkloadRef,
        allowedModels: parsed.data.allowedModels,
        capabilities: parsed.data.capabilities,
        timeoutMs: parsed.data.timeoutMs,
        maxConcurrency: parsed.data.maxConcurrency,
        profile: cfg.PROVIDER_PROFILE,
        idempotencyKey: parsed.data.idempotencyKey,
      });
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        res.status(409).json({ error: "IDEMPOTENCY_CONFLICT" });
        return;
      }
      if (error instanceof ProviderOnboardError) {
        const status = error.code === "INVALID_ARGUMENT" ? 400 : error.code === "INVALID_KEY" ? 403 : 503;
        res.status(status).json({ error: error.code });
        return;
      }
      res.status(503).json({ error: "PROVIDER_UNAVAILABLE" });
    }
  });

  router.post("/admin/providers/:id/disable", async (req, res) => {
    const gate = await requireAdmin(options.auth, req.cookies?.[cfg.SESSION_COOKIE_NAME]);
    if (!gate.ok) {
      res.status(gate.status).json({ error: gate.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" });
      return;
    }
    try {
      res.json(await options.onboarding.disable(req.params.id));
    } catch {
      res.status(404).json({ error: "NOT_FOUND" });
    }
  });

  router.post("/admin/providers/:id/catalog/refresh", async (req, res) => {
    const gate = await requireAdmin(options.auth, req.cookies?.[cfg.SESSION_COOKIE_NAME]);
    if (!gate.ok) {
      res.status(gate.status).json({ error: gate.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" });
      return;
    }
    try {
      res.json(await options.onboarding.refreshCatalog(req.params.id));
    } catch (error) {
      if (error instanceof ProviderOnboardError) {
        res.status(error.code === "NOT_FOUND" ? 404 : 503).json({ error: error.code });
        return;
      }
      res.status(503).json({ error: "PROVIDER_UNAVAILABLE" });
    }
  });

  return router;
}
