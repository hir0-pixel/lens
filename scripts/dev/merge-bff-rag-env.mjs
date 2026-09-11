import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq);
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).replace(/\\n/g, "\n");
    }
    out[key] = value;
  }
  return out;
}

function serializeEnv(record) {
  return Object.entries(record)
    .map(([key, value]) => {
      const text = /(?:_PATH|_PREFIX)$/.test(key) ? value.replaceAll("\\", "/") : value;
      if (/[\s#]/.test(text) || text.includes("\n")) {
        return `${key}="${text.replace(/\n/g, "\\n")}"`;
      }
      return `${key}=${text}`;
    })
    .join("\n");
}

const serverPath = resolve(root, "server/.env");
const ragPath = resolve(root, ".local/rag-stack/bff-rag.env");
const merged = {
  ...parseEnv(readFileSync(serverPath, "utf8")),
  ...parseEnv(readFileSync(ragPath, "utf8")),
};
writeFileSync(serverPath, `${serializeEnv(merged)}\n`, "utf8");
console.log(`Merged ${Object.keys(parseEnv(readFileSync(ragPath, "utf8"))).length} keys from bff-rag.env into server/.env`);
