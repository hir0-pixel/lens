import { generateKeyPairSync, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main as authorityMain, type AuthorityServiceEnv } from "../../authority-service/src/main";
import { main as sidecarMain, type RuntimeAdapterEnv } from "../../runtime-adapter-sidecar/src/main";
import { createSqlitePgCompatPool } from "../../services/storage/pgPool";

export type LocalServiceHandle = {
  url: string;
  workloadToken: string;
  close(): Promise<void>;
};

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!port) throw new Error("Failed to reserve a local port.");
  return port;
}

function signingPem(): string {
  return generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export async function bootAuthorityServiceLocal(overrides: Partial<AuthorityServiceEnv> = {}): Promise<LocalServiceHandle> {
  const dir = mkdtempSync(join(tmpdir(), "lens-authority-local-"));
  const workloadToken = overrides.AUTHORITY_WORKLOAD_TOKEN ?? randomBytes(32).toString("hex");
  const port = Number(overrides.PORT ?? await reservePort());
  const env: AuthorityServiceEnv = {
    PORT: String(port),
    HOST: "127.0.0.1",
    AUTHORITY_WORKLOAD_TOKEN: workloadToken,
    AUTHORITY_DB_PATH: join(dir, "authority.db"),
    AUTHORITY_STORAGE_PROFILE: "test",
    AUTHORITY_OUTPUT_KEY_HEX: randomBytes(32).toString("hex"),
    AUTHORITY_ALLOW_DEV_FACTS: "true",
    AUTHORITY_DEV_PDP_SIGNING_KEY: randomBytes(32).toString("hex"),
    MODEL_USE_SIGNING_KEY: signingPem(),
    ...overrides,
  };
  try {
    const running = await authorityMain(env);
    return {
      url: `http://127.0.0.1:${port}`,
      workloadToken,
      close: async () => {
        await running.close();
        cleanup(dir);
      },
    };
  } catch (error) {
    cleanup(dir);
    throw error;
  }
}

export async function bootRuntimeSidecarLocal(overrides: Partial<RuntimeAdapterEnv> = {}): Promise<LocalServiceHandle> {
  const dir = mkdtempSync(join(tmpdir(), "lens-runtime-sidecar-local-"));
  const workloadToken = overrides.WORKLOAD_TOKEN ?? randomBytes(32).toString("hex");
  const signingKey = signingPem();
  const env: RuntimeAdapterEnv = {
    PORT: "0",
    HOST: "127.0.0.1",
    WORKLOAD_TOKEN: workloadToken,
    INTERNAL_RUNTIME_URL: "http://127.0.0.1:1",
    INTERNAL_RUNTIME_WORKLOAD_TOKEN: workloadToken,
    SCHEDULER_SIGNING_KEY: signingKey,
    USAGE_SIGNING_KEY: signingKey,
    ATTEMPT_STORE_PROFILE: "test",
    ATTEMPT_STORE_DB_PATH: join(dir, "attempts.db"),
    ...overrides,
  };
  try {
    const running = await sidecarMain(env, { localRuntime: true });
    return {
      url: `http://127.0.0.1:${running.port}`,
      workloadToken,
      close: async () => {
        await running.close();
        const pool = createSqlitePgCompatPool(env.ATTEMPT_STORE_DB_PATH!);
        await pool.close();
        await pool.close();
        cleanup(dir);
      },
    };
  } catch (error) {
    cleanup(dir);
    throw error;
  }
}
