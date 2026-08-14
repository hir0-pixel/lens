#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); const schema = JSON.parse(readFileSync(path.join(root, "services/pdp/policy-schema.json"), "utf8"));
if (schema.soleDecisionAuthority !== true || schema.liveOwnerFacts !== true || schema.finalDecisionCache !== false || schema.batchMaxResources !== 1000 || schema.batchSnapshot !== "single-committed-owner-snapshot" || schema.allowFence !== "request-action-resource-revision-deadline-bound-one-use" || schema.audit !== "one-compact-event-per-batch") throw new Error("M03 PDP baseline violates live-decision controls.");
console.log("M03 Engineer A PDP preflight passed.");
