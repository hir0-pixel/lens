#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runModelBridgeLoad } from "./model-bridge-load.mjs";

const EXPECTED_ISSUER = "https://identity.platform.internal:8443/realms/lens-internal";
const EXPECTED_HEALTH_URL = "http://127.0.0.1:8081/health/live";

export async function collectIdentityPilotEvidence({
  issuer,
  healthUrl = EXPECTED_HEALTH_URL,
  modelBridgeUrl,
  modelBridgeToken,
  requests = 10,
  concurrency = 2,
  fetcher = fetch,
  loadRunner = runModelBridgeLoad,
}) {
  if (issuer !== EXPECTED_ISSUER || healthUrl !== EXPECTED_HEALTH_URL) throw new Error("Invalid production-pilot endpoint configuration.");
  const discoveryResponse = await fetcher(`${issuer}/.well-known/openid-configuration`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!discoveryResponse.ok) throw new Error("OIDC discovery check failed.");
  const discovery = await discoveryResponse.json();
  if (discovery?.issuer !== issuer || typeof discovery?.authorization_endpoint !== "string" || typeof discovery?.token_endpoint !== "string") throw new Error("OIDC discovery document is invalid.");

  const healthResponse = await fetcher(healthUrl, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5_000) });
  if (!healthResponse.ok || (await healthResponse.json())?.status !== "ok") throw new Error("Session gateway liveness check failed.");

  const load = await loadRunner({ url: modelBridgeUrl, token: modelBridgeToken, requests, concurrency, fetcher });
  return {
    schemaVersion: 1,
    evidenceKind: "single-server-production-pilot",
    measuredAt: new Date().toISOString(),
    checks: { oidcDiscovery: true, sessionGatewayLive: true, modelBridge: load.failed === 0 },
    load,
    passed: load.failed === 0,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const requests = Number.parseInt(process.argv[2] ?? "10", 10);
  const concurrency = Number.parseInt(process.argv[3] ?? "2", 10);
  const evidence = await collectIdentityPilotEvidence({
    issuer: process.env.LENS_IDENTITY_ISSUER,
    modelBridgeUrl: process.env.LENS_INTERNAL_MODEL_BRIDGE_URL,
    modelBridgeToken: process.env.LENS_INTERNAL_MODEL_BRIDGE_TOKEN,
    requests,
    concurrency,
  });
  console.log(JSON.stringify(evidence, null, 2));
  if (!evidence.passed) process.exitCode = 1;
}
