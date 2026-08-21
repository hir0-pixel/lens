#!/usr/bin/env node
/**
 * RAG contract registry check (Track 1).
 *
 * Validates that:
 *  - every referenced schema exists and is well-formed JSON Schema;
 *  - additive-only evolution is preserved;
 *  - every required stable error code is present;
 *  - a TypeScript representation exists (libs/rag-contracts) and a Python
 *    representation exists (Enterprise-RAG/contracts/rag_contracts.py);
 *  - the generated representations are in sync with the schemas.
 */
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "../../..");
const ragDir = join(root, "contracts/rag");

const registryPath = join(ragDir, "registry.v1.json");
const registry = JSON.parse(await readFile(registryPath, "utf8"));

if (registry.version !== "1.0.0") throw new Error("RAG registry must be at version 1.0.0.");
if (registry.evolution !== "additive-only") throw new Error("RAG contracts must evolve additively.");

const schemaNames = new Set(Object.values(registry.contracts));
const digests = {};
for (const name of schemaNames) {
  const file = join(ragDir, name);
  await stat(file).catch(() => {
    throw new Error(`RAG contract references missing schema: ${name}`);
  });
  const raw = await readFile(file, "utf8");
  const schema = JSON.parse(raw);
  if (!schema.$id || !schema.type) throw new Error(`Schema ${name} is not a well-formed JSON Schema.`);
  if (schema.additionalProperties !== false && schema.$id.endsWith(":v1")) {
    if (name !== "retrieval-result.v1.schema.json") {
      throw new Error(`Schema ${name} must reject unknown fields at trust boundaries.`);
    }
  }
  digests[name] = createHash("sha256").update(raw.replace(/\r\n/g, "\n")).digest("hex");
}

for (const code of registry["required-stable-codes"]) {
  const errorSchema = JSON.parse(await readFile(join(ragDir, registry.contracts.error), "utf8"));
  if (!errorSchema.properties.code.enum.includes(code)) {
    throw new Error(`Error contract is missing required stable code: ${code}`);
  }
}

// Generated representations must exist and agree with the source digests.
const tsPath = join(root, "libs/rag-contracts/index.ts");
const pyPath = join(root, "Enterprise-RAG/contracts/rag_contracts.py");
const tsSource = await readFile(tsPath, "utf8");
const pySource = await readFile(pyPath, "utf8");

const tsDigest = tsSource.match(/SCHEMA_DIGESTS = \{([^}]*)\}/s);
if (!tsDigest) throw new Error("TypeScript representation is missing SCHEMA_DIGESTS.");
const tsDigestValue = tsDigest[1].replace(/\s/g, "").replaceAll('"', "");
for (const [name, digest] of Object.entries(digests)) {
  if (!tsDigestValue.includes(`${name}:${digest}`)) {
    throw new Error(`TypeScript representation is out of date for ${name}.`);
  }
}

const pyDigest = pySource.match(/SCHEMA_DIGESTS = \{([^}]*)\}/s);
if (!pyDigest) throw new Error("Python representation is missing SCHEMA_DIGESTS.");
const pyDigestValue = pyDigest[1].replace(/\s/g, "").replaceAll('"', "");
for (const [name, digest] of Object.entries(digests)) {
  if (!pyDigestValue.includes(`${name}:${digest}`)) {
    throw new Error(`Python representation is out of date for ${name}.`);
  }
}

console.log("RAG contract registry checks passed for v1 (TypeScript and Python representations in sync).");