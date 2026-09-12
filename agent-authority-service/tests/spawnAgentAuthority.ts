import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentAuthorityHttpClient } from "../../services/agent-authority/AgentAuthorityHttpClient";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVICE_MAIN = join(HERE, "../src/main.ts");

async function getFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not determine free test port.");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForReady(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Agent authority did not become ready at ${url}`);
}

export type SpawnedAgentAuthority = {
  url: string;
  port: number;
  client: AgentAuthorityHttpClient;
  close: () => Promise<void>;
};

/** Separate process so HttpFenceLedger's sync Atomics.wait does not block this process's HTTP server. */
export async function spawnAgentAuthority(env: {
  dbPath: string;
  secretPath: string;
  secretKey: string;
  token?: string;
}): Promise<SpawnedAgentAuthority> {
  const token = env.token ?? "a".repeat(40);
  const port = await getFreePort();
  const child: ChildProcessWithoutNullStreams = spawn("npx", ["tsx", SERVICE_MAIN], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      LENS_AGENT_AUTHORITY_WORKLOAD_TOKEN: token,
      LENS_AGENT_AUTHORITY_DB_PATH: env.dbPath,
      LENS_MCP_SECRET_STORE_PATH: env.secretPath,
      LENS_MCP_SECRET_STORE_KEY: env.secretKey,
    },
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${port}/`;
  try {
    await waitForReady(`${url}readyz`);
  } catch (error) {
    child.kill();
    throw error;
  }
  return {
    url,
    port,
    client: new AgentAuthorityHttpClient(url, token),
    close: async () => {
      child.kill();
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        setTimeout(resolve, 2_000);
      });
    },
  };
}
