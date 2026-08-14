#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const contractsDir = path.join(root, "contracts");
const registry = JSON.parse(await readFile(path.join(contractsDir, "contract-registry.json"), "utf8"));
const sourceFiles = [
  path.join(contractsDir, "contract-registry.json"),
  path.join(contractsDir, registry.api),
  path.join(contractsDir, registry.events),
  path.join(contractsDir, registry.eventSchema),
  path.join(contractsDir, registry.errors),
  path.join(contractsDir, registry.compatibility),
];
const source = await Promise.all(sourceFiles.map((file) => readFile(file, "utf8")));
const digest = `sha256:${createHash("sha256").update(source.join("\n")).digest("hex")}`;
const generated = await readFile(path.join(root, "libs/generated-clients/index.ts"), "utf8");

if (!generated.includes(`CONTRACT_SOURCE_DIGEST = "${digest}"`)) {
  throw new Error("Generated client provenance does not match the published contract inputs. Run npm run generate.");
}

console.log(`Generated client provenance verified: ${digest}`);
