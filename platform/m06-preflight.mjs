#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); const schema = JSON.parse(readFileSync(path.join(root, "services/retrieval/retrieval-schema.json"), "utf8"));
if (schema.owner !== "services/retrieval" || schema.candidateLimit !== 1000 || schema.authorization !== "fresh-operation-and-batch-pdp-before-content-fetch" || schema.indexSecurity !== "pruning-only" || schema.contentFetch !== "exact-version-fence-bound" || schema.finalDecisionCache !== false || schema.cache !== "immutable-revisioned-hmac-keyed-artifacts-only" || schema.zeroAuthorizedResult !== "no_context" || schema.audit !== "compact-pre-disclosure-admission" || schema.manifest !== "immutable-lineage-not-authorization") throw new Error("M06 retrieval baseline violates live authorization controls.");
console.log("M06 Engineer A retrieval preflight passed.");
