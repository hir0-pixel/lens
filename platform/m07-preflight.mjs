#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); const schema = JSON.parse(readFileSync(path.join(root, "services/model-registry/registry-schema.json"), "utf8")); const evidence = ["evaluation", "red_team", "privacy", "provenance", "security"];
if (schema.owner !== "services/model-registry" || schema.artifacts !== "internal-oci-digest-addressed-no-byte-api" || schema.promotion !== "registry-only-evidence-gated-audit-admitted" || !evidence.every((kind) => schema.requiredEvidence?.includes(kind)) || schema.eligibility !== "signed-snapshot-explicit-expiry" || schema.revocation !== "emergency-deny-epoch-overrides-alias-and-rollout" || schema.rollout !== "immutable-digest-pinned-routable-members-only" || schema.routing !== "gateway-owned") throw new Error("M07 registry baseline violates model eligibility controls.");
console.log("M07 Engineer A model-registry preflight passed.");
