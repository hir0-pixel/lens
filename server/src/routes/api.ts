import { randomUUID } from "node:crypto";
import { Router } from "express";
import { getConfig } from "../config";
import type { AuthService } from "../auth/authService";
import { createRateLimiter } from "../middleware/rateLimit";
import { createHash } from "node:crypto";
import { ConversationReferenceCodec, ConversationReferenceError } from "../security/conversationReference";
import { DelegatedSessionAssertionIssuer } from "../../../services/security/delegatedSessionAssertion";
import { LENS_WORKSPACE_REF, LENS_REQUEST_CLASS, LENS_PURPOSE_REF } from "../../../services/security/workspaceContext";
import { isAdministrator, createProviderRouter } from "./providers";
import type { ProviderOnboardingService } from "../../../services/provider-registry/onboard";
import type { CompanyRagProfile } from "../../../services/rag-profile/companyRagProfile";
import { employeeModelDoesNotAffectRag } from "../../../services/rag-profile/companyRagProfile";
import { createIngestionRouter } from "./ingestion";
import type { IngestionDeployment } from "../../../services/ingestion/ProductionIngestionWiring";
import type { AuditLedger } from "../../../services/audit/AuditLedger";
import { OrchestratorClientError } from "../rag/orchestratorClient";

const MAX_PROMPT_LENGTH = 12_000;
const MODEL_REF_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export interface RagHandlerResult {
  output: string;
  citations: readonly { source: string; section: string }[];
}

function queryDigest(query: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(query, "utf8").digest("hex")}`;
}

export function createApiRouter(options: {
  auth: AuthService;
  ragHandler?: (input: { requestId: string; query: string; subject: string; sessionRef: string; deviceRef: string; conversationRef: string; sessionAssertion: string; memorySessionAssertion: string; modelRef?: string }, signal: AbortSignal) => Promise<RagHandlerResult>;
  conversationReferenceCodec?: ConversationReferenceCodec;
  sessionAssertionIssuer?: DelegatedSessionAssertionIssuer;
  memoryAssertionIssuer?: DelegatedSessionAssertionIssuer;
  onboarding?: ProviderOnboardingService;
  ragProfile?: CompanyRagProfile;
  ingestionDeployment?: IngestionDeployment;
  auditLedger?: AuditLedger;
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
    const administrator = Boolean(session.authenticated && session.subject && isAdministrator(session.subject));
    const adminSubjectsConfigured = Boolean((process.env.ADMIN_SUBJECTS ?? getConfig().ADMIN_SUBJECTS ?? "").trim());
    res.json({ ...session, administrator, adminSubjectsConfigured });
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
    const modelId = req.body?.modelId;
    if (modelId !== undefined && (typeof modelId !== "string" || !MODEL_REF_PATTERN.test(modelId))) {
      res.status(400).json({ error: "INVALID_ARGUMENT" });
      return;
    }
    if (req.body?.apiKey !== undefined || req.body?.baseUrl !== undefined || req.body?.provider !== undefined) {
      res.status(400).json({ error: "INVALID_ARGUMENT" });
      return;
    }
    if (modelId && options.onboarding) {
      const catalog = await options.onboarding.employeeCatalog();
      const listed = catalog.find((model) => model.modelRef === modelId && model.available);
      if (!listed) {
        res.status(403).json({ error: "MODEL_NOT_ELIGIBLE", reason: "The selected model is not in the approved employee catalog." });
        return;
      }
      if (options.ragProfile && !employeeModelDoesNotAffectRag(options.ragProfile, modelId)) {
        res.status(403).json({ error: "MODEL_NOT_ELIGIBLE", reason: "The selected model is not eligible for governed document RAG." });
        return;
      }
    }
    if (!options.ragHandler) {
      res.status(503).json({ error: "RAG_NOT_CONFIGURED" });
      return;
    }
    const conversationCodec = options.conversationReferenceCodec;
    const assertionIssuer = options.sessionAssertionIssuer;
    const memoryAssertionIssuer = options.memoryAssertionIssuer;
    if (!conversationCodec || !assertionIssuer || !memoryAssertionIssuer) {
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
      return;
    }
    const requestId = randomUUID();
    const suppliedConversationRef = req.body?.conversationRef;
    const suppliedCreationKey = req.body?.conversationCreationKey;
    let conversationRef: string;
    try {
      if (suppliedConversationRef === undefined) {
        conversationRef = conversationCodec.issue(session.subject, suppliedCreationKey);
      } else {
        if (typeof suppliedConversationRef !== "string") throw new ConversationReferenceError("conversation_ref is invalid.");
        conversationCodec.verify(suppliedConversationRef, session.subject);
        conversationRef = suppliedConversationRef;
      }
    } catch (error) {
      if (error instanceof ConversationReferenceError) {
        res.status(403).json({ error: "CONVERSATION_REF_INVALID", reason: "The chat session reference is stale. Starting a fresh turn." });
        return;
      }
      res.status(403).json({ error: "FORBIDDEN" });
      return;
    }
    const sessionAssertion = assertionIssuer.issue({
      issuer: "bff",
      audience: "orchestrator",
      requestId,
      subjectRef: session.subject,
      sessionRef: session.sessionRef,
      deviceRef: session.deviceRef,
      conversationRef,
      queryDigest: queryDigest(query),
      workspaceRef: LENS_WORKSPACE_REF,
      requestClass: LENS_REQUEST_CLASS,
      purposeRef: LENS_PURPOSE_REF,
    });
    const memorySessionAssertion = memoryAssertionIssuer.issue({
      issuer: "bff",
      audience: "memory",
      requestId,
      subjectRef: session.subject,
      sessionRef: session.sessionRef,
      deviceRef: session.deviceRef,
      conversationRef,
      queryDigest: queryDigest(query),
      workspaceRef: LENS_WORKSPACE_REF,
      requestClass: LENS_REQUEST_CLASS,
      purposeRef: LENS_PURPOSE_REF,
    });

    const controller = new AbortController();
    req.once("aborted", () => controller.abort());
    try {
      const result = await options.ragHandler(
        { requestId, query, subject: session.subject, sessionRef: session.sessionRef, deviceRef: session.deviceRef, conversationRef, sessionAssertion, memorySessionAssertion, ...(modelId ? { modelRef: modelId } : {}) },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      res.json({ output: result.output, citations: result.citations, conversationRef });
    } catch (error) {
      if (!res.headersSent) {
        if (error instanceof OrchestratorClientError && error.code === "FORBIDDEN") {
          res.status(403).json({ error: "FORBIDDEN", ...(error.reason ? { reason: error.reason } : {}) });
        } else if (error instanceof OrchestratorClientError) {
          res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE", ...(error.reason ? { reason: error.reason } : {}) });
        } else {
          res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
        }
      }
    }
  });

  if (options.onboarding) {
    router.use(createProviderRouter({
      auth: options.auth,
      onboarding: options.onboarding,
      ragProfile: options.ragProfile,
    }));
  }
  if (options.ingestionDeployment && options.auditLedger) {
    router.use("/admin/ingestion", createIngestionRouter({ auth: options.auth, ingestion: options.ingestionDeployment, auditLedger: options.auditLedger }));
  }

  return router;
}
