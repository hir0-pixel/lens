import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = resolve(root, ".local/rag-stack/runtime.env");

for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq < 0) continue;
  let value = trimmed.slice(eq + 1);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).replace(/\\n/g, "\n");
  }
  process.env[trimmed.slice(0, eq)] = value;
}

try {
  const { main } = await import("../../runtime-adapter-sidecar/src/main.ts");
  const running = await main();
  console.log("runtime ok on port", running.port);
} catch (error) {
  console.error("runtime failed:", error);
  process.exit(1);
}
