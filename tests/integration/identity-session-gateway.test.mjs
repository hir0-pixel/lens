import assert from "node:assert/strict";
import { test } from "node:test";
import { createIdentitySessionGateway, requireInternalIssuer, requireInternalModelBridge, validEdgeCredential } from "../../scripts/identity-session-gateway-core.mjs";

const secret = "a".repeat(32);
const make = (fetcher) => createIdentitySessionGateway({ mode: "internal-test-only", issuer: "https://identity.platform.internal:8443/realms/lens-internal", clientId: "lens-session-gateway", clientSecret: secret, edgeToken: "c".repeat(32), allowedOrigin: "http://localhost:1420", redirectUri: "https://lens-gateway.platform.internal:8444/auth/callback", modelBridgeUrl: "http://edge:8082/v1/lab/generate", modelBridgeToken: "b".repeat(32), random: (n) => Buffer.alloc(n, 7), fetcher });

test("identity gateway authenticates the private edge hop with a distinct credential", () => {
  assert.equal(validEdgeCredential("c".repeat(32), "c".repeat(32)), true);
  assert.equal(validEdgeCredential("d".repeat(32), "c".repeat(32)), false);
  assert.equal(validEdgeCredential(undefined, "c".repeat(32)), false);
});

test("identity gateway performs server-side PKCE exchange and CSRF-bound session issuance", async () => {
  const gateway = make(async (url) => url.endsWith("/token") ? { ok: true, json: async () => ({ access_token: "token" }) } : { ok: true, json: async () => ({ sub: "user-1" }) });
  const login = gateway.beginLogin();
  const state = new URL(login).searchParams.get("state");
  assert.equal(new URL(login).searchParams.get("code_challenge_method"), "S256");
  const session = await gateway.finishLogin({ state, code: "code" });
  assert.equal(gateway.session(session.sessionId, session.csrfToken)?.subjectRef, "user-1");
  assert.equal(gateway.session(session.sessionId, "wrong"), undefined);
});

test("identity gateway refuses public or non-HTTPS issuers", () => {
  assert.equal(requireInternalIssuer("https://identity.platform.internal:8443/realms/lens-internal"), "https://identity.platform.internal:8443/realms/lens-internal");
  assert.throws(() => requireInternalIssuer("http://identity.platform.internal/realms/lens-internal"));
  assert.throws(() => requireInternalIssuer("https://identity.example/realms/lens-internal"));
});

test("identity gateway relays only authenticated, bounded public-test prompts", async () => {
  const calls = [];
  const gateway = make(async (url, init) => {
    if (url.endsWith("/token")) return { ok: true, json: async () => ({ access_token: "token" }) };
    if (url.endsWith("/userinfo")) return { ok: true, json: async () => ({ sub: "user-1" }) };
    calls.push({ url, init });
    return { ok: true, json: async () => ({ output: "local answer", ignored: "not exposed" }) };
  });
  const state = new URL(gateway.beginLogin()).searchParams.get("state");
  const session = await gateway.finishLogin({ state, code: "code" });

  assert.deepEqual(await gateway.generate(session.sessionId, session.csrfToken, { publicTest: true, prompt: "Hello" }), { status: 200, body: { output: "local answer" } });
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
  assert.throws(() => createIdentitySessionGateway({ mode: "internal-test-only", issuer: "https://identity.platform.internal:8443/realms/lens-internal", clientId: "client", clientSecret: secret, edgeToken: "c".repeat(32), allowedOrigin: "https://public.example", redirectUri: "https://lens-gateway.platform.internal:8444/auth/callback", modelBridgeUrl: "http://edge:8082/v1/lab/generate", modelBridgeToken: secret }));
  assert.throws(() => createIdentitySessionGateway({ mode: "internal-test-only", issuer: "https://identity.platform.internal:8443/realms/lens-internal", clientId: "client", clientSecret: secret, edgeToken: "c".repeat(32), allowedOrigin: "http://localhost:1420", redirectUri: "https://public.example/auth/callback", modelBridgeUrl: "http://edge:8082/v1/lab/generate", modelBridgeToken: secret }));
});
