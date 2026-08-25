import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../../", import.meta.url);
const rootPath = fileURLToPath(root);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
// A cold Vite start can take more than 90 seconds on Windows while esbuild
// scans this large workspace. Tauri only starts after this command succeeds,
// so leave enough headroom for a cold cache instead of aborting just before
// the frontend is ready. It remains configurable for constrained environments.
const READINESS_TIMEOUT_MS = Number(process.env.LENS_DEV_READY_TIMEOUT_MS ?? 180_000);
const POLL_INTERVAL_MS = 250;

export function serviceDefinitions(env = process.env) {
  const frontendUrl = env.LENS_APP_ORIGIN ?? "http://localhost:1420";
  const bffUrl = env.LENS_BFF_ORIGIN ?? "http://localhost:3001";
  const idpUrl = env.LENS_DEV_IDP_ISSUER ?? "http://localhost:3005";
  return [
    {
      name: "frontend", args: ["run", "dev"], cwd: rootPath,
      url: `${frontendUrl.replace(/\/$/, "")}/`,
      validate: (response, body) => response.ok && /<title>\s*Lens\s*<\/title>/i.test(body),
    },
    {
      name: "bff", args: ["run", "dev", "--prefix", "server"], cwd: rootPath,
      url: `${bffUrl.replace(/\/$/, "")}/health`,
      // Keep the BFF and bundled local IdP configured as one development
      // stack. This avoids a healthy-but-unconfigured BFF returning 503 from
      // /auth/login when a developer has not created server/.env OIDC values.
      env: {
        APP_ORIGIN: frontendUrl,
        OIDC_ISSUER: idpUrl,
        OIDC_CLIENT_ID: "lens-bff",
        OIDC_CLIENT_SECRET: "dev-client-secret",
        OIDC_REDIRECT_URI: `${bffUrl.replace(/\/$/, "")}/auth/callback`,
        OIDC_REQUIRE_HTTPS_ISSUER: "false",
      },
      validate: (response, body) => {
        if (!response.ok) return false;
        try { return JSON.parse(body)?.ok === true; } catch { return false; }
      },
    },
    {
      name: "identity", args: ["start", "--prefix", "dev-idp"], cwd: rootPath,
      url: `${idpUrl.replace(/\/$/, "")}/.well-known/openid-configuration`,
      validate: (response, body) => {
        if (!response.ok) return false;
        try { return JSON.parse(body)?.issuer === idpUrl.replace(/\/$/, ""); } catch { return false; }
      },
    },
  ];
}

/** Probe a service, distinguishing an absent port from an occupied wrong service. */
export async function probeService(service, fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_000);
  try {
    const response = await fetcher(service.url, {
      method: "GET", redirect: "manual",
      headers: { accept: "application/json, text/html" }, signal: controller.signal,
    });
    const body = await response.text();
    return service.validate(response, body)
      ? { state: "healthy" }
      : { state: "wrong", detail: `responded with HTTP ${response.status}` };
  } catch (error) {
    const code = error?.code ?? error?.cause?.code;
    if (error?.name === "AbortError" || code === "ECONNREFUSED" || code === "ENOTFOUND") return { state: "absent" };
    return { state: "wrong", detail: error instanceof Error ? error.message : "probe failed" };
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForService(service, {
  timeoutMs = READINESS_TIMEOUT_MS, pollIntervalMs = POLL_INTERVAL_MS,
  fetcher = fetch, isChildExited = () => false,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastProbe = { state: "absent" };
  while (Date.now() < deadline) {
    if (isChildExited()) throw new Error(`${service.name} exited before becoming ready`);
    lastProbe = await probeService(service, fetcher);
    if (lastProbe.state === "healthy") return lastProbe;
    if (lastProbe.state === "wrong") throw new Error(`${service.name} endpoint is occupied by an unexpected service (${lastProbe.detail})`);
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`${service.name} did not become ready within ${timeoutMs}ms (${lastProbe.state})`);
}

function startChild(service) {
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : npm;
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", npm, ...service.args]
    : service.args;
  return spawn(command, args, {
    cwd: service.cwd,
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, ...service.env },
  });
}

async function main() {
  const services = serviceDefinitions();
  const probes = await Promise.all(services.map(async (service) => ({ service, probe: await probeService(service) })));
  const wrong = probes.filter(({ probe }) => probe.state === "wrong");
  if (wrong.length) throw new Error(`Cannot start desktop stack: ${wrong.map(({ service, probe }) => `${service.name} (${probe.detail})`).join(", ")}`);

  const started = [];
  const exits = new Map();
  const childByService = new Map();
  let stopping = false;
  for (const { service, probe } of probes) {
    if (probe.state === "healthy") {
      console.log(`[desktop-stack] reusing healthy ${service.name}`);
      continue;
    }
    const child = startChild(service);
    started.push(child); childByService.set(service.name, child); exits.set(child, null);
    child.on("exit", (code, signal) => exits.set(child, { code, signal }));
    console.log(`[desktop-stack] started ${service.name}`);
  }

  async function stopStarted() {
    if (stopping) return;
    stopping = true;
    for (const child of started) if (child.exitCode === null && !child.killed) child.kill();
  }

  try {
    for (const { service, probe } of probes) {
      if (probe.state === "healthy") continue;
      await waitForService(service, { isChildExited: () => exits.get(childByService.get(service.name)) !== null });
      console.log(`[desktop-stack] ${service.name} ready`);
    }
    // Keep the coordinator alive even when every dependency was already healthy.
    // Signal listeners and an unresolved Promise alone do not retain Node's event
    // loop, which previously let Tauri launch against a frontend that disappeared.
    const keepAlive = setInterval(() => undefined, 60_000);
    await new Promise((resolve, reject) => {
      process.once("SIGINT", () => { void stopStarted().finally(resolve); });
      process.once("SIGTERM", () => { void stopStarted().finally(resolve); });
      for (const [serviceName, child] of childByService) {
        const fail = (code, signal) => {
          if (!stopping) reject(new Error(`${serviceName} exited after startup (${signal ?? code ?? "unknown"})`));
        };
        const prior = exits.get(child);
        if (prior) fail(prior.code, prior.signal);
        else child.once("exit", fail);
      }
    }).finally(() => clearInterval(keepAlive));
  } catch (error) {
    await stopStarted(); throw error;
  } finally { await stopStarted(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[desktop-stack] ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
