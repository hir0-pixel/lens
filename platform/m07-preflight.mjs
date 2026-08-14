#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "services/model-gateway/ModelGateway.ts"), "utf8");
for (const control of ["external", "contextFence", "budgetReservationRef", "scheduler.reserve", "scheduler.start", "this.dispatched", "finally"]) if (!source.includes(control)) throw new Error(`M07 model-serving control missing: ${control}`);
console.log("M07 Engineer B serving preflight passed.");
