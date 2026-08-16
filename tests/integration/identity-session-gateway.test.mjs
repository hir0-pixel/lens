import assert from "node:assert/strict";
import { test } from "node:test";
import { createIdentitySessionGateway, requireInternalIssuer } from "../../scripts/identity-session-gateway-core.mjs";

const secret = "a".repeat(32);
const make = (fetcher) => createIdentitySessionGateway({ mode: "internal-test-only", issuer: "https://identity.platform.internal:8443/realms/lens-internal", clientId: "lens-session-gateway", clientSecret: secret, allowedClientIp: "10.164.13.233", allowedOrigin: "http://localhost:1420", redirectUri: "https://lens-gateway.platform.internal:8444/auth/callback", random: (n) => Buffer.alloc(n, 7), fetcher });

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
