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

const bff = loadEnv(resolve(root, ".local/rag-stack/bff-rag.env"));
const modelRef = process.argv[2] ?? "gemini-2.5-flash";
const token = bff.CATALOG_WORKLOAD_TOKEN;
const url = new URL("http://127.0.0.1:3001/internal/v1/provider-runtime-config");
url.searchParams.set("model_ref", modelRef);

const response = await fetch(url, {
  headers: { accept: "application/json", "x-lens-workload-token": token },
});
const body = await response.text();
console.log("provider-runtime-config:", response.status, body.slice(0, 500));
