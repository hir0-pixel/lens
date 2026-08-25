import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { createRetrievalDeployment } from "../../services/retrieval/ProductionRetrievalWiring";
import { createIngestionDeployment } from "../../services/ingestion/ProductionIngestionWiring";
import type { ModelProviderAdapter } from "../../services/model-provider/ProviderAdapter";
import { computeCompanyRagProfileDigest, type CompanyRagProfile } from "../../services/rag-profile/companyRagProfile";
import { main as retrievalMain } from "../../retrieval-service/src/main";
import { AuthorityHttpClient } from "../../orchestrator-service/src/authorityClient";
import type { TurnRouterLLMPort } from "../../orchestrator-service/src/router";
import { RetrievalHttpClient } from "../../orchestrator-service/src/retrievalClient";
import { createOrchestratorHttp } from "../../orchestrator-service/src/http";
import { InternalInferenceClient } from "../../orchestrator-service/src/internalInferenceClient";
import { RuntimeAttemptHttpClient } from "../../services/runtime-attempt/RuntimeAttemptHttpClient";
import { ProductionOrchestratorService, SingleDigestModelEligibility, SingleDigestModelSelection } from "../../orchestrator-service/src/service";
import { loadConversationHistory, loadRoutePolicy, type OrchestratorServiceEnv } from "../../orchestrator-service/src/main";
import { AuthorityReceiptIssuer } from "../../services/security/authorityReceipt";
import { CompositeReceiptVerifier } from "../../services/security/compositeReceiptVerifier";
import { InMemoryClaimStore } from "../../services/security/replayClaimStore";
import { SubjectDeviceModelUseAuthority } from "../../services/pdp/ModelUseAuthority";
import { SqliteCostAuthority } from "../../services/cost-authority/SqliteCostAuthority";
import { SqliteAgentRunAuthority } from "../../services/agent-run-authority/SqliteAgentRunAuthority";
import { DelegatedSessionAssertionVerifier } from "../../services/security/delegatedSessionAssertion";
import { signRoutePolicyManifest, type RoutePolicyManifest } from "../../orchestrator-service/src/groundingPolicy";
import { bootAuthorityServiceLocal, bootRuntimeSidecarLocal, type LocalServiceHandle } from "../helpers/localServiceBoot";
import { createApp } from "../../server/src";
import { __resetConfig } from "../../server/src/config";
import { createSessionManager } from "../../server/src/auth/sessionManager";
import type { AuthService } from "../../server/src/auth/authService";

const token = () => randomBytes(32).toString("hex");
const digest = (value: string): `sha256:${string}` => `sha256:${createHash("sha256").update(value).digest("hex")}`;

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!port) throw new Error("Unable to reserve test port");
  return port;
}

const profile: CompanyRagProfile = {
  profileVersion: 1,
  companyId: "lens-e2e",
  corpora: ["enterprise-docs"],
  connectors: [],
  chunking: { maxTokens: 400, overlapTokens: 40 },
  embeddingAdapterRef: "local-test-embedding",
  groundingPolicyRef: "signed-test-policy",
  tools: [],
  retentionDays: 30,
  eligibleModelPatterns: ["*"] ,
  retrievalProfiles: { default: { corpusRef: "enterprise-docs", mode: "hybrid" } },
};

const indexProfile = {
  embeddingModelDigest: computeCompanyRagProfileDigest(profile),
  tokenizerDigest: `sha256:${"b".repeat(64)}` as `sha256:${string}`,
  vectorDimensions: 768,
  distanceMetric: "cosine" as const,
  chunkingProfile: "markdown-headings",
  schemaVersion: "rag-v1",
};

let vectorBackendEnabled = true;
const localProvider: ModelProviderAdapter = {
  adapterType: "gemini-dev",
  async discoverModels() { return [{ id: "local", capabilities: ["embed", "generate"] }]; },
  async getModelCapabilities() { return ["embed", "generate"]; },
  async *generateStream(input) { yield input.chunks.join("\n"); },
  async embed(input) {
    if (!vectorBackendEnabled) throw new Error("Vector backend disabled for test.");
    const synonyms: Record<string, string> = { approved: "signoff", approve: "signoff", directors: "leaders", director: "leaders", spending: "budget", plans: "budget", money: "funds", goes: "disbursement", three: "quarterly", months: "quarterly", group: "team", sign: "signoff", off: "signoff" };
    const tokens = input.text.toLowerCase().split(/\\W+/).filter(Boolean).map((token) => synonyms[token] ?? token);
    const vector = new Array<number>(768).fill(0);
    for (const token of new Set(tokens)) {
      const hash = createHash("sha256").update(token).digest();
      for (let offset = 0; offset < 4; offset += 1) vector[(hash.readUInt32BE(offset * 4) % 768)] += 1;
    }
    return vector;
  },
  async health() { return true; },
  normalizeError() { return { code: "DEPENDENCY_UNAVAILABLE", retryable: false }; },
  meterUsage(text) { return text.length; },
};

