import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  __resetConfig,
  getConfig,
  validateProductionConfig,
} from "../src/config";
import { createAuthService } from "../src/auth/authService";
import { createSessionManager } from "../src/auth/sessionManager";
import { createApp } from "../src";
import { generateKeyPairSync } from "node:crypto";

const SECRET = "s".repeat(48);
const CLIENT_SECRET = "c".repeat(32);
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
    ...overrides,
  };
}

function mockFetcher() {
  return vi.fn(async (url: string) => {
    if (url.endsWith("/.well-known/openid-configuration")) {
      return new Response(
        JSON.stringify({
          issuer: "https://identity.example.com/realms/lens",
          authorization_endpoint: "https://identity.example.com/realms/lens/protocol/openid-connect/auth",
          token_endpoint: "https://identity.example.com/realms/lens/protocol/openid-connect/token",
          userinfo_endpoint: "https://identity.example.com/realms/lens/protocol/openid-connect/userinfo",
          jwks_uri: "https://identity.example.com/realms/lens/protocol/openid-connect/certs",
          introspection_endpoint: "https://identity.example.com/realms/lens/protocol/openid-connect/token/introspect",
          revocation_endpoint: "https://identity.example.com/realms/lens/protocol/openid-connect/revoke",
          end_session_endpoint: "https://identity.example.com/realms/lens/protocol/openid-connect/logout",
        }),
        { status: 200 },
      );
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
    if (url.endsWith("/certs")) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
    }
    if (url.endsWith("/userinfo")) {
      return new Response(JSON.stringify({ sub: "user-1", name: "Test User", email: "u@example.com" }), { status: 200 });
    }
    if (url.endsWith("/introspect")) {
      return new Response(JSON.stringify({ active: true, sub: "user-1" }), { status: 200 });
    }
    if (url.endsWith("/revoke")) {
      return new Response(JSON.stringify({}), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "unexpected" }), { status: 404 });
  });
}

