import { createHash } from "node:crypto";
import express, { NextFunction, Request, Response } from "express";
import cookieParser from "cookie-parser";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { getConfig, validateProductionConfig } from "./config";
import { createAuthService } from "./auth/authService";
import { createAuthRouter } from "./routes/auth";
import { createApiRouter } from "./routes/api";
import { corsMiddleware } from "./middleware/cors";
import { csrfProtection } from "./middleware/csrf";
import { createSessionManager } from "./auth/sessionManager";
import { OrchestratorClient } from "./rag/orchestratorClient";
import { createOrchestratorReadinessCheck } from "./health";
import { ConversationReferenceCodec } from "./security/conversationReference";
import { DelegatedSessionAssertionIssuer } from "../../services/security/delegatedSessionAssertion";
import { EncryptedSqliteSecretStore, MemorySecretStore, type SecretStore } from "../../services/secrets/SecretStore";
import { SqliteProviderRegistry } from "../../services/provider-registry/ProviderRegistry";
import { ProviderOnboardingService, ProviderOnboardError } from "../../services/provider-registry/onboard";
import { assertCompanyRagProfile, computeCompanyRagProfileDigest, type CompanyRagProfile } from "../../services/rag-profile/companyRagProfile";
import type { AuditLedger } from "../../services/audit/AuditLedger";
import { createIngestionDeployment, type IngestionDeployment } from "../../services/ingestion";
import { createRetrievalDeployment, type RetrievalDeployment } from "../../services/retrieval/ProductionRetrievalWiring";
import { createModelProviderAdapter } from "../../services/model-provider/createModelProviderAdapter";
import { createLocalIngestionEmbeddingAdapter } from "./rag/localIngestionEmbedding";
import { rehydrateCorpusIndexes } from "./rag/rehydrateCorpus";
import { createRetrievalHttp } from "../../retrieval-service/src/http";
import type { ModelProviderAdapter } from "../../services/model-provider/ProviderAdapter";

export const EMBEDDING_PROVIDER_BOUNDARY_LIMITATION = "Embeddings use an in-process provider adapter holding a live secret; unlike generation, this does not yet route through the sidecar secret-capability boundary. Temporary, disclosed, non-GO limitation. Upgrade path: extend the provider-runtime-config/provider-secret sidecar pattern to embedding calls.";

const PROVIDER_SECRET_CAPABILITY_TTL_MS = 60_000;

interface ProviderSecretCapability {
  readonly secretRef: string;
  readonly providerId: string;
  readonly modelRef: string;
  readonly expiresAt: number;
}

