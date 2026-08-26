import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const stackDir = resolve(root, ".local/rag-stack");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function loadDotEnv(path) {
  const env = { ...process.env };
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

const service = process.argv[2];
const envFile = process.argv[3];
if (!service || !envFile) {
  console.error("Usage: node start-service-dev.mjs <service-dir> <env-file>");
  process.exit(1);
}

const envPath = resolve(stackDir, envFile);
if (!existsSync(envPath)) throw new Error(`Missing ${envPath}. Run: npm run rag:setup`);

const cwd = resolve(root, service);
const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : npm;
const args = process.platform === "win32" ? ["/d", "/s", "/c", "npx", "tsx", "src/main.ts"] : ["exec", "tsx", "src/main.ts"];
const child = spawn(command, args, {
  cwd,
  env: loadDotEnv(envPath),
  stdio: "inherit",
  windowsHide: true,
});
child.on("exit", (code) => process.exit(code ?? 0));
