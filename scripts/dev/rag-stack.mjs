/**
 * Starts the local governed-RAG backend (authority, runtime, orchestrator).
 * Retrieval for the document corpus is served by the BFF (RETRIEVAL_HTTP_PORT).
 */
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { probeService, waitForService } from "./desktop-stack.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const stackDir = resolve(root, ".local/rag-stack");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function loadDotEnv(path) {
  if (!existsSync(path)) throw new Error(`Missing ${path}. Run: npm run rag:setup`);
  const env = { ...process.env };
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq);
    let value = trimmed.slice(eq + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\n/g, "\n");
    }
    env[key] = value;
  }
  return env;
}

function startChild(name, args, cwd, env) {
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : npm;
  const spawnArgs = process.platform === "win32" ? ["/d", "/s", "/c", npm, ...args] : args;
  const child = spawn(command, spawnArgs, {
    cwd,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  child.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`${name} exited with code ${code}${signal ? ` (${signal})` : ""}`);
      process.exit(code ?? 1);
    }
  });
  return child;
}

const bffProbe = await probeService({
  name: "bff",
  url: "http://127.0.0.1:3001/health",
  validate: (response, body) => {
    if (!response.ok) return false;
    try { return JSON.parse(body)?.ok === true; } catch { return false; }
  },
});
if (bffProbe.state !== "healthy") {
  console.error("BFF is not healthy on http://127.0.0.1:3001 — merge .local/rag-stack/bff-rag.env into server/.env and restart the BFF");
  process.exit(1);
}

const retrievalProbe = await probeService({
  name: "bff-retrieval",
  url: "http://127.0.0.1:8788/readyz",
  validate: (response) => response.ok,
});
if (retrievalProbe.state !== "healthy") {
  console.error("BFF retrieval is not ready on http://127.0.0.1:8788/readyz — set INGESTION_ENABLED and RETRIEVAL_HTTP_PORT=8788, then restart the BFF");
  process.exit(1);
}
console.log("BFF retrieval (ingestion corpus) ready on :8788");

const services = [
  {
    name: "authority",
    args: ["exec", "tsx", "src/main.ts"],
    cwd: resolve(root, "authority-service"),
    envFile: "authority.env",
    url: "http://127.0.0.1:8790/readyz",
    validate: (response) => response.ok,
  },
  {
    name: "runtime",
    args: ["exec", "tsx", "src/main.ts"],
    cwd: resolve(root, "runtime-adapter-sidecar"),
    envFile: "runtime.env",
    url: "http://127.0.0.1:8793/readyz",
    validate: (response) => response.ok,
  },
  {
    name: "orchestrator",
    args: ["exec", "tsx", "src/main.ts"],
    cwd: resolve(root, "orchestrator-service"),
    envFile: "orchestrator.env",
    url: "http://127.0.0.1:8789/readyz",
    validate: (response) => response.ok,
  },
];

const children = [];
for (const service of services) {
  const probe = await probeService({
    name: service.name,
    url: service.url,
    validate: service.validate,
  });
  if (probe.state === "healthy") {
    console.log(`${service.name} already ready`);
    continue;
  }
  const env = loadDotEnv(resolve(stackDir, service.envFile));
  console.log(`Starting ${service.name}…`);
  const child = startChild(service.name, service.args, service.cwd, env);
  children.push(child);
  await waitForService({
    name: service.name,
    url: service.url,
    validate: service.validate,
  }, { timeoutMs: 120_000, isChildExited: () => child.exitCode !== null });
  console.log(`${service.name} ready`);
}

console.log("Local RAG stack is up (authority 8790, BFF retrieval 8788, runtime 8793, orchestrator 8789).");
console.log("Paste docs in Settings → Providers, then Ask in chat. Ctrl+C stops this script.");

function shutdown() {
  for (const child of children) {
    try { child.kill(); } catch { /* ignore */ }
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await new Promise(() => {});
