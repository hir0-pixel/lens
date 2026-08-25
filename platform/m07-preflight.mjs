#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gatewaySource = readFileSync(path.join(root, "services/model-gateway/ModelGateway.ts"), "utf8");
const schema = JSON.parse(readFileSync(path.join(root, "services/model-registry/registry-schema.json"), "utf8"));
const evidence = ["evaluation", "red_team", "privacy", "provenance", "security"];
const ollamaSource = readFileSync(path.join(root, "services/inference-adapter/OllamaInferenceAdapter.ts"), "utf8");
for (const control of ["external", "scheduler.reserve", "scheduler.start", "leaseToken", "scheduler_lease", "commitContactIntent", "OUTCOME_UNKNOWN", "getAttemptStatus", "finally"]) if (!gatewaySource.includes(control)) throw new Error(`M07 model-serving control missing: ${control}`);
for (const control of ["127.0.0.1", "endpoint.protocol !== \"http:\"", "endpoint.pathname !== \"/api/generate\"", "stream: false", "eval_count"]) if (!ollamaSource.includes(control)) throw new Error(`M07 local-runtime control missing: ${control}`);
if (schema.owner !== "services/model-registry" || schema.artifacts !== "internal-oci-digest-addressed-no-byte-api" || schema.promotion !== "registry-only-evidence-gated-audit-admitted" || !evidence.every((kind) => schema.requiredEvidence?.includes(kind)) || schema.eligibility !== "signed-snapshot-explicit-expiry" || schema.revocation !== "emergency-deny-epoch-overrides-alias-and-rollout" || schema.rollout !== "immutable-digest-pinned-routable-members-only" || schema.routing !== "gateway-owned") throw new Error("M07 registry baseline violates model eligibility controls.");
console.log("M07 model-registry and serving preflight passed.");
