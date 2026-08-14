#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const contractsDir = path.join(root, "contracts");
const registryPath = path.join(contractsDir, "contract-registry.json");
const templatePath = path.join(root, "scripts/contracts/generated-client.template.txt");
const outputDir = path.join(root, "libs/generated-clients");
const outputPath = path.join(outputDir, "index.ts");

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

const registry = await readJson(registryPath);
const errors = await readJson(path.join(contractsDir, registry.errors));
const compatibility = await readJson(path.join(contractsDir, registry.compatibility));

if (registry.version !== errors.version || registry.version !== compatibility.current) {
  throw new Error("Contract registry versions must match the error and compatibility registries.");
}
if (!Array.isArray(errors.codes) || errors.codes.length === 0) {
  throw new Error("Error registry must contain at least one stable error code.");
}
if (compatibility.evolution !== "additive-only") {
  throw new Error("M00 contracts must use additive-only evolution.");
}

const sourceFiles = [registryPath, path.join(contractsDir, registry.api), path.join(contractsDir, registry.events), path.join(contractsDir, registry.eventSchema), path.join(contractsDir, registry.errors), path.join(contractsDir, registry.compatibility)];
const source = await Promise.all(sourceFiles.map((file) => readFile(file, "utf8")));
const digest = createHash("sha256").update(source.join("\n")).digest("hex");
const template = await readFile(templatePath, "utf8");
const output = template
  .replaceAll("__CONTRACT_NAME__", registry.contract)
  .replaceAll("__CONTRACT_VERSION__", registry.version)
  .replaceAll("__CONTRACT_OWNER__", registry.owner)
  .replaceAll("__CONTRACT_CLIENT_WORKLOAD__", registry.clientWorkload)
  .replaceAll("__CONTRACT_SOURCE_DIGEST__", `sha256:${digest}`)
  .replace("__ERROR_CODES__", JSON.stringify(errors.codes));

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, output, "utf8");
console.log(`Generated ${path.relative(root, outputPath)} from ${registry.contract}@${registry.version}`);
