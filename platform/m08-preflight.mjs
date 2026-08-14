#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const store = readFileSync(path.join(root, "src/stores/conversationStore.ts"), "utf8");
const chat = readFileSync(path.join(root, "src/components/ai/ChatWindow.tsx"), "utf8");
const state = readFileSync(path.join(root, "src/features/employee-chat/turnState.ts"), "utf8");
if (store.includes("zustand/middleware") || chat.includes('id: "streaming"') || !["authorization_changed", "verifyRelease", "canResolveCitation"].every((control) => state.includes(control))) throw new Error("M08 employee client violates protected-release or memory-only controls.");
console.log("M08 Engineer B employee client preflight passed.");