describe("Lens BFF authentication", () => {
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

  async function completeLogin(app: ReturnType<typeof createApp>) {
    const browser = request.agent(app);
    const login = await browser.get("/auth/login");
    const location = login.header.location;
    const state = new URL(location).searchParams.get("state") ?? "";
    activeNonce = new URL(location).searchParams.get("nonce") ?? "";
    const cb = await browser.get(`/auth/callback?state=${encodeURIComponent(state)}&code=codeABC`);
    return cb;
  }

  it("GET /auth/login redirects to the Identity Gateway authorization endpoint", async () => {
    makeEnv();
    const app = createApp({ generateHandler: async () => "x" });
    const res = await request(app).get("/auth/login");
    expect(res.status).toBe(302);
    const location = res.header.location;
    expect(location).toContain("protocol/openid-connect/auth");
    expect(location).toContain("response_type=code");
    expect(location).toContain("code_challenge_method=S256");
    expect(location).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A3999%2Fauth%2Fcallback");
    expect(location).toContain("code_challenge=");
    expect(location).toContain("nonce=");
    expect(location).toContain("state=");
  });

  it("GET /auth/callback fails closed on invalid OIDC state", async () => {
    makeEnv();
    const app = createApp({ generateHandler: async () => "x" });
    const res = await request(app).get("/auth/callback?state=forged&code=abc");
    expect(res.status).toBe(302);
    expect(res.header.location).toContain("auth=error");
    expect(res.header["set-cookie"]).toBeUndefined();
  });

  it("GET /auth/callback fails closed when there is no matching pending flow", async () => {
    makeEnv();
    const app = createApp({ generateHandler: async () => "x" });
    const res = await request(app).get("/auth/callback?state=random&code=abc");
    expect(res.status).toBe(302);
    expect(res.header.location).toContain("auth=error");
  });

  it("accepts a browser-bound stateless callback on a different BFF replica", async () => {
    makeEnv();
    const replicaA = createApp({ generateHandler: async () => "x" });
    const replicaB = createApp({ generateHandler: async () => "x" });
    const login = await request(replicaA).get("/auth/login");
    const authorization = new URL(login.header.location);
    const state = authorization.searchParams.get("state") ?? "";
    activeNonce = authorization.searchParams.get("nonce") ?? "";
    const bindingCookie = (login.header["set-cookie"] ?? [])
      .find((cookie: string) => cookie.startsWith("lens_oidc_binding="))
      ?.split(";", 1)[0] ?? "";

    const callback = await request(replicaB)
      .get(`/auth/callback?state=${encodeURIComponent(state)}&code=codeABC`)
      .set("Cookie", bindingCookie);

    expect(callback.status).toBe(302);
    expect(callback.header.location).toBe("http://localhost:1420/");
    expect(callback.header["set-cookie"]?.some((cookie: string) => cookie.startsWith("lens_session="))).toBe(true);
  });

  it("rejects a stateless callback with the wrong browser binding or nonce", async () => {
    makeEnv();
    const app = createApp({ generateHandler: async () => "x" });
    const browser = request.agent(app);
    const login = await browser.get("/auth/login");
    const authorization = new URL(login.header.location);
    const state = authorization.searchParams.get("state") ?? "";
    activeNonce = "wrong-nonce";

    const wrongNonce = await browser.get(`/auth/callback?state=${encodeURIComponent(state)}&code=codeABC`);
    expect(wrongNonce.header.location).toContain("auth=error");

    const wrongBinding = await request(app)
      .get(`/auth/callback?state=${encodeURIComponent(state)}&code=codeABC`)
      .set("Cookie", `lens_oidc_binding=${"z".repeat(43)}`);
    expect(wrongBinding.header.location).toContain("auth=error");
  });

  it("sets Secure+HttpOnly SameSite session cookie on success and exposes safe session data", async () => {
    makeEnv();
    const app = createApp({ generateHandler: async () => "x" });
    const cb = await completeLogin(app);
    expect(cb.status).toBe(302);
    const cookies = cb.header["set-cookie"] ?? [];
    const sessionCookie = cookies.find((c: string) => c.startsWith("lens_session=")) ?? "";
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie.toLowerCase()).toContain("samesite=lax");
    expect(sessionCookie.toLowerCase()).not.toContain("access_token");

    const sessionRes = await request(app)
      .get("/api/session")
      .set("Cookie", sessionCookie.split(";")[0]);
    expect(sessionRes.status).toBe(200);
    const body = sessionRes.body;
    expect(body.authenticated).toBe(true);
    expect(body.subject).toBe("user-1");
    expect(body.name).toBe("Test User");
    expect(body.accessToken).toBeUndefined();
  });

  it("expired sessions are rejected by /api/session", async () => {
    makeEnv();
    const sessionManager = createSessionManager();
    const auth = createAuthService({ sessionManager });
    const app = createApp({ authService: auth, generateHandler: async () => "x" });
    const sealed = sessionManager.createSession({
      version: 1,
      sid: "sess-expired",
      subjectRef: "user-1",
      csrfToken: "csrf",
      accessToken: "acc",
      refreshToken: "ref",
      idToken: "",
      tokenExpiresAt: Date.now() + 60000,
      expiresAt: Date.now() - 1000,
      profile: {},
    });
    const res = await request(app)
      .get("/api/session")
      .set("Cookie", `lens_session=${sealed}`);
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });

  it("rejects state-changing /api/rag/ask without a valid CSRF token", async () => {
    makeEnv();
    const app = createApp({ generateHandler: async () => "x" });
    const res = await request(app)
      .post("/api/rag/ask")
      .set("Content-Type", "application/json")
      .send({ query: "hello" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("CSRF_REJECTED");
  });

  it("fails closed on the obsolete /api/generate path", async () => {
    makeEnv();
    const app = createApp({ generateHandler: async () => "x" });
    const res = await request(app)
      .post("/api/generate")
      .set("Content-Type", "application/json")
      .send({ prompt: "hello" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("CSRF_REJECTED");
  });

  it("routes a synthetic RAG request through the authenticated BFF without exposing provider details", async () => {
    makeEnv();
    const ragHandler = vi.fn(async () => ({
      output: "The remote-work stipend is $1,500. [Source 1]",
      citations: [{ source: "remote_work_policy.docx", section: "Section 2: Equipment and Expenses" }],
    }));
    const app = createApp({ generateHandler: async () => "x", ragHandler });
    const callback = await completeLogin(app);
    const cookies = callback.header["set-cookie"] ?? [];
    const sessionCookie = cookies.find((cookie: string) => cookie.startsWith("lens_session="))?.split(";")[0] ?? "";
    const csrfCookie = cookies.find((cookie: string) => cookie.startsWith("lens_csrf="))?.split(";")[0] ?? "";
    const csrf = decodeURIComponent(csrfCookie.split("=").slice(1).join("="));

    const creationKey = Buffer.alloc(32, 9).toString("base64url");
    const response = await request(app)
      .post("/api/rag/ask")
      .set("Cookie", [sessionCookie, csrfCookie])
      .set("x-lens-csrf", csrf)
      .send({ query: "What is the remote-work stipend?", conversationCreationKey: creationKey });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      output: "The remote-work stipend is $1,500. [Source 1]",
      citations: [{ source: "remote_work_policy.docx", section: "Section 2: Equipment and Expenses" }],
      conversationRef: expect.any(String),
    });
    expect(ragHandler).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "user-1", query: "What is the remote-work stipend?" }),
      expect.any(AbortSignal),
    );
    expect(ragHandler.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ conversationRef: expect.any(String), sessionAssertion: expect.any(String), memorySessionAssertion: expect.any(String) }));

    const firstConversationRef = response.body.conversationRef as string;
    const continuation = await request(app)
      .post("/api/rag/ask")
      .set("Cookie", [sessionCookie, csrfCookie])
      .set("x-lens-csrf", csrf)
      .send({ query: "What about equipment?", conversationRef: firstConversationRef });
    expect(continuation.status).toBe(200);
    expect(continuation.body.conversationRef).toBe(firstConversationRef);

    const separateChat = await request(app)
      .post("/api/rag/ask")
      .set("Cookie", [sessionCookie, csrfCookie])
      .set("x-lens-csrf", csrf)
      .send({ query: "Start another chat" });
    expect(separateChat.status).toBe(200);
    expect(separateChat.body.conversationRef).not.toBe(firstConversationRef);

    const retried = await request(app)
      .post("/api/rag/ask")
      .set("Cookie", [sessionCookie, csrfCookie])
      .set("x-lens-csrf", csrf)
      .send({ query: "Retry first send", conversationCreationKey: creationKey });
    expect(retried.status).toBe(200);
    expect(retried.body.conversationRef).toBe(firstConversationRef);

    const concurrent = await Promise.all([
      request(app).post("/api/rag/ask").set("Cookie", [sessionCookie, csrfCookie]).set("x-lens-csrf", csrf).send({ query: "Concurrent A", conversationCreationKey: creationKey }),
      request(app).post("/api/rag/ask").set("Cookie", [sessionCookie, csrfCookie]).set("x-lens-csrf", csrf).send({ query: "Concurrent B", conversationCreationKey: creationKey }),
    ]);
    expect(concurrent.map((result) => result.body.conversationRef)).toEqual([firstConversationRef, firstConversationRef]);
  });

  it("POST /auth/logout clears the application session and no longer authenticates", async () => {
    makeEnv();
    const app = createApp({ generateHandler: async () => "x" });
    const cb = await completeLogin(app);
    const cookies = cb.header["set-cookie"] ?? [];
    const sessionCookie = cookies.find((c: string) => c.startsWith("lens_session=")) ?? "";
    const cookieName = sessionCookie.split(";")[0];

    const logoutRes = await request(app).post("/auth/logout").set("Cookie", cookieName);
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.ok).toBe(true);
    expect(logoutRes.body.logoutUrl).toContain("/protocol/openid-connect/logout");
    expect(logoutRes.body.logoutUrl).toContain("id_token_hint=");
    expect(logoutRes.body.logoutUrl).toContain("post_logout_redirect_uri=");

    const afterRes = await request(app).get("/api/session").set("Cookie", cookieName);
    expect(afterRes.body.authenticated).toBe(false);
  });

  it("production misconfiguration with non-HTTPS issuer fails closed", () => {
    makeEnv({ NODE_ENV: "production", OIDC_ISSUER: "http://insecure.example.com/realms/lens", OIDC_REDIRECT_URI: "http://insecure.example.com/auth/callback" });
    expect(() => validateProductionConfig()).toThrow();
  });

  it("production build rejects missing secret configuration", () => {
    makeEnv({ NODE_ENV: "production", OIDC_CLIENT_SECRET: "" });
    expect(() => validateProductionConfig()).toThrow();
  });

  it("production build rejects OIDC_TEST_MODE being enabled", () => {
    makeEnv({ NODE_ENV: "production", OIDC_TEST_MODE: "true", OIDC_CLIENT_SECRET: CLIENT_SECRET });
    expect(() => validateProductionConfig()).toThrow(/TEST_MODE/i);
  });

  it("production build rejects the legacy gemini-test mode", () => {
    makeEnv({
      NODE_ENV: "production",
      APP_ORIGIN: "https://lens.example.com",
      OIDC_REDIRECT_URI: "https://lens.example.com/auth/callback",
      RAG_PROVIDER_MODE: "gemini-test",
    });
    expect(() => validateProductionConfig()).toThrow(/Invalid environment configuration|invalid enum/i);
  });

  it("rejects reusing the delegated assertion key as the conversation-reference key", () => {
    makeEnv({
      NODE_ENV: "production",
      APP_ORIGIN: "https://lens.example.com",
      OIDC_REDIRECT_URI: "https://lens.example.com/auth/callback",
      BFF_ASSERTION_PRIVATE_KEY: "z".repeat(48),
      MEMORY_ASSERTION_PRIVATE_KEY: "y".repeat(48),
      CONVERSATION_REFERENCE_SECRET: "z".repeat(48),
    });
    expect(() => validateProductionConfig()).toThrow(/distinct/i);
  });

  it("parses OIDC_REQUIRE_HTTPS_ISSUER=false as false (regression: z.coerce.boolean coerces 'false' to true)", () => {
    makeEnv({ OIDC_REQUIRE_HTTPS_ISSUER: "false" });
    expect(getConfig().OIDC_REQUIRE_HTTPS_ISSUER).toBe(false);
  });

  it("parses OIDC_REQUIRE_HTTPS_ISSUER=true as true", () => {
    makeEnv({ OIDC_REQUIRE_HTTPS_ISSUER: "true" });
    expect(getConfig().OIDC_REQUIRE_HTTPS_ISSUER).toBe(true);
  });

  it("defaults OIDC_REQUIRE_HTTPS_ISSUER to true when unset", () => {
    makeEnv();
    // The real server/.env may set this; clear it so we exercise the default branch.
    delete process.env.OIDC_REQUIRE_HTTPS_ISSUER;
    __resetConfig();
    expect(getConfig().OIDC_REQUIRE_HTTPS_ISSUER).toBe(true);
  });

  it("does not apply OIDC_REQUIRE_HTTPS_ISSUER=false to production fail-closed checks", () => {
    makeEnv({
      NODE_ENV: "production",
      OIDC_ISSUER: "http://insecure.example.com/realms/lens",
      OIDC_REDIRECT_URI: "http://insecure.example.com/auth/callback",
      OIDC_REQUIRE_HTTPS_ISSUER: "false",
    });
    expect(() => validateProductionConfig()).toThrow(/HTTPS/i);
  });

  it("internal RAG mode requires an Orchestrator ingress and rejects the legacy bridge", () => {
    makeEnv({ RAG_PROVIDER_MODE: "internal" });
    delete process.env.ORCHESTRATOR_URL;
    delete process.env.ORCHESTRATOR_TOKEN;
    __resetConfig();
    expect(() => validateProductionConfig()).toThrow(/ORCHESTRATOR_URL/);

    makeEnv({
      RAG_PROVIDER_MODE: "internal",
      ORCHESTRATOR_URL: "http://127.0.0.1:3002",
      ORCHESTRATOR_TOKEN: "o".repeat(32),
      RAG_SERVICE_URL: "http://127.0.0.1:8010",
      RAG_SERVICE_TOKEN: "r".repeat(32),
    });
    expect(() => validateProductionConfig()).toThrow(/Legacy RAG_SERVICE bridge settings are not supported/i);

    delete process.env.RAG_SERVICE_URL;
    delete process.env.RAG_SERVICE_TOKEN;
    __resetConfig();
    expect(() => validateProductionConfig()).not.toThrow();
  });

  it("rejects the legacy RAG_SERVICE bridge even when internal mode is disabled", () => {
    makeEnv({
      RAG_SERVICE_URL: "http://127.0.0.1:8010",
      RAG_SERVICE_TOKEN: "r".repeat(32),
    });
    expect(() => validateProductionConfig()).toThrow(/Legacy RAG_SERVICE bridge settings are not supported/i);
  });

  it("routes internal RAG mode through the Orchestrator client and never exposes provider details", async () => {
    makeEnv({
      RAG_PROVIDER_MODE: "internal",
      ORCHESTRATOR_URL: "http://127.0.0.1:3002",
      ORCHESTRATOR_TOKEN: "o".repeat(32),
    });
    const app = createApp({ generateHandler: async () => "x" });
    const callback = await completeLogin(app);
    const cookies = callback.header["set-cookie"] ?? [];
    const sessionCookie = cookies.find((cookie: string) => cookie.startsWith("lens_session="))?.split(";")[0] ?? "";
    const csrfCookie = cookies.find((cookie: string) => cookie.startsWith("lens_csrf="))?.split(";")[0] ?? "";
    const csrf = decodeURIComponent(csrfCookie.split("=").slice(1).join("="));

    const response = await request(app)
      .post("/api/rag/ask")
      .set("Cookie", [sessionCookie, csrfCookie])
      .set("x-lens-csrf", csrf)
      .send({ query: "What is the remote-work stipend?" });

    expect(response.status).toBe(503);
    expect(response.body.error).toBe("DEPENDENCY_UNAVAILABLE");
  });
});
