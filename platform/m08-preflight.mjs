#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); const schema = JSON.parse(readFileSync(path.join(root, "services/product-bff/bff-security-schema.json"), "utf8"));
if (schema.owner !== "services/product-bff" || schema.session !== "current-device-key-csrf-bound" || schema.liveOutput !== "content-free-progress-only" || schema.finalOutput !== "signed-exact-digest-release-envelope-only" || schema.reopen !== "fresh-memory-redisclosure" || schema.citations !== "current-server-authorized-resolution" || schema.navigation !== "server-capability-manifest" || schema.clientStorage !== "no-protected-output" || schema.notifications !== "no-protected-output") throw new Error("M08 BFF baseline violates protected-product controls.");
console.log("M08 Engineer A product-BFF preflight passed.");
