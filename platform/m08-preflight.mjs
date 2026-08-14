#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const store = readFileSync(path.join(root, "src/stores/conversationStore.ts"), "utf8");
const chat = readFileSync(path.join(root, "src/components/ai/ChatWindow.tsx"), "utf8");
const state = readFileSync(path.join(root, "src/features/employee-chat/turnState.ts"), "utf8");
if (store.includes("zustand/middleware") || chat.includes('id: "streaming"') || !["authorization_changed", "verifyRelease", "canResolveCitation"].every((control) => state.includes(control))) throw new Error("M08 employee client violates protected-release or memory-only controls.");
const schema = JSON.parse(readFileSync(path.join(root, "services/product-bff/bff-security-schema.json"), "utf8"));
if (schema.owner !== "services/product-bff" || schema.session !== "current-device-key-csrf-bound" || schema.liveOutput !== "content-free-progress-only" || schema.finalOutput !== "signed-exact-digest-release-envelope-only" || schema.reopen !== "fresh-memory-redisclosure" || schema.citations !== "current-server-authorized-resolution" || schema.navigation !== "server-capability-manifest" || schema.clientStorage !== "no-protected-output" || schema.notifications !== "no-protected-output") throw new Error("M08 BFF baseline violates protected-product controls.");
console.log("M08 product-BFF and employee-client preflight passed.");
