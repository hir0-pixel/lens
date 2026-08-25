import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { AuditAdmissionError, AuditLedger } from "../../../services/audit/AuditLedger";
import { IngestionError, type IngestionRequest } from "../../../services/ingestion";
import type { IngestionDeployment } from "../../../services/ingestion/ProductionIngestionWiring";
import { computeCompanyRagProfileDigest } from "../../../services/rag-profile/companyRagProfile";
import type { AuthService } from "../auth/authService";
import { getConfig } from "../config";
import { requireAdmin } from "./providers";

const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const ingestionSchema = z.object({
  sourceId: z.string().min(1),
  documentRef: z.string().min(1),
  version: z.string().min(1),
  versionRef: z.string().min(1),
  contentDigest: sha256,
  aclDigest: sha256,
  classificationRef: z.enum(["public", "internal", "confidential", "restricted"]),
  parse: z.object({
    status: z.enum(["accepted", "quarantined"]),
    renditionDigest: sha256,
    chunks: z.array(z.object({
      chunkRef: z.string().min(1),
      contentDigest: sha256,
      text: z.string().min(1),
      citationAnchor: z.string().min(1),
    })),
    quarantineReason: z.string().optional(),
  }),
  profileRef: z.string().optional(),
  contentBytes: z.number().int().nonnegative().optional(),
  ragProfileVersion: z.number(),
  ragProfileDigest: sha256,
});

const statusByError: Record<IngestionError["code"], number> = {
  INVALID_ARGUMENT: 400,
  CONFLICT: 409,
  QUARANTINED: 422,
  STALE_AUTHORITY: 409,
  DEPENDENCY_UNAVAILABLE: 503,
  BACKPRESSURE: 429,
  POISONED: 503,
};

function respondIngestionError(res: Response, error: unknown): boolean {
  if (!(error instanceof IngestionError)) return false;
  res.status(statusByError[error.code]).json({ error: error.code });
  return true;
}

function jobResponse(job: { jobId: string; state: string; stage: string }) {
  return { jobId: job.jobId, state: job.state, stage: job.stage };
}

function appendAudit(auditLedger: AuditLedger, input: { eventId: string; partitionKey: string; eventType: "ingestion.job.submitted" | "ingestion.job.withdrawn"; intentDigest: string; byteLength: number }): void {
  try {
    auditLedger.appendIntent({ workloadId: "ingestion", attested: true }, { ...input, requestId: input.eventId, action: input.eventType === "ingestion.job.submitted" ? "ingestion.submit" : "ingestion.withdraw" });
  } catch (error) {
    if (!(error instanceof AuditAdmissionError) || error.code !== "AUDIT_EVENT_ID_CONFLICT") throw error;
  }
}

export function createIngestionRouter(options: { auth: AuthService; ingestion: IngestionDeployment; auditLedger: AuditLedger }): Router {
  const router = Router();
  const cfg = getConfig();

  function gate(req: Request) {
    return requireAdmin(options.auth, req.cookies?.[cfg.SESSION_COOKIE_NAME]);
  }

  router.post("/corpora/:corpusRef/jobs", async (req, res) => {
    const authorization = await gate(req);
    if (!authorization.ok) {
      res.status(authorization.status).json({ error: authorization.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" });
      return;
    }
    const service = options.ingestion.services.get(req.params.corpusRef);
    if (!service) {
      res.status(400).json({ error: "INVALID_ARGUMENT" });
      return;
    }
    const parsed = ingestionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_ARGUMENT" });
      return;
    }
    const { ragProfileVersion, ragProfileDigest, ...request } = parsed.data;
    if (ragProfileVersion !== options.ingestion.ragProfile.profileVersion || ragProfileDigest !== computeCompanyRagProfileDigest(options.ingestion.ragProfile)) {
      res.status(409).json({ error: "STALE_AUTHORITY" });
      return;
    }
    try {
      const normalizedProfileRef = request.profileRef ?? "default-ingestion-profile";
      const eventId = `ingest:${request.sourceId}:${request.version}:${normalizedProfileRef}`;
      appendAudit(options.auditLedger, {
        eventId,
        partitionKey: request.versionRef,
        eventType: "ingestion.job.submitted",
        intentDigest: request.contentDigest,
        byteLength: JSON.stringify(req.body).length,
      });
      const job = await service.enqueueIngest(request as IngestionRequest);
      res.status(202).json(jobResponse(job));
    } catch (error) {
      if (error instanceof AuditAdmissionError) {
        res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
      } else if (!respondIngestionError(res, error)) {
        res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
      }
    }
  });

  router.post("/corpora/:corpusRef/jobs/:versionRef/withdraw", async (req, res) => {
    const authorization = await gate(req);
    if (!authorization.ok) {
      res.status(authorization.status).json({ error: authorization.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" });
      return;
    }
    const service = options.ingestion.services.get(req.params.corpusRef);
    if (!service) {
      res.status(400).json({ error: "INVALID_ARGUMENT" });
      return;
    }
    try {
      const eventId = `delete:${req.params.versionRef}`;
      const version = await service.version(req.params.versionRef);
      appendAudit(options.auditLedger, {
        eventId,
        partitionKey: req.params.versionRef,
        eventType: "ingestion.job.withdrawn",
        intentDigest: version?.request.contentDigest ?? req.params.versionRef,
        byteLength: JSON.stringify(req.body ?? {}).length,
      });
      const job = await service.enqueueWithdraw(req.params.versionRef);
      res.status(202).json(jobResponse(job));
    } catch (error) {
      if (error instanceof AuditAdmissionError) {
        res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
      } else if (!respondIngestionError(res, error)) {
        res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
      }
    }
  });

  router.get("/corpora/:corpusRef/jobs/:versionRef", async (req, res) => {
    const authorization = await gate(req);
    if (!authorization.ok) {
      res.status(authorization.status).json({ error: authorization.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" });
      return;
    }
    const service = options.ingestion.services.get(req.params.corpusRef);
    if (!service) {
      res.status(400).json({ error: "INVALID_ARGUMENT" });
      return;
    }
    const version = await service.version(req.params.versionRef);
    if (!version) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    res.json({ state: version.state, stage: version.stage, resourceSecurityRevision: version.resourceSecurityRevision, generation: version.generation });
  });

  return router;
}