export function createApp(options?: {
  authService?: ReturnType<typeof createAuthService>;
  generateHandler?: (input: { prompt: string; subject: string }) => Promise<string>;
  ragHandler?: (input: { requestId: string; query: string; subject: string; sessionRef: string; deviceRef: string; conversationRef: string; sessionAssertion: string; memorySessionAssertion: string; modelRef?: string }, signal: AbortSignal) => Promise<{ output: string; citations: readonly { source: string; section: string }[] }>;
  conversationReferenceCodec?: ConversationReferenceCodec;
  sessionAssertionIssuer?: DelegatedSessionAssertionIssuer;
  memoryAssertionIssuer?: DelegatedSessionAssertionIssuer;
  logger?: Pick<typeof console, "error" | "warn">;
  onboarding?: ProviderOnboardingService;
  secrets?: SecretStore;
  discoverFetch?: typeof fetch;
  ragProfile?: CompanyRagProfile;
  ingestionDeployment?: IngestionDeployment;
  auditLedger?: AuditLedger;
}) {
  validateProductionConfig();
  const cfg = getConfig();
  const sessionManager = createSessionManager();
  const auth = options?.authService ?? createAuthService({ sessionManager });
  const logger = options?.logger ?? console;
  const conversationReferenceCodec = options?.conversationReferenceCodec ?? (cfg.CONVERSATION_REFERENCE_SECRET ? new ConversationReferenceCodec(cfg.CONVERSATION_REFERENCE_SECRET) : undefined);
  const sessionAssertionIssuer = options?.sessionAssertionIssuer ?? (cfg.BFF_ASSERTION_PRIVATE_KEY ? new DelegatedSessionAssertionIssuer(cfg.BFF_ASSERTION_PRIVATE_KEY) : undefined);
  const memoryAssertionIssuer = options?.memoryAssertionIssuer ?? (cfg.MEMORY_ASSERTION_PRIVATE_KEY ? new DelegatedSessionAssertionIssuer(cfg.MEMORY_ASSERTION_PRIVATE_KEY) : undefined);

  const orchestratorClient = cfg.RAG_PROVIDER_MODE === "internal" && cfg.ORCHESTRATOR_URL && cfg.ORCHESTRATOR_TOKEN
    ? new OrchestratorClient(cfg.ORCHESTRATOR_URL, cfg.ORCHESTRATOR_TOKEN)
    : undefined;
  const ragHandler = options?.ragHandler ?? (orchestratorClient
    ? (input: { requestId: string; query: string; subject: string; sessionRef: string; deviceRef: string; conversationRef: string; sessionAssertion: string; memorySessionAssertion: string; modelRef?: string }, signal: AbortSignal) => orchestratorClient.ask({
        requestId: input.requestId,
        query: input.query,
        subjectRef: input.subject,
        sessionRef: input.sessionRef,
        deviceRef: input.deviceRef,
        conversationRef: input.conversationRef,
        sessionAssertion: input.sessionAssertion,
        memorySessionAssertion: input.memorySessionAssertion,
        applicationId: "lens-employee-client",
        purposeRef: "assistant",
        retrievalClass: "enterprise-grounded",
        deadlineMs: 60_000,
        retryBudget: 0,
        modelRef: input.modelRef,
      }, signal)
    : undefined);

  const ragProfile = options?.ragProfile ?? (cfg.COMPANY_RAG_PROFILE_JSON
    ? assertCompanyRagProfile(JSON.parse(cfg.COMPANY_RAG_PROFILE_JSON))
    : undefined);
  const secrets = options?.secrets ?? (cfg.SECRET_STORE_KEY
    ? new EncryptedSqliteSecretStore(`${cfg.PROVIDER_REGISTRY_PATH ?? "providers.sqlite"}.secrets`, cfg.SECRET_STORE_KEY)
    : new MemorySecretStore());
  const onboarding = options?.onboarding ?? new ProviderOnboardingService(
    new SqliteProviderRegistry(cfg.PROVIDER_REGISTRY_PATH ?? ":memory:"),
    secrets,
    options?.discoverFetch ?? fetch,
  );

  let ingestionDeployment = options?.ingestionDeployment;
  let ingestionAuditLedger = options?.auditLedger;
  let retrievalForIngestion: RetrievalDeployment | undefined;
  let corpusRehydrate: Promise<void> | undefined;
  if (!ingestionDeployment && cfg.INGESTION_ENABLED) {
    const profile = ragProfile;
    if (!profile) throw new Error("INGESTION_ENABLED requires COMPANY_RAG_PROFILE_JSON");
    const useLocalEmbeddings = cfg.INGESTION_USE_LOCAL_EMBEDDINGS === true;
    if (!useLocalEmbeddings) {
      const required = {
        adapterType: cfg.INGESTION_PROVIDER_ADAPTER,
        baseUrl: cfg.INGESTION_PROVIDER_BASE_URL,
        secretRef: cfg.INGESTION_PROVIDER_SECRET_REF,
        tlsWorkloadRef: cfg.INGESTION_PROVIDER_TLS_WORKLOAD_REF,
        model: cfg.INGESTION_PROVIDER_MODEL,
        allowedModels: cfg.INGESTION_PROVIDER_ALLOWED_MODELS,
        AUDIT_LEDGER_STORE_PATH: cfg.AUDIT_LEDGER_STORE_PATH,
      };
      const missing = Object.entries(required).filter(([, value]) => !value).map(([key]) => key);
      if (missing.length > 0) throw new Error(`Ingestion configuration missing required values: ${missing.join(", ")}`);
    } else if (!cfg.AUDIT_LEDGER_STORE_PATH) {
      throw new Error("Ingestion configuration missing required values: AUDIT_LEDGER_STORE_PATH");
    }
    const indexProfile = {
      embeddingModelDigest: computeCompanyRagProfileDigest(profile),
      tokenizerDigest: `sha256:${"b".repeat(64)}` as `sha256:${string}`,
      vectorDimensions: 768,
      distanceMetric: "cosine" as const,
      chunkingProfile: "markdown-headings",
      schemaVersion: "rag-v1",
    };
    const ragProfileDigest = computeCompanyRagProfileDigest(profile);
    // This adapter holds a live provider secret in-process for embedding calls, unlike text generation which routes secrets through the workload-token-gated, short-TTL sidecar capability boundary (/internal/v1/provider-runtime-config + /internal/v1/provider-secret/:secretRef). This is a disclosed, temporary, non-GO production limitation; upgrade path: extend that pattern to embedding invocations.
    const provider: ModelProviderAdapter = useLocalEmbeddings
      ? createLocalIngestionEmbeddingAdapter(768)
      : createModelProviderAdapter({
          adapterType: cfg.INGESTION_PROVIDER_ADAPTER!,
          baseUrl: cfg.INGESTION_PROVIDER_BASE_URL!,
          secretRef: cfg.INGESTION_PROVIDER_SECRET_REF!,
          tlsWorkloadRef: cfg.INGESTION_PROVIDER_TLS_WORKLOAD_REF!,
          allowedModels: cfg.INGESTION_PROVIDER_ALLOWED_MODELS!.split(",").map((model) => model.trim()).filter(Boolean),
          expectedCapabilities: ["embed"],
          timeoutMs: cfg.INGESTION_PROVIDER_TIMEOUT_MS,
          maxConcurrency: cfg.INGESTION_PROVIDER_MAX_CONCURRENCY,
          profile: cfg.PROVIDER_PROFILE,
        }, fetch, secrets);
    const embeddingModel = useLocalEmbeddings ? "local-embed" : cfg.INGESTION_PROVIDER_MODEL!;
    const retrieval = createRetrievalDeployment({
      publicationProfiles: Object.fromEntries(profile.corpora.map((corpusRef) => [corpusRef, { profile: indexProfile, ragProfileVersion: profile.profileVersion, ragProfileDigest }])),
      publicationStorePath: cfg.PUBLICATION_STORE_PATH,
      persistencePath: cfg.AUDIT_LEDGER_STORE_PATH,
      checkpointMaxAgeMs: cfg.NODE_ENV === "production" ? undefined : 24 * 60 * 60 * 1000,
      provider,
      embeddingModel,
    });
    retrieval.activatePolicy();
    retrieval.setAuditHealth({ quorumAvailable: true, witnessHealthy: true, checkpointAt: Date.now() });
    for (const corpusRef of profile.corpora) {
      const aclDigest = `sha256:${createHash("sha256").update(`corpus-acl:${corpusRef}`).digest("hex")}` as `sha256:${string}`;
      retrieval.governance.registerVersion({ documentVersionRef: corpusRef, classification: "internal", aclDigest });
      retrieval.governance.mutateSecurity(corpusRef, { processing: "indexed", integrity: "valid", publication: "active" }, {
        fenceId: `fence-${corpusRef}`,
        actorRef: "governance",
        approverRef: "platform",
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
      });
    }
    retrievalForIngestion = retrieval;
    ingestionDeployment = createIngestionDeployment({
      retrieval,
      provider,
      embeddingModel,
      ragProfile: profile,
      corpora: Object.fromEntries(profile.corpora.map((corpusRef) => [corpusRef, { indexProfile, ragProfileVersion: profile.profileVersion, ragProfileDigest }])),
      ingestionStorePathPrefix: cfg.INGESTION_STORE_PATH_PREFIX,
    });
    ingestionAuditLedger = retrieval.auditLedger;
    if (cfg.INGESTION_STORE_PATH_PREFIX) {
      corpusRehydrate = rehydrateCorpusIndexes({
        retrieval,
        corpora: profile.corpora,
        ingestionStorePathPrefix: cfg.INGESTION_STORE_PATH_PREFIX,
        provider,
        embeddingModel,
      }).then((rehydrated) => {
        if (rehydrated > 0) {
          // eslint-disable-next-line no-console
          console.log(`Rehydrated ${rehydrated} committed document version(s) into retrieval indexes`);
        }
      });
    }
  }
  const providerSecretCapabilities = new Map<string, ProviderSecretCapability>();

  const app = express();
  app.locals.corpusRehydrate = corpusRehydrate;
  app.disable("x-powered-by");

  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use((req, res, next) => {
    const limit = req.path.startsWith("/api/admin/ingestion") ? "512kb" : "32kb";
    return express.json({ limit, strict: true, type: "application/json" })(req, res, next);
  });
  app.use(cookieParser());
  app.use(corsMiddleware());

  app.use("/auth", createAuthRouter({ auth }));
  app.use("/api", csrfProtection({ getSessionCsrf: (cookieValue) => sessionManager.readSession(cookieValue)?.csrfToken }));
  app.use("/api", createApiRouter({ auth, ragHandler, conversationReferenceCodec, sessionAssertionIssuer, memoryAssertionIssuer, onboarding, ragProfile, ingestionDeployment, auditLedger: ingestionAuditLedger }));

  if (retrievalForIngestion && cfg.RETRIEVAL_HTTP_PORT && cfg.RETRIEVAL_WORKLOAD_TOKEN) {
    const retrievalHttp = createRetrievalHttp({
      service: retrievalForIngestion.service,
      workloadToken: cfg.RETRIEVAL_WORKLOAD_TOKEN,
      readiness: () => true,
    });
    app.locals.retrievalHttp = retrievalHttp;
    app.locals.retrievalHttpPort = cfg.RETRIEVAL_HTTP_PORT;
  }

  function constantTimeTokenMatch(expected: string | undefined, suppliedHeader: unknown): boolean {
    const supplied = typeof suppliedHeader === "string" ? suppliedHeader : "";
    if (!expected || !supplied) return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(supplied);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  function assertCatalogWorkloadRequest(req: Request): boolean {
    return constantTimeTokenMatch(cfg.CATALOG_WORKLOAD_TOKEN, req.headers["x-lens-workload-token"]);
  }

  function assertProviderSecretWorkloadRequest(req: Request): boolean {
    return constantTimeTokenMatch(cfg.PROVIDER_SECRET_WORKLOAD_TOKEN, req.headers["x-lens-workload-token"]);
  }

  function pruneExpiredProviderSecretCapabilities(now = Date.now()): void {
    for (const [capabilityRef, capability] of providerSecretCapabilities.entries()) {
      if (capability.expiresAt <= now) providerSecretCapabilities.delete(capabilityRef);
    }
  }

  function mintProviderSecretCapability(input: { secretRef: string; providerId: string; modelRef: string }): string {
    pruneExpiredProviderSecretCapabilities();
    const capabilityRef = `psc_${randomBytes(18).toString("base64url")}`;
    providerSecretCapabilities.set(capabilityRef, {
      secretRef: input.secretRef,
      providerId: input.providerId,
      modelRef: input.modelRef,
      expiresAt: Date.now() + PROVIDER_SECRET_CAPABILITY_TTL_MS,
    });
    return capabilityRef;
  }

  function consumeProviderSecretCapability(capabilityRef: string): ProviderSecretCapability | null {
    pruneExpiredProviderSecretCapabilities();
    const capability = providerSecretCapabilities.get(capabilityRef);
    if (!capability) return null;
    providerSecretCapabilities.delete(capabilityRef);
    return capability.expiresAt > Date.now() ? capability : null;
  }

  app.get("/internal/v1/approved-models", async (req, res) => {
    if (!assertCatalogWorkloadRequest(req)) {
      res.status(401).json({ error: "UNAUTHENTICATED" });
      return;
    }
    try {
      res.json({ models: await onboarding.approvedSnapshot() });
    } catch {
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
    }
  });

  // Internal, workload-authenticated server-to-server endpoints used by the runtime-adapter
  // sidecar. Neither is a browser route and neither ever returns a provider key in the config
  // response; the secret endpoint resolves the plaintext only on an authenticated call and the
  // sidecar uses it immediately before the adapter call.
  app.get("/internal/v1/provider-runtime-config", async (req, res) => {
    if (!assertCatalogWorkloadRequest(req)) {
      res.status(401).json({ error: "UNAUTHENTICATED" });
      return;
    }
    const modelRef = typeof req.query.model_ref === "string" ? req.query.model_ref : "";
    try {
      const runtimeConfig = await onboarding.resolveRuntimeConfig(modelRef);
      res.json({
        ...runtimeConfig,
        secretRef: mintProviderSecretCapability({
          secretRef: runtimeConfig.secretRef,
          providerId: runtimeConfig.providerId,
          modelRef,
        }),
      });
    } catch (error) {
      if (error instanceof ProviderOnboardError) {
        res.status(error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : 503).json({ error: error.code });
        return;
      }
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
    }
  });

  app.get("/internal/v1/provider-secret/:secretRef", async (req, res) => {
    if (!assertProviderSecretWorkloadRequest(req)) {
      res.status(401).json({ error: "UNAUTHENTICATED" });
      return;
    }
    const capabilityRef = req.params.secretRef;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(capabilityRef)) {
      res.status(400).json({ error: "INVALID_ARGUMENT" });
      return;
    }
    const capability = consumeProviderSecretCapability(capabilityRef);
    if (!capability) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    try {
      const apiKey = await secrets.get(capability.secretRef);
      res.json({ apiKey });
    } catch {
      res.status(404).json({ error: "NOT_FOUND" });
    }
  });

  app.use("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // /health above is a cheap liveness probe (always ok while the process is
  // up); /ready is dependency-aware and fails closed on an unreachable
  // Orchestrator instead of fabricating success.
  const orchestratorReady = cfg.RAG_PROVIDER_MODE === "internal" && cfg.ORCHESTRATOR_URL
    ? createOrchestratorReadinessCheck(cfg.ORCHESTRATOR_URL)
    : undefined;
  app.use("/ready", (_req, res) => {
    if (!orchestratorReady) {
      res.json({ ok: true });
      return;
    }
    orchestratorReady()
      .then((ok) => {
        res.status(ok ? 200 : 503).json({ ok });
      })
      .catch(() => {
        res.status(503).json({ ok: false });
      });
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

export async function startServer(): Promise<void> {
  const cfg = getConfig();
  const app = createApp();
  const corpusRehydrate = app.locals.corpusRehydrate as Promise<void> | undefined;
  if (corpusRehydrate) await corpusRehydrate;
  const retrievalHttp = app.locals.retrievalHttp as ReturnType<typeof createRetrievalHttp> | undefined;
  const retrievalHttpPort = app.locals.retrievalHttpPort as number | undefined;
  if (retrievalHttp && retrievalHttpPort) {
    await retrievalHttp.listen(retrievalHttpPort, "127.0.0.1");
    // eslint-disable-next-line no-console
    console.log(`Lens BFF retrieval (ingestion corpus) listening on :${retrievalHttpPort}`);
  }
  app.listen(cfg.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Lens BFF listening on :${cfg.PORT} admin_subjects=${Boolean(cfg.ADMIN_SUBJECTS?.trim())}`);
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
  void startServer();
}