const routerStub: TurnRouterLLMPort = {
  async classify(input) {
    return {
      route: "SINGLE_RETRIEVAL",
      standalone_query: input.text,
      profile_selector: "default",
      reason_code: "knowledge_lookup",
      confidence_bucket: "HIGH",
    };
  },
};

type HttpResult = { status: number; body: any };

export type RagChatHarness = {
  ingest(input: { sourceId: string; documentRef: string; versionRef: string; text: string }): Promise<void>;
  withdraw(versionRef: string): Promise<void>;
  ask(query: string): Promise<{ output: string; citations: readonly { source: string; section: string }[] }>;
  askRaw(query: string): Promise<HttpResult>;
  askWithProfile(query: string, profileOverride: { profileVersion?: number; profileDigest?: string }): Promise<HttpResult>;
  askWithMode(query: string, mode: "lexical" | "semantic" | "hybrid"): Promise<HttpResult>;
  disableVectorBackend(): void;
  enableVectorBackend(): void;
  setPublished(versionRef: string, active: boolean): Promise<void>;
  setSubject(subjectRef: string): void;
  retrievalRequestCount(): number;
  stopRetrieval(): Promise<void>;
  close(): Promise<void>;
};

export async function createRagChatHarness(): Promise<RagChatHarness> {
  const authority: LocalServiceHandle = await bootAuthorityServiceLocal();
  const schedulerKeys = generateKeyPairSync("ed25519");
  const schedulerPrivate = schedulerKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const runtime: LocalServiceHandle = await bootRuntimeSidecarLocal({ SCHEDULER_SIGNING_KEY: schedulerPrivate, USAGE_SIGNING_KEY: schedulerPrivate });
  const retrievalToken = token();
  let subjectRef = "employee-1";
  const ragDigest = computeCompanyRagProfileDigest(profile);
  const retrievalDeployment = createRetrievalDeployment({
    provider: localProvider,
    embeddingModel: "local",
    ragProfileVersion: profile.profileVersion,
    ragProfileDigest: ragDigest,
    publicationProfile: indexProfile,
    subject: (subject) => ({ revision: 1, active: subject !== "unauthorized", groups: [] }),
  });
  retrievalDeployment.activatePolicy();
  retrievalDeployment.governance.registerVersion({ documentVersionRef: "enterprise-docs", classification: "internal", aclDigest: digest("corpus-acl") });
  retrievalDeployment.governance.mutateSecurity("enterprise-docs", { processing: "indexed", integrity: "valid", publication: "active" }, { fenceId: "fence-enterprise-docs", actorRef: "governance", approverRef: "platform", expiresAt: Date.now() + 60_000 });
  const retrievalPort = await freePort();
  const retrieval = await retrievalMain({
    PORT: String(retrievalPort), HOST: "127.0.0.1", NODE_ENV: "test", WORKLOAD_TOKEN: retrievalToken,
    PDP_URL: "", PDP_WORKLOAD_TOKEN: "", INDEX_URL: "", INDEX_WORKLOAD_TOKEN: "", CONTENT_URL: "", CONTENT_WORKLOAD_TOKEN: "", AUDIT_URL: "", AUDIT_WORKLOAD_TOKEN: "", PUBLICATION_URL: "", PUBLICATION_WORKLOAD_TOKEN: "",
    ALLOW_LOOPBACK_HTTP: "true", LENS_RETRIEVAL_LOCAL_COMPOSE: "true",
  }, { deployment: retrievalDeployment });
  const ingestion = createIngestionDeployment({
    retrieval: retrievalDeployment, provider: localProvider, embeddingModel: "local",
    ragProfile: profile,
    corpora: { "enterprise-docs": { indexProfile, ragProfileVersion: profile.profileVersion, ragProfileDigest: ragDigest } },
  }).services.get("enterprise-docs")!;

  const assertionKey = generateKeyPairSync("ed25519");
  const memoryKey = generateKeyPairSync("ed25519");
  const assertionPrivate = assertionKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const memoryPrivate = memoryKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicPem = (key: typeof assertionKey.publicKey) => key.export({ type: "spki", format: "pem" }).toString();
  const routeOps = randomBytes(32).toString("hex");
  const routePolicy: RoutePolicyManifest = {
    manifestRevision: 1,
    entries: [{ applicationRef: "lens-employee-client", workspaceRef: "default-workspace", purposeRef: "assistant", requestClass: "enterprise-grounded", routePolicyRevision: 1, groundingRequired: false, routerModelRef: "default", allowedProfileSelectors: ["default"], defaultProfileSelector: "default", noDefaultSelectorBehavior: "CLARIFY", clarificationText: "Please clarify.", expiresAt: Date.now() + 86_400_000 }],
  };
  const orchestratorToken = token();
  const orchestratorPort = await freePort();
  const orchestratorEnv: OrchestratorServiceEnv = {
    PORT: String(orchestratorPort), HOST: "127.0.0.1", ORCHESTRATOR_WORKLOAD_TOKEN: orchestratorToken,
    RETRIEVAL_URL: `http://127.0.0.1:${retrievalPort}/`, RETRIEVAL_WORKLOAD_TOKEN: retrievalToken,
    MODEL_RUNTIME_URL: runtime.url, MODEL_RUNTIME_WORKLOAD_TOKEN: runtime.workloadToken, MODEL_ARTIFACT_DIGEST: `sha256:${"a".repeat(64)}`,
    AUTHORITY_URL: authority.url, AUTHORITY_WORKLOAD_TOKEN: authority.workloadToken,
    ASSERTION_VERIFY_KEY: publicPem(assertionKey.publicKey), MEMORY_ASSERTION_VERIFY_KEY: publicPem(memoryKey.publicKey),
    ORCHESTRATOR_AUTHORITY_PROFILE: "test", ALLOW_IN_MEMORY_AUTHORITIES: "true", CONVERSATION_HISTORY_PROFILE: "test", ALLOW_IN_MEMORY_HISTORY: "true",
    ROUTE_POLICY_MANIFEST_JSON: JSON.stringify(routePolicy), ROUTE_POLICY_MANIFEST_SIGNATURE: signRoutePolicyManifest(routeOps, routePolicy), ROUTE_POLICY_OPS_KEY: routeOps,
    COMPANY_RAG_PROFILE_JSON: JSON.stringify(profile),
  };
  let retrievalRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/retrieve")) retrievalRequests += 1;
    return originalFetch(input, init);
  }) as typeof fetch;
  const modelDigest = orchestratorEnv.MODEL_ARTIFACT_DIGEST as `sha256:${string}`;
  const modelSelection = new SingleDigestModelSelection(modelDigest);
  const modelEligibility = new SingleDigestModelEligibility(modelDigest, () => Date.now());
  const devAuthorityKeys = generateKeyPairSync("ed25519");
  const devIssuer = new AuthorityReceiptIssuer(devAuthorityKeys.privateKey);
  const modelUseAuthority = new SubjectDeviceModelUseAuthority(
    { subject: () => ({ revision: 1, active: true, groups: [] }), device: () => ({ revision: 1, compliant: true }) },
    { resolveEndpoint: (input) => modelEligibility.resolveEndpoint(input), currentDenyEpoch: () => modelEligibility.currentDenyEpoch() },
    devIssuer,
  );
  const costAuthority = new SqliteCostAuthority(":memory:", devIssuer);
  const agentRunAuthority = new SqliteAgentRunAuthority(":memory:", devIssuer);
  const receiptVerifier = new CompositeReceiptVerifier([devAuthorityKeys.publicKey, schedulerKeys.publicKey]);
  const claimStore = new InMemoryClaimStore();
  const { history } = loadConversationHistory(orchestratorEnv);
  const routePolicyPort = loadRoutePolicy(orchestratorEnv);
  const inference = new InternalInferenceClient(runtime.url, runtime.workloadToken);
  const attempts = new RuntimeAttemptHttpClient(runtime.url, runtime.workloadToken);
  const authorityClient = new AuthorityHttpClient(authority.url, authority.workloadToken);
  const service = new ProductionOrchestratorService({
    retrieval: new RetrievalHttpClient(`http://127.0.0.1:${retrievalPort}/`, retrievalToken),
    scheduler: inference,
    runtime: inference,
    runtimeAttempts: attempts,
    generationContextFence: authorityClient,
    auditAdmission: authorityClient,
    outputGuards: authorityClient,
    outputStore: authorityClient,
    turnState: authorityClient,
    disclosure: authorityClient,
    resultAuthorization: authorityClient,
    modelUseAuthority,
    costAuthority,
    agentRunAuthority,
    receiptVerifier,
    claimStore,
    routePolicy: routePolicyPort,
    turnRouter: routerStub,
    modelArtifactDigest: modelDigest,
    modelSelection,
    modelEligibility,
    ragProfile: profile,
    conversationHistory: history,
  });
  const orchestratorHttp = createOrchestratorHttp({
    workloadToken: orchestratorToken,
    handleChat: (request, signal) => service.handleChat(request, signal),
    sessionAssertionVerifier: new DelegatedSessionAssertionVerifier(orchestratorEnv.ASSERTION_VERIFY_KEY!),
    memoryAssertionVerifier: new DelegatedSessionAssertionVerifier(orchestratorEnv.MEMORY_ASSERTION_VERIFY_KEY!),
  });
  await orchestratorHttp.listen(orchestratorPort, "127.0.0.1");
  const orchestrator = { close: () => orchestratorHttp.close() };
  globalThis.fetch = originalFetch;

  __resetConfig();
  process.env = { ...process.env, NODE_ENV: "test", SESSION_SECRET: token(), RAG_PROVIDER_MODE: "internal", ORCHESTRATOR_URL: `http://127.0.0.1:${orchestratorPort}/`, ORCHESTRATOR_TOKEN: orchestratorToken, BFF_ASSERTION_PRIVATE_KEY: assertionPrivate, MEMORY_ASSERTION_PRIVATE_KEY: memoryPrivate, CONVERSATION_REFERENCE_SECRET: token(), RATE_LIMIT_KEY_SECRET: token(), ADMISSION_API_ORIGIN: "http://127.0.0.1:1", ADMISSION_WORKLOAD_TOKEN: token() };
  __resetConfig();
  const sessions = createSessionManager();
  const sessionCookie = sessions.createSession({ version: 1, sid: "e2e", subjectRef: "employee-1", csrfToken: "csrf-e2e", accessToken: "access", refreshToken: "refresh", idToken: "id", tokenExpiresAt: Date.now() + 60_000, expiresAt: Date.now() + 60_000, profile: { name: "Employee" } });
  const auth = { getTrustedSession: async () => ({ authenticated: true, subject: subjectRef, sessionRef: "session:e2e", deviceRef: "device:e2e" }), getRateLimitPrincipal: () => "session:e2e" } as unknown as AuthService;
  const app = createApp({ authService: auth, ragProfile: profile });
  const bffPort = await freePort();
  const bffServer: Server = createServer(app);
  await new Promise<void>((resolve, reject) => { bffServer.once("error", reject); bffServer.listen(bffPort, "127.0.0.1", resolve); });

  const closeables: Array<() => Promise<void>> = [async () => new Promise<void>((resolve, reject) => bffServer.close((error) => error ? reject(error) : resolve())), async () => await orchestrator.close(), async () => await retrieval.close(), runtime.close, authority.close];
  const askRaw = async (query: string): Promise<HttpResult> => {
    const response = await fetch(`http://127.0.0.1:${bffPort}/api/rag/ask`, { method: "POST", headers: { "content-type": "application/json", cookie: `lens_session=${sessionCookie}`, "x-lens-csrf": "csrf-e2e" }, body: JSON.stringify({ query }) });
    const body = await response.json();
    return { status: response.status, body };
  };
  return {
    async ingest(input) {
      await ingestion.ingest({ sourceId: input.sourceId, documentRef: input.documentRef, version: input.versionRef, versionRef: input.versionRef, contentDigest: digest(input.text), parse: { status: "accepted", renditionDigest: digest(input.text), chunks: [{ chunkRef: `${input.versionRef}-chunk`, contentDigest: digest(input.text), text: input.text, citationAnchor: input.sourceId }] }, classificationRef: "internal", aclDigest: digest("acl") });
    },
    withdraw: (versionRef) => ingestion.withdraw(versionRef),
    async ask(query) {
      const response = await askRaw(query);
      if (response.status !== 200) throw new Error(JSON.stringify(response.body));
      return response.body;
    },
    askRaw,
    async askWithProfile(query, profileOverride) {
      const originalVersion = profile.profileVersion;
      if (profileOverride.profileVersion !== undefined) profile.profileVersion = profileOverride.profileVersion;
      try { return await askRaw(query); } finally { profile.profileVersion = originalVersion; }
    },
    async askWithMode(query, mode) {
      const originalMode = profile.retrievalProfiles.default.mode;
      profile.retrievalProfiles.default.mode = mode;
      try { return await askRaw(query); } finally { profile.retrievalProfiles.default.mode = originalMode; }
    },
    disableVectorBackend() { vectorBackendEnabled = false; },
    enableVectorBackend() { vectorBackendEnabled = true; },
    async setPublished(versionRef, active) { retrievalDeployment.governance.mutateSecurity(versionRef, { publication: active ? "active" : "withdrawn" }, { fenceId: `fence-${versionRef}`, actorRef: "governance", approverRef: "platform", expiresAt: Date.now() + 60_000 }); },
    setSubject(subject) { subjectRef = subject; },
    retrievalRequestCount: () => retrievalRequests,
    async stopRetrieval() { await retrieval.close(); },
    async close() { globalThis.fetch = originalFetch; while (closeables.length) await closeables.shift()!(); },
  };
}
