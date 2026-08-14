#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); const profile = JSON.parse(readFileSync(path.join(root, "services/tool-sandbox/content-isolation-profile.json"), "utf8"));
const checks = ["content-hash", "independent-type-detection", "malware", "format", "archive-expansion", "isolation-evidence", "microvm-destruction"];
if (profile.owner !== "services/tool-sandbox" || profile.contract !== "UNTRUSTED-CONTENT-ISOLATION" || profile.runtime !== "ingestion-parser-disposable-microvm" || profile.allParsingPaths !== "microvm-only" || profile.network !== "none" || profile.dns !== false || profile.platformIdentity !== false || profile.credentials !== false || profile.inputCapability !== "single-object-read-only" || profile.outputCapability !== "bounded-write-only" || profile.quarantineWithoutDowngrade !== true || !checks.every((check) => profile.requiredChecks?.includes(check))) throw new Error("M05 content isolation baseline violates parser-sandbox controls.");
console.log("M05 Engineer A content-isolation preflight passed.");
