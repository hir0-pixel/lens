import { spawn, execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../../", import.meta.url);
const rootPath = fileURLToPath(root);
const nodeBinary = process.execPath;
// A cold Vite start can take more than 90 seconds on Windows while esbuild
// scans this large workspace. Tauri only starts after this command succeeds,
// so leave enough headroom for a cold cache instead of aborting just before
// the frontend is ready. It remains configurable for constrained environments.
const READINESS_TIMEOUT_MS = Number(process.env.LENS_DEV_READY_TIMEOUT_MS ?? 180_000);
const POLL_INTERVAL_MS = 250;

export function serviceDefinitions(env = process.env) {
  // Prefer 127.0.0.1 over localhost so Windows IPv4 clients (Tauri) and the
  // Vite bind address stay on the same family.
  const frontendUrl = env.LENS_APP_ORIGIN ?? "http://127.0.0.1:1420";
  const bffUrl = env.LENS_BFF_ORIGIN ?? "http://127.0.0.1:3001";
  const idpUrl = env.LENS_DEV_IDP_ISSUER ?? "http://127.0.0.1:3005";
  return [
    {
      name: "frontend",
      // Spawn Vite via node directly. Nested `npm.cmd` under Tauri's
      // beforeDevCommand often hangs on Windows with zero output.
      command: nodeBinary,
      args: [path.join(rootPath, "node_modules", "vite", "bin", "vite.js")],
      cwd: rootPath,
      url: `${frontendUrl.replace(/\/$/, "")}/`,
      validate: (response, body) => response.ok && /<title>\s*Lens\s*<\/title>/i.test(body),
    },
    {
      name: "bff",
      command: nodeBinary,
      args: ["./scripts/tsx-dev.mjs", "watch", "src/index.ts"],
      cwd: path.join(rootPath, "server"),
      url: `${bffUrl.replace(/\/$/, "")}/health`,
      // Keep the BFF and bundled local IdP configured as one development
      // stack. This avoids a healthy-but-unconfigured BFF returning 503 from
      // /auth/login when a developer has not created server/.env OIDC values.
      env: {
        APP_ORIGIN: frontendUrl,
        OIDC_ISSUER: idpUrl,
        OIDC_CLIENT_ID: "lens-bff",
        OIDC_CLIENT_SECRET: "dev-client-secret",
        // Callback through the Vite origin so the OIDC binding + session cookies
        // stay on the same host:port as the app (WebView2 / browser). Hitting
        // :3001 directly after IdP breaks the binding cookie and bounces to
        // /?auth=error → Sign In again.
        OIDC_REDIRECT_URI: `${frontendUrl.replace(/\/$/, "")}/auth/callback`,
        OIDC_REQUIRE_HTTPS_ISSUER: "false",
        // WebView2 drops the binding cookie across the IdP port hop; seal with
        // a fixed secret instead so callback can open the pending state.
        OIDC_FIXED_BROWSER_BINDING: "lens-desktop-dev-oidc-browser-binding-v1",
      },
      validate: (response, body) => {
        if (!response.ok) return false;
        try { return JSON.parse(body)?.ok === true; } catch { return false; }
      },
    },
    {
      name: "identity",
      command: nodeBinary,
      args: ["server.mjs"],
      cwd: path.join(rootPath, "dev-idp"),
      url: `${idpUrl.replace(/\/$/, "")}/.well-known/openid-configuration`,
      env: {
        LENS_APP_ORIGIN: frontendUrl,
        LENS_BFF_ORIGIN: bffUrl,
        LENS_DEV_IDP_ISSUER: idpUrl,
        LENS_DEV_IDP_HOST: "127.0.0.1",
      },
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
  // Do not inherit stdio under Tauri's beforeDevCommand: Vite can fill the
  // captured pipe before it binds :1420, Tauri blocks waiting on the URL, and
  // the frontend never becomes ready. Drain pipes ourselves instead.
  const child = spawn(service.command ?? nodeBinary, service.args, {
    cwd: service.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, ...service.env },
  });
  const forward = (stream, write) => {
    stream?.on("data", (chunk) => {
      write(`[${service.name}] ${chunk}`);
    });
  };
  forward(child.stdout, (text) => process.stdout.write(text));
  forward(child.stderr, (text) => process.stderr.write(text));
  return child;
}

/** Kill the process tree on Windows so node grandchildren do not orphan ports. */
function killChildTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {
      try { child.kill(); } catch { /* already gone */ }
    });
    return;
  }
  if (!child.killed) child.kill();
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

  function trackChild(service, child) {
    started.push(child);
    childByService.set(service.name, child);
    exits.set(child, null);
    child.on("exit", (code, signal) => exits.set(child, { code, signal }));
    console.log(`[desktop-stack] started ${service.name}`);
  }

  async function ensureService({ service, probe }) {
    if (probe.state === "healthy") {
      console.log(`[desktop-stack] reusing healthy ${service.name}`);
      return;
    }
    const child = startChild(service);
    trackChild(service, child);
    await waitForService(service, {
      isChildExited: () => exits.get(child) !== null,
    });
    console.log(`[desktop-stack] ${service.name} ready`);
  }

  async function stopStarted() {
    if (stopping) return;
    stopping = true;
    for (const child of started) killChildTree(child);
  }

  try {
    // Bring identity + BFF up before the frontend. Tauri starts `cargo` as soon
    // as the Vite URL responds; on Windows that compile starves the IdP and
    // /auth/login returns 503 until discovery works — Sign In then appears dead.
    const byName = Object.fromEntries(probes.map((entry) => [entry.service.name, entry]));
    await ensureService(byName.identity);
    await ensureService(byName.bff);
    await ensureService(byName.frontend);

    // Keep the coordinator alive even when every dependency was already healthy.
    // Signal listeners and an unresolved Promise alone do not retain Node's event
    // loop, which previously let Tauri launch against a frontend that disappeared.
    // If identity dies under Windows process-tree churn, restart it instead of
    // tearing down Vite/BFF (that made Sign In look permanently broken).
    const keepAlive = setInterval(() => undefined, 60_000);
    await new Promise((resolve, reject) => {
      process.once("SIGINT", () => { void stopStarted().finally(resolve); });
      process.once("SIGTERM", () => { void stopStarted().finally(resolve); });

      const watchChild = (serviceName, child) => {
        const onExit = (code, signal) => {
          if (stopping) return;
          if (serviceName === "identity" || serviceName === "bff" || serviceName === "frontend") {
            console.error(`[desktop-stack] ${serviceName} exited (${signal ?? code ?? "unknown"}); restarting`);
            const service = byName[serviceName].service;
            const next = startChild(service);
            const idx = started.indexOf(child);
            if (idx >= 0) started.splice(idx, 1);
            trackChild(service, next);
            waitForService(service, {
              isChildExited: () => exits.get(next) !== null,
            }).then(() => {
              console.log(`[desktop-stack] ${serviceName} ready`);
              watchChild(serviceName, next);
            }).catch((error) => {
              if (!stopping) reject(error);
            });
            return;
          }
          reject(new Error(`${serviceName} exited after startup (${signal ?? code ?? "unknown"})`));
        };
        const prior = exits.get(child);
        if (prior) onExit(prior.code, prior.signal);
        else child.once("exit", onExit);
      };

      for (const [serviceName, child] of childByService) {
        watchChild(serviceName, child);
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
