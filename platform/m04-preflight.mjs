#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); const schema = JSON.parse(readFileSync(path.join(root, "services/memory/memory-schema.json"), "utf8"));
if (schema.owner !== "services/memory" || schema.conversationCommit !== "begin-before-inference-finalize-before-completed" || schema.idempotency !== "actor-conversation-canonical-digest-bound" || schema.turnOrdering !== "serializable-conversation-revision-cas" || schema.finalOutput !== "immutable-digest-verified-quorum-proof-and-terminal-run-close" || schema.outbox !== "atomic-turn-state-and-outbox" || schema.redisclosure !== "fresh-authorization-and-audit-before-output-reference" || schema.repair !== "degrade-unreadable-or-unverified-output") throw new Error("M04 Memory baseline violates durable conversation controls.");
console.log("M04 Engineer A Memory preflight passed.");
