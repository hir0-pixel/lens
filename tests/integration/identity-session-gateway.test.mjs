import assert from "node:assert/strict";
import { test } from "node:test";
import { createIdentitySessionGateway, createSealedSessionCodec, requireInternalIssuer, requireInternalModelBridge, validEdgeCredential } from "../../scripts/identity-session-gateway-core.mjs";

const secret = "a".repeat(32);
const make = (fetcher) => createIdentitySessionGateway({ mode: "internal-test-only", issuer: "https://identity.platform.internal:8443/realms/lens-internal", clientId: "lens-session-gateway", clientSecret: secret, cookieSecret: "d".repeat(32), edgeToken: "c".repeat(32), allowedOrigin: "http://localhost:1420", redirectUri: "https://lens-gateway.platform.internal:8444/auth/callback", modelBridgeUrl: "http://edge:8082/v1/lab/generate", modelBridgeToken: "b".repeat(32), random: (n) => Buffer.alloc(n, 7), fetcher });
const tokenPayload = { access_token: "access-token", refresh_token: "refresh-token", expires_in: 300 };
const identityFetcher = async (url) => {
  if (url.endsWith("/token")) return { ok: true, json: async () => tokenPayload };
  if (url.endsWith("/userinfo")) return { ok: true, json: async () => ({ sub: "user-1" }) };
  if (url.endsWith("/token/introspect")) return { ok: true, json: async () => ({ active: true, sub: "user-1" }) };
  throw new Error(`Unexpected URL: ${url}`);
};

test("identity gateway authenticates the private edge hop with a distinct credential", () => {
  assert.equal(validEdgeCredential("c".repeat(32), "c".repeat(32)), true);
  assert.equal(validEdgeCredential("d".repeat(32), "c".repeat(32)), false);
  assert.equal(validEdgeCredential(undefined, "c".repeat(32)), false);
});

test("identity gateway performs server-side PKCE exchange and CSRF-bound session issuance", async () => {
  const gateway = make(identityFetcher);
  const login = gateway.beginLogin();
  const state = new URL(login).searchParams.get("state");
  assert.equal(new URL(login).searchParams.get("code_challenge_method"), "S256");
  const session = await gateway.finishLogin({ state, code: "code" });
  assert.equal((await gateway.session(session.sessionId, session.csrfToken))?.subjectRef, "user-1");
  assert.equal(await gateway.session(session.sessionId, "wrong"), undefined);
});

test("sealed sessions survive a gateway restart and reject tampering", async () => {
  const first = make(identityFetcher);
  const state = new URL(first.beginLogin()).searchParams.get("state");
  const session = await first.finishLogin({ state, code: "code" });
  const restarted = make(identityFetcher);
  assert.equal((await restarted.bootstrapSession(session.sessionId))?.subjectRef, "user-1");
  assert.equal(await restarted.bootstrapSession(`${session.sessionId}x`), undefined);
  const codec = createSealedSessionCodec("d".repeat(32), (n) => Buffer.alloc(n, 7));
  assert.equal(codec.open(`${session.sessionId}x`), undefined);
  assert.throws(() => codec.seal({ payload: "x".repeat(4_000) }), /cookie limit/);
});

test("logout revokes both refresh and access tokens", async () => {
  const revoked = [];
  const gateway = make(async (url, init) => {
    if (url.endsWith("/token")) return { ok: true, json: async () => tokenPayload };
    if (url.endsWith("/userinfo")) return { ok: true, json: async () => ({ sub: "user-1" }) };
    if (url.endsWith("/revoke")) {
      revoked.push(Object.fromEntries(init.body));
      return { ok: true };
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
  const state = new URL(gateway.beginLogin()).searchParams.get("state");
  const session = await gateway.finishLogin({ state, code: "code" });
  await gateway.revoke(session.sessionId);
  assert.deepEqual(revoked, [
    { token: "refresh-token", token_type_hint: "refresh_token" },
    { token: "access-token", token_type_hint: "access_token" },
  ]);
});

test("identity gateway refuses public or non-HTTPS issuers", () => {
  assert.equal(requireInternalIssuer("https://identity.platform.internal:8443/realms/lens-internal"), "https://identity.platform.internal:8443/realms/lens-internal");
  assert.throws(() => requireInternalIssuer("http://identity.platform.internal/realms/lens-internal"));
  assert.throws(() => requireInternalIssuer("https://identity.example/realms/lens-internal"));
});

test("identity gateway relays only authenticated, bounded public-test prompts", async () => {
  const calls = [];
  const gateway = make(async (url, init) => {
    if (url.endsWith("/token")) return { ok: true, json: async () => tokenPayload };
    if (url.endsWith("/userinfo")) return { ok: true, json: async () => ({ sub: "user-1" }) };
    if (url.endsWith("/token/introspect")) return { ok: true, json: async () => ({ active: true, sub: "user-1" }) };
    calls.push({ url, init });
    return { ok: true, json: async () => ({ output: "local answer", ignored: "not exposed" }) };
  });
  const state = new URL(gateway.beginLogin()).searchParams.get("state");
  const session = await gateway.finishLogin({ state, code: "code" });

  const generated = await gateway.generate(session.sessionId, session.csrfToken, { publicTest: true, prompt: "Hello" });
  assert.deepEqual({ status: generated.status, body: generated.body }, { status: 200, body: { output: "local answer" } });
  assert.equal(typeof generated.cookieValue, "string");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.authorization, `Bearer ${"b".repeat(32)}`);
  assert.deepEqual(await gateway.generate(session.sessionId, "wrong", { publicTest: true, prompt: "Hello" }), { status: 401, body: { error: "UNAUTHENTICATED" } });
  assert.deepEqual(await gateway.generate(session.sessionId, session.csrfToken, { publicTest: false, prompt: "Hello" }), { status: 400, body: { error: "INVALID_REQUEST" } });
  assert.equal(calls.length, 1);
});

test("identity gateway accepts only the approved internal edge relay", () => {
  assert.equal(requireInternalModelBridge("http://edge:8082/v1/lab/generate"), "http://edge:8082/v1/lab/generate");
  assert.throws(() => requireInternalModelBridge("http://host.docker.internal:8080/v1/lab/generate"));
  assert.throws(() => requireInternalModelBridge("http://10.164.13.57:8080/v1/lab/generate"));
  assert.throws(() => requireInternalModelBridge("https://example.com/v1/lab/generate"));
});

test("identity gateway refuses unapproved browser origins and callback locations", () => {
  assert.throws(() => createIdentitySessionGateway({ mode: "internal-test-only", issuer: "https://identity.platform.internal:8443/realms/lens-internal", clientId: "client", clientSecret: secret, cookieSecret: "d".repeat(32), edgeToken: "c".repeat(32), allowedOrigin: "https://public.example", redirectUri: "https://lens-gateway.platform.internal:8444/auth/callback", modelBridgeUrl: "http://edge:8082/v1/lab/generate", modelBridgeToken: secret }));
  assert.throws(() => createIdentitySessionGateway({ mode: "internal-test-only", issuer: "https://identity.platform.internal:8443/realms/lens-internal", clientId: "client", clientSecret: secret, cookieSecret: "d".repeat(32), edgeToken: "c".repeat(32), allowedOrigin: "http://localhost:1420", redirectUri: "https://public.example/auth/callback", modelBridgeUrl: "http://edge:8082/v1/lab/generate", modelBridgeToken: secret }));
});
