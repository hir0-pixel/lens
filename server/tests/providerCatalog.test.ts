import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { generateKeyPairSync } from "node:crypto";
import { __resetConfig } from "../src/config";
import { createApp } from "../src";
import { MemorySecretStore } from "../../services/secrets/SecretStore";
import { SqliteProviderRegistry } from "../../services/provider-registry/ProviderRegistry";
import { ProviderOnboardingService } from "../../services/provider-registry/onboard";
import { assertCompanyRagProfile, computeCompanyRagProfileDigest } from "../../services/rag-profile/companyRagProfile";
import { AuditLedger } from "../../services/audit/AuditLedger";
import type { IngestionService } from "../../services/ingestion";

const SECRET = "s".repeat(48);
const CLIENT_SECRET = "c".repeat(32);
const CATALOG_TOKEN = "c".repeat(40);
const PROVIDER_SECRET_TOKEN = "p".repeat(40);
const ORCH_ASSERTION_PRIVATE = generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const MEMORY_ASSERTION_PRIVATE = generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const ORIGINAL_ENV = { ...process.env };
let signingKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let publicJwk: Record<string, unknown>;
let activeNonce = "";

function baseEnv(overrides: Record<string, string> = {}) {
  return {
    NODE_ENV: "test",
    PORT: "3999",
    APP_ORIGIN: "http://localhost:1420",
    SESSION_SECRET: SECRET,
    OIDC_ISSUER: "https://identity.example.com/realms/lens",
    OIDC_CLIENT_ID: "lens-bff",
    OIDC_CLIENT_SECRET: CLIENT_SECRET,
    OIDC_REDIRECT_URI: "http://localhost:3999/auth/callback",
    ADMISSION_API_ORIGIN: "http://127.0.0.1:9444",
    ADMISSION_WORKLOAD_TOKEN: "a".repeat(40),
    RATE_LIMIT_KEY_SECRET: "k".repeat(40),
    BFF_ASSERTION_PRIVATE_KEY: ORCH_ASSERTION_PRIVATE,
    MEMORY_ASSERTION_PRIVATE_KEY: MEMORY_ASSERTION_PRIVATE,
    CONVERSATION_REFERENCE_SECRET: "v".repeat(48),
    PROVIDER_REGISTRY_PATH: "./providers.sqlite",
    PUBLICATION_STORE_PATH: "./publication.sqlite",
    INGESTION_STORE_PATH_PREFIX: "./ingestion",
    AUDIT_LEDGER_STORE_PATH: "./audit.sqlite",
    CATALOG_WORKLOAD_TOKEN: CATALOG_TOKEN,
    PROVIDER_SECRET_WORKLOAD_TOKEN: PROVIDER_SECRET_TOKEN,
    ...overrides,
  };
}

function mockFetcher() {
  return vi.fn(async (url: string) => {
    if (url.endsWith("/.well-known/openid-configuration")) {
      return new Response(JSON.stringify({
        issuer: "https://identity.example.com/realms/lens",
        authorization_endpoint: "https://identity.example.com/realms/lens/protocol/openid-connect/auth",
        token_endpoint: "https://identity.example.com/realms/lens/protocol/openid-connect/token",
        userinfo_endpoint: "https://identity.example.com/realms/lens/protocol/openid-connect/userinfo",
        jwks_uri: "https://identity.example.com/realms/lens/protocol/openid-connect/certs",
        introspection_endpoint: "https://identity.example.com/realms/lens/protocol/openid-connect/token/introspect",
        revocation_endpoint: "https://identity.example.com/realms/lens/protocol/openid-connect/revoke",
        end_session_endpoint: "https://identity.example.com/realms/lens/protocol/openid-connect/logout",
      }), { status: 200 });
    }
    if (url.endsWith("/token")) {
      const idToken = await new SignJWT({ nonce: activeNonce, name: "Test User", email: "u@example.com" })
        .setProtectedHeader({ alg: "RS256", kid: "lens-test-key" })
        .setIssuer("https://identity.example.com/realms/lens")
        .setAudience("lens-bff")
        .setSubject("user-1")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(signingKeys.privateKey);
      return new Response(JSON.stringify({ access_token: "acc", refresh_token: "ref", id_token: idToken, expires_in: 300 }), { status: 200 });
    }
    if (url.endsWith("/certs")) return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
    if (url.endsWith("/userinfo")) return new Response(JSON.stringify({ sub: "user-1", name: "Test User", email: "u@example.com" }), { status: 200 });
    if (url.endsWith("/introspect")) return new Response(JSON.stringify({ active: true, sub: "user-1" }), { status: 200 });
    if (url.endsWith("/revoke")) return new Response(JSON.stringify({}), { status: 200 });
    return new Response(JSON.stringify({ error: "unexpected" }), { status: 404 });
  });
}

