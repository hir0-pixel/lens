#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); const schema = JSON.parse(readFileSync(path.join(root, "services/agent-runtime/agent-runtime-schema.json"), "utf8"));
if (schema.owner !== "services/agent-runtime" || schema.contract !== "AGENT-EXECUTION-ENVELOPE" || schema.catalog !== "immutable-versioned-no-dynamic-discovery" || schema.envelope !== "durable-conservative-aggregate-counters" || schema.stepFence !== "exact-intent-expiring-one-use" || schema.approval !== "exact-intent-separation-single-use" || schema.close !== "monotonic-no-pending-or-unknown-completed" || schema.outcome !== "ambiguous-remains-consumed") throw new Error("M09 agent-runtime baseline violates execution-envelope controls.");
console.log("M09 Engineer A agent-runtime preflight passed.");
