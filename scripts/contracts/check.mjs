#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const contractsDir = path.join(root, "contracts");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(contractsDir, relativePath), "utf8"));
}

const registry = await readJson("contract-registry.json");
const errors = await readJson(registry.errors);
const compatibility = await readJson(registry.compatibility);
const eventSchema = await readJson(registry.eventSchema);
const api = await readJson(registry.api);

const requiredErrors = [
  "INVALID_ARGUMENT",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "STALE_AUTHORITY",
  "CONFLICT",
  "NOT_FOUND_OR_NOT_DISCLOSABLE",
  "RATE_LIMITED",
  "OVERLOADED",
  "DEPENDENCY_UNAVAILABLE",
  "DEADLINE_EXCEEDED",
  "CANCELLED",
  "AMBIGUOUS_OUTCOME",
  "QUARANTINED",
  "EVIDENCE_REQUIRED",
  "INTERNAL",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(registry.version === errors.version, "Error registry version must match contract version.");
assert(registry.version === compatibility.current, "Compatibility current version must match contract version.");
assert(compatibility.evolution === "additive-only", "Contract evolution must be additive-only.");
assert(requiredErrors.every((code) => errors.codes.includes(code)), "Error registry is missing a required stable code.");
assert(errors.rules.safeMessageOnly === true, "Errors must expose safe messages only.");
assert(Array.isArray(eventSchema.required) && eventSchema.required.includes("payload_digest"), "Events require a payload digest.");
assert(api.paths?.["/v1/contract-probe"]?.post?.["x-idempotency-required"] === true, "Mutating API requires an idempotency key.");
assert(api.paths?.["/v1/contract-probe"]?.post?.["x-deadline-required"] === true, "API requires an absolute deadline.");

console.log(`Contract registry checks passed for ${registry.contract}@${registry.version}`);
