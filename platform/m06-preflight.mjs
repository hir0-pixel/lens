#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "services/orchestrator/RagComposition.ts"), "utf8");
for (const requirement of ["refreshCitation", "authorizeContextUse", "useBoundary: \"generation\" | \"citation\"", "status: \"no_context\"", "STALE_AUTHORITY", "maxContextBytes"]) {
  if (!source.includes(requirement)) throw new Error(`M06 RAG composition is missing required control: ${requirement}`);
}
console.log("M06 Engineer B RAG composition preflight passed.");
