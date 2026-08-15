import assert from "node:assert/strict";
import { test } from "node:test";
import { corsHeaders, createOllamaLabGateway, isAllowedLabOrigin, securityHeaders } from "../../scripts/ollama-lab-gateway-core.mjs";

const token = "a".repeat(32);
const request = (overrides = {}) => ({
  method: "POST",
  path: "/v1/lab/generate",
  authorization: `Bearer ${token}`,
  remoteAddress: "::ffff:10.164.13.99",
  body: JSON.stringify({ publicTest: true, prompt: "Say hello" }),
  ...overrides,
});

test("lab gateway accepts only its approved client and relays public-test prompts to node-local Ollama", async () => {
  const calls = [];
  const gateway = createOllamaLabGateway({
    mode: "public-test-only",
    accessToken: token,
    allowedClientIp: "10.164.13.99",
    model: "llama3.2",
    fetcher: async (url, init) => {
      calls.push({ url: url.toString(), body: init.body });
      return { ok: true, json: async () => ({ response: "Hello", done: true }) };
    },
  });

  assert.deepEqual(await gateway.handle(request()), { status: 200, body: { output: "Hello" } });
  assert.deepEqual(calls, [{ url: "http://127.0.0.1:11434/api/generate", body: '{"model":"llama3.2","prompt":"Say hello","stream":false}' }]);
});

test("lab gateway rejects unauthenticated clients and malformed or non-public-test requests before calling Ollama", async () => {
  let calls = 0;
  const gateway = createOllamaLabGateway({
    mode: "public-test-only",
    accessToken: token,
    allowedClientIp: "10.164.13.99",
    model: "llama3.2",
    fetcher: async () => { calls += 1; return { ok: true, json: async () => ({ response: "unexpected", done: true }) }; },
  });

  assert.deepEqual(await gateway.handle(request({ authorization: "" })), { status: 401, body: { error: { code: "UNAUTHENTICATED" } } });
  assert.deepEqual(await gateway.handle(request({ remoteAddress: "10.164.13.88" })), { status: 403, body: { error: { code: "FORBIDDEN" } } });
  assert.deepEqual(await gateway.handle(request({ body: JSON.stringify({ prompt: "not marked public" }) })), { status: 400, body: { error: { code: "INVALID_ARGUMENT" } } });
  assert.equal(calls, 0);
});

test("lab gateway refuses non-loopback model configuration", () => {
  assert.throws(() => createOllamaLabGateway({ mode: "public-test-only", accessToken: token, allowedClientIp: "10.164.13.99", model: "llama3.2", endpoint: "http://10.164.13.57:11434/api/generate" }));
});

test("lab gateway CORS is restricted to its configured website origin", () => {
  assert.equal(corsHeaders("http://localhost:1420", "http://localhost:1420")["access-control-allow-origin"], "http://localhost:1420");
  assert.deepEqual(corsHeaders("http://untrusted.example", "http://localhost:1420"), {});
  assert.equal(isAllowedLabOrigin("http://10.164.13.233:1420"), true);
  assert.equal(isAllowedLabOrigin("http://gateway.example"), false);
});

test("lab gateway sends browser hardening headers on every response", () => {
  assert.deepEqual(securityHeaders(), {
    "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "permissions-policy": "accelerometer=(), camera=(), geolocation=(), microphone=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
});

test("lab gateway bounds authenticated request bursts before they reach Ollama", async () => {
  const gateway = createOllamaLabGateway({
    mode: "public-test-only", accessToken: token, allowedClientIp: "10.164.13.99", model: "llama3.2",
    rateLimit: { capacity: 1, refillPerSecond: 0 },
    fetcher: async () => ({ ok: true, json: async () => ({ response: "answer", done: true }) }),
  });
  assert.equal((await gateway.handle(request())).status, 200);
  assert.deepEqual(await gateway.handle(request()), { status: 429, body: { error: { code: "RATE_LIMITED" } } });
});

test("lab gateway rejects a public-network client address", () => {
  assert.throws(() => createOllamaLabGateway({ mode: "public-test-only", accessToken: token, allowedClientIp: "8.8.8.8", model: "llama3.2" }));
});
