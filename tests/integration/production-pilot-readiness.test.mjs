import assert from "node:assert/strict";
import { test } from "node:test";
import { runModelBridgeLoad } from "../../scripts/readiness/model-bridge-load.mjs";
import { collectIdentityPilotEvidence } from "../../scripts/readiness/identity-pilot-evidence.mjs";

test("model bridge load evidence is bounded and content free", async () => {
  let inFlight = 0;
  let peak = 0;
  const evidence = await runModelBridgeLoad({
    url: "http://edge:8082/v1/lab/generate",
    token: "t".repeat(32),
    requests: 8,
    concurrency: 3,
    fetcher: async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return { ok: true, json: async () => ({ output: "private response that must not enter evidence" }) };
    },
  });
  assert.equal(evidence.evidenceKind, "legacy-lab-model-bridge-load");
  assert.equal(evidence.scope, "legacy-lab-only");
  assert.equal(evidence.passed, 8);
  assert.equal(evidence.failed, 0);
  assert.equal(peak, 3);
  assert.equal(JSON.stringify(evidence).includes("private response"), false);
  await assert.rejects(() => runModelBridgeLoad({ url: "https://public.example/generate", token: "t".repeat(32) }));
  await assert.rejects(() => runModelBridgeLoad({ url: "http://edge:8082/v1/lab/generate", token: "short", requests: 1 }));
});

test("production pilot evidence checks identity and omits credentials and model content", async () => {
  const evidence = await collectIdentityPilotEvidence({
    issuer: "https://identity.platform.internal:8443/realms/lens-internal",
    modelBridgeUrl: "http://edge:8082/v1/lab/generate",
    modelBridgeToken: "secret-that-must-never-appear-in-evidence",
    requests: 4,
    concurrency: 2,
    fetcher: async (url) => {
      if (url.endsWith("/.well-known/openid-configuration")) return { ok: true, json: async () => ({ issuer: "https://identity.platform.internal:8443/realms/lens-internal", authorization_endpoint: "internal-auth", token_endpoint: "internal-token" }) };
      if (url.endsWith("/health/live")) return { ok: true, json: async () => ({ status: "ok" }) };
      throw new Error(`Unexpected URL: ${url}`);
    },
    loadRunner: async ({ requests, concurrency }) => ({ schemaVersion: 1, requests, concurrency, passed: requests, failed: 0, latencyMs: { p95: 10 } }),
  });
  assert.equal(evidence.passed, true);
  assert.equal(evidence.checks.oidcDiscovery, true);
  assert.equal(JSON.stringify(evidence).includes("secret-that-must-never-appear"), false);
});

test("production pilot evidence rejects substituted public endpoints", async () => {
  await assert.rejects(() => collectIdentityPilotEvidence({
    issuer: "https://public.example/realms/lens-internal",
    modelBridgeUrl: "http://edge:8082/v1/lab/generate",
    modelBridgeToken: "t".repeat(32),
  }));
});
