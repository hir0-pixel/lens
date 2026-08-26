import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    let value = trimmed.slice(eq + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\n/g, "\n");
    }
    env[trimmed.slice(0, eq)] = value;
  }
  return env;
}

const orch = loadEnv(resolve(root, ".local/rag-stack/orchestrator.env"));
const url = orch.LENS_APPROVED_CATALOG_URL;
const token = orch.LENS_APPROVED_CATALOG_TOKEN;

const response = await fetch(url, {
  headers: { accept: "application/json", "x-lens-workload-token": token },
});
const body = await response.json();
console.log("catalog fetch:", response.status, "models:", Array.isArray(body.models) ? body.models.length : 0);
if (Array.isArray(body.models) && body.models[0]) {
  console.log("sample:", body.models[0]);
}