describe("BFF provider catalog", () => {
  beforeAll(async () => {
    signingKeys = await generateKeyPair("RS256");
    publicJwk = { ...(await exportJWK(signingKeys.publicKey)), kid: "lens-test-key", alg: "RS256", use: "sig" };
  });
  beforeEach(() => {
    activeNonce = "";
    vi.stubGlobal("fetch", mockFetcher());
  });
  afterEach(() => {
    __resetConfig();
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function makeEnv(overrides: Record<string, string> = {}) {
    process.env = { ...process.env, ...baseEnv(overrides) };
    __resetConfig();
  }

  async function login(app: ReturnType<typeof createApp>) {
    const browser = request.agent(app);
    const loginRes = await browser.get("/auth/login");
    const location = loginRes.header.location;
    const state = new URL(location).searchParams.get("state") ?? "";
    activeNonce = new URL(location).searchParams.get("nonce") ?? "";
    const cb = await browser.get(`/auth/callback?state=${encodeURIComponent(state)}&code=codeABC`);
    const cookies = cb.header["set-cookie"] ?? [];
    const sessionCookie = cookies.find((cookie: string) => cookie.startsWith("lens_session="))?.split(";")[0] ?? "";
    const csrfCookie = cookies.find((cookie: string) => cookie.startsWith("lens_csrf="))?.split(";")[0] ?? "";
    const csrf = decodeURIComponent(csrfCookie.split("=").slice(1).join("="));
    return { sessionCookie, csrfCookie, csrf };
  }

  const payload = {
    adapterType: "openai-compatible",
    baseUrl: "http://127.0.0.1:8080",
    apiKey: "sk-live-provider-secret",
    tlsWorkloadRef: "workload:runtime",
    allowedModels: ["acme-chat"],
    capabilities: ["generate", "stream"],
    timeoutMs: 5000,
    maxConcurrency: 2,
    idempotencyKey: "onboard-1",
  };

  it("forbids an unauthorized employee from administering providers", async () => {
    makeEnv({ ADMIN_SUBJECTS: "admin-only" });
    const discoverFetch = (async () => new Response(JSON.stringify({ data: [{ id: "acme-chat" }] }), { status: 200 })) as typeof fetch;
    const onboarding = new ProviderOnboardingService(new SqliteProviderRegistry(":memory:"), new MemorySecretStore(), discoverFetch);
    const app = createApp({ generateHandler: async () => "x", onboarding, discoverFetch });
    const { sessionCookie, csrfCookie, csrf } = await login(app);
    const res = await request(app)
      .post("/api/admin/providers")
      .set("Cookie", [sessionCookie, csrfCookie])
      .set("x-lens-csrf", csrf)
      .send(payload);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("sk-live-provider-secret");
  });

  it("lets an admin onboard a provider, returns no key, and serves employee catalog", async () => {
    makeEnv({ ADMIN_SUBJECTS: "user-1" });
    const discoverFetch = (async () => new Response(JSON.stringify({ data: [{ id: "acme-chat" }, { id: "hidden" }] }), { status: 200 })) as typeof fetch;
    const secrets = new MemorySecretStore();
    const registry = new SqliteProviderRegistry(":memory:");
    const onboarding = new ProviderOnboardingService(registry, secrets, discoverFetch);
    const ragProfile = assertCompanyRagProfile({
      profileVersion: 1,
      companyId: "acme",
      corpora: ["policies"],
      connectors: [],
      chunking: { maxTokens: 400, overlapTokens: 40 },
      embeddingAdapterRef: "embed",
      groundingPolicyRef: "signed",
      tools: [],
      retentionDays: 30,
      eligibleModelPatterns: ["acme-*"],
      retrievalProfiles: { default: { corpusRef: "policies", mode: "hybrid" } },
    });
    const app = createApp({ generateHandler: async () => "x", onboarding, secrets, ragProfile });
    const { sessionCookie, csrfCookie, csrf } = await login(app);

    const created = await request(app)
      .post("/api/admin/providers")
      .set("Cookie", [sessionCookie, csrfCookie])
      .set("x-lens-csrf", csrf)
      .send(payload);
    expect(created.status).toBe(201);
    expect(created.body.id).toMatch(/^prv_/);
    expect(created.body.status).toBe("active");
    expect(JSON.stringify(created.body)).not.toContain("sk-live-provider-secret");
    expect(created.body.apiKey).toBeUndefined();
    expect(created.body.secretRef).toBeUndefined();
    expect(created.body.baseUrl).toBeUndefined();
    const stored = await registry.get(created.body.id);
    expect(stored?.secretRef).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain("sk-live-provider-secret");

    const catalog = await request(app).get("/api/models").set("Cookie", sessionCookie);
    expect(catalog.status).toBe(200);
    expect(catalog.body.models).toEqual([{ modelRef: "acme-chat", label: "acme-chat", available: true }]);
    expect(JSON.stringify(catalog.body)).not.toContain("127.0.0.1");
    expect(JSON.stringify(catalog.body)).not.toContain("sk-live");

    const ragHandler = vi.fn(async () => ({ output: "ok", citations: [] }));
    const app2 = createApp({ generateHandler: async () => "x", ragHandler, onboarding, ragProfile });
    const session2 = await login(app2);
    const rejected = await request(app2)
      .post("/api/rag/ask")
      .set("Cookie", [session2.sessionCookie, session2.csrfCookie])
      .set("x-lens-csrf", session2.csrf)
      .send({ query: "What is leave policy?", modelId: "stale-model" });
    expect(rejected.status).toBe(403);
  });

  it("separates catalog/config access from secret retrieval and issues only a bound secret handle", async () => {
    makeEnv();
    const discoverFetch = (async () => new Response(JSON.stringify({ data: [{ id: "acme-chat" }] }), { status: 200 })) as typeof fetch;
    const secrets = new MemorySecretStore();
    const registry = new SqliteProviderRegistry(":memory:");
    const onboarding = new ProviderOnboardingService(registry, secrets, discoverFetch);
    const app = createApp({ generateHandler: async () => "x", onboarding, secrets });

    const onboarded = await onboarding.onboard({
      adapterType: payload.adapterType,
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      tlsWorkloadRef: payload.tlsWorkloadRef,
      allowedModels: payload.allowedModels,
      capabilities: payload.capabilities,
      timeoutMs: payload.timeoutMs,
      maxConcurrency: payload.maxConcurrency,
      profile: "sovereign",
      idempotencyKey: payload.idempotencyKey,
    });
    const stored = await registry.get(onboarded.id);
    expect(stored?.secretRef).toBeTruthy();

    const runtimeConfig = await request(app)
      .get("/internal/v1/provider-runtime-config")
      .set("x-lens-workload-token", CATALOG_TOKEN)
      .query({ model_ref: "acme-chat" });
    expect(runtimeConfig.status).toBe(200);
    expect(runtimeConfig.body.secretRef).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
    expect(runtimeConfig.body.secretRef).not.toBe(stored?.secretRef);

    const wrongScope = await request(app)
      .get(`/internal/v1/provider-secret/${runtimeConfig.body.secretRef}`)
      .set("x-lens-workload-token", CATALOG_TOKEN);
    expect(wrongScope.status).toBe(401);

    const resolved = await request(app)
      .get(`/internal/v1/provider-secret/${runtimeConfig.body.secretRef}`)
      .set("x-lens-workload-token", PROVIDER_SECRET_TOKEN);
    expect(resolved.status).toBe(200);
    expect(resolved.body).toEqual({ apiKey: payload.apiKey });
  });

  it("rejects direct or arbitrary provider secret references even with the secret token", async () => {
    makeEnv();
    const discoverFetch = (async () => new Response(JSON.stringify({ data: [{ id: "acme-chat" }] }), { status: 200 })) as typeof fetch;
    const secrets = new MemorySecretStore();
    const registry = new SqliteProviderRegistry(":memory:");
    const onboarding = new ProviderOnboardingService(registry, secrets, discoverFetch);
    const app = createApp({ generateHandler: async () => "x", onboarding, secrets });

    const onboarded = await onboarding.onboard({
      adapterType: payload.adapterType,
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      tlsWorkloadRef: payload.tlsWorkloadRef,
      allowedModels: payload.allowedModels,
      capabilities: payload.capabilities,
      timeoutMs: payload.timeoutMs,
      maxConcurrency: payload.maxConcurrency,
      profile: "sovereign",
      idempotencyKey: payload.idempotencyKey,
    });
    const stored = await registry.get(onboarded.id);
    expect(stored?.secretRef).toBeTruthy();

    const direct = await request(app)
      .get(`/internal/v1/provider-secret/${stored?.secretRef}`)
      .set("x-lens-workload-token", PROVIDER_SECRET_TOKEN);
    expect(direct.status).toBe(404);

    const arbitrary = await request(app)
      .get("/internal/v1/provider-secret/p_deadbeefdeadbeef")
      .set("x-lens-workload-token", PROVIDER_SECRET_TOKEN);
    expect(arbitrary.status).toBe(404);
  });

  it("mounts ingestion only when configured and inherits admin and CSRF gates", async () => {
    const profile = assertCompanyRagProfile({
      profileVersion: 1,
      companyId: "acme",
      corpora: ["docs"],
      connectors: [],
      chunking: { maxTokens: 400, overlapTokens: 40 },
      embeddingAdapterRef: "embed",
      groundingPolicyRef: "signed",
      tools: [],
      retentionDays: 30,
      eligibleModelPatterns: [],
      retrievalProfiles: { default: { corpusRef: "docs", mode: "hybrid" } },
    });
    const ragProfileDigest = computeCompanyRagProfileDigest(profile);
    const body = {
      sourceId: "source",
      documentRef: "document",
      version: "v1",
      versionRef: "document@v1",
      contentDigest: `sha256:${"a".repeat(64)}`,
      aclDigest: `sha256:${"b".repeat(64)}`,
      classificationRef: "internal",
      parse: { status: "accepted", renditionDigest: `sha256:${"c".repeat(64)}`, chunks: [{ chunkRef: "chunk", contentDigest: `sha256:${"d".repeat(64)}`, text: "text", citationAnchor: "p1" }] },
      ragProfileVersion: 1,
      ragProfileDigest,
    };
    const service = { enqueueIngest: async () => ({ jobId: "job", state: "QUEUED", stage: "DISCOVERED" }) } as unknown as IngestionService;
    const ingestionDeployment = { services: new Map([["docs", service]]), ragProfile: profile };
    const auditLedger = new AuditLedger({ ingestion: ["ingestion.job.submitted", "ingestion.job.withdrawn"] });

    makeEnv({ ADMIN_SUBJECTS: "user-1", INGESTION_ENABLED: "false" });
    const absent = createApp({ generateHandler: async () => "x" });
    const absentSession = await login(absent);
    expect((await request(absent).post("/api/admin/ingestion/corpora/docs/jobs").set("Cookie", [absentSession.sessionCookie, absentSession.csrfCookie]).set("x-lens-csrf", absentSession.csrf).send(body)).status).toBe(404);

    const app = createApp({ generateHandler: async () => "x", ingestionDeployment, auditLedger });
    expect((await request(app).post("/api/admin/ingestion/corpora/docs/jobs").send(body)).status).toBe(403);
    const session = await login(app);
    expect((await request(app).post("/api/admin/ingestion/corpora/docs/jobs").set("Cookie", [session.sessionCookie, session.csrfCookie]).send(body)).status).toBe(403);
    expect((await request(app).post("/api/admin/ingestion/corpora/docs/jobs").set("Cookie", [session.sessionCookie, session.csrfCookie]).set("x-lens-csrf", session.csrf).send(body)).status).toBe(202);

    makeEnv({ ADMIN_SUBJECTS: "admin-only", INGESTION_ENABLED: "false" });
    const nonAdminApp = createApp({ generateHandler: async () => "x", ingestionDeployment, auditLedger });
    const nonAdminSession = await login(nonAdminApp);
    expect((await request(nonAdminApp).post("/api/admin/ingestion/corpora/docs/jobs").set("Cookie", [nonAdminSession.sessionCookie, nonAdminSession.csrfCookie]).set("x-lens-csrf", nonAdminSession.csrf).send(body)).status).toBe(403);
  });

  it("fails closed in production when the provider secret workload token is missing or reused", () => {
    makeEnv({
      NODE_ENV: "production",
      APP_ORIGIN: "https://lens.example.com",
      OIDC_REDIRECT_URI: "https://lens.example.com/auth/callback",
      PROVIDER_SECRET_WORKLOAD_TOKEN: "",
    });
    expect(() => createApp({ generateHandler: async () => "x" })).toThrow(/PROVIDER_SECRET_WORKLOAD_TOKEN/);

    makeEnv({
      NODE_ENV: "production",
      APP_ORIGIN: "https://lens.example.com",
      OIDC_REDIRECT_URI: "https://lens.example.com/auth/callback",
      PROVIDER_SECRET_WORKLOAD_TOKEN: CATALOG_TOKEN,
    });
    expect(() => createApp({ generateHandler: async () => "x" })).toThrow(/distinct/);
  });
});
