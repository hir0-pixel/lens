import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createInternalServiceHttp } from "../../services/internal-http/internalServiceHttp";
import { SqliteFenceLedger } from "../../services/pdp/FenceLedger";
import { EncryptedSqliteSecretStore } from "../../services/secrets/SecretStore";

export class AgentAuthorityError extends Error {
  constructor(readonly code: "FORBIDDEN" | "INVALID") {
    super(code);
  }
}

export interface AgentAuthorityServiceEnv {
  PORT?: string;
  HOST?: string;
  AGENT_AUTHORITY_WORKLOAD_TOKEN: string;
  AGENT_AUTHORITY_DB_PATH?: string;
  MCP_SECRET_STORE_PATH?: string;
  MCP_SECRET_STORE_KEY?: string;
}

function loadEnv(): AgentAuthorityServiceEnv {
  return {
    PORT: process.env.PORT ?? "8794",
    HOST: process.env.HOST ?? "127.0.0.1",
    AGENT_AUTHORITY_WORKLOAD_TOKEN: process.env.LENS_AGENT_AUTHORITY_WORKLOAD_TOKEN ?? "",
    AGENT_AUTHORITY_DB_PATH: process.env.LENS_AGENT_AUTHORITY_DB_PATH,
    MCP_SECRET_STORE_PATH: process.env.LENS_MCP_SECRET_STORE_PATH,
    MCP_SECRET_STORE_KEY: process.env.LENS_MCP_SECRET_STORE_KEY,
  };
}

function createCredentialStore(dbPath: string) {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_credential_issues (
      credential_ref TEXT PRIMARY KEY,
      secret_ref TEXT NOT NULL,
      target_ref TEXT NOT NULL,
      execution_fence TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      issued_at INTEGER NOT NULL
    );
  `);
  return db;
}

export async function main(env: AgentAuthorityServiceEnv = loadEnv()): Promise<{ close: () => Promise<void> }> {
  if (env.AGENT_AUTHORITY_WORKLOAD_TOKEN.length < 32) {
    throw new Error("LENS_AGENT_AUTHORITY_WORKLOAD_TOKEN must contain at least 32 characters.");
  }
  if (!env.AGENT_AUTHORITY_DB_PATH) {
    throw new Error("LENS_AGENT_AUTHORITY_DB_PATH is required for the agent authority fence ledger.");
  }
  if (!env.MCP_SECRET_STORE_PATH || !env.MCP_SECRET_STORE_KEY) {
    throw new Error("LENS_MCP_SECRET_STORE_PATH and LENS_MCP_SECRET_STORE_KEY are required.");
  }

  const fenceLedger = new SqliteFenceLedger(env.AGENT_AUTHORITY_DB_PATH);
  const credentialDb = createCredentialStore(env.AGENT_AUTHORITY_DB_PATH);
  const secrets = new EncryptedSqliteSecretStore(env.MCP_SECRET_STORE_PATH, env.MCP_SECRET_STORE_KEY);
  const now = () => Date.now();

  const http = createInternalServiceHttp({
    workloadToken: env.AGENT_AUTHORITY_WORKLOAD_TOKEN,
    tokenHeader: "x-lens-agent-authority-token",
    routes: {
      "/v1/fences/consume": async (body) => {
        const fenceId = String(body.fence_id ?? "");
        if (!fenceId) throw new AgentAuthorityError("INVALID");
        return { consumed: fenceLedger.consume(fenceId) };
      },
      "/v1/mcp/credentials/issue": async (body) => {
        const credentialRef = String(body.credential_ref ?? "");
        const executionFence = String(body.execution_fence ?? "");
        const secretRef = String(body.secret_ref ?? "");
        const targetRef = String(body.target_ref ?? "");
        const expiresAt = Number(body.expires_at ?? 0);
        if (!credentialRef || !executionFence || !secretRef || !targetRef || !Number.isFinite(expiresAt)) {
          throw new AgentAuthorityError("INVALID");
        }
        try {
          credentialDb.prepare(`
            INSERT INTO mcp_credential_issues (credential_ref, secret_ref, target_ref, execution_fence, expires_at, issued_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(credentialRef, secretRef, targetRef, executionFence, expiresAt, now());
        } catch {
          throw new AgentAuthorityError("FORBIDDEN");
        }
        return { credential_ref: credentialRef };
      },
      "/v1/mcp/credentials/resolve": async (body) => {
        const credentialRef = String(body.credential_ref ?? "");
        const executionFence = String(body.execution_fence ?? "");
        if (!credentialRef || !executionFence) throw new AgentAuthorityError("INVALID");
        const row = credentialDb.prepare(`
          SELECT secret_ref, target_ref, execution_fence, expires_at
          FROM mcp_credential_issues
          WHERE credential_ref = ?
        `).get(credentialRef) as { secret_ref: string; target_ref: string; execution_fence: string; expires_at: number } | undefined;
        if (!row) throw new AgentAuthorityError("FORBIDDEN");
        if (row.execution_fence !== executionFence) throw new AgentAuthorityError("FORBIDDEN");
        if (row.expires_at <= now()) throw new AgentAuthorityError("FORBIDDEN");
        if (!fenceLedger.consume(executionFence)) throw new AgentAuthorityError("FORBIDDEN");
        const deleted = credentialDb.prepare("DELETE FROM mcp_credential_issues WHERE credential_ref = ?").run(credentialRef);
        if (Number(deleted.changes) !== 1) throw new AgentAuthorityError("FORBIDDEN");
        const secret = await secrets.get(row.secret_ref);
        if (!secret) throw new AgentAuthorityError("FORBIDDEN");
        return { secret, target_ref: row.target_ref, credential_ref: credentialRef };
      },
    },
    mapError: (error) => {
      if (error instanceof AgentAuthorityError) {
        return { status: error.code === "FORBIDDEN" ? 403 : 400, body: { error: error.code } };
      }
      return { status: 500, body: { error: "INTERNAL" } };
    },
  });

  http.setReady(true);
  const host = env.HOST ?? "127.0.0.1";
  const requestedPort = Number(env.PORT ?? "8794");
  await http.listen(requestedPort, host);
  const bound = http.server.address();
  const port = typeof bound === "object" && bound ? bound.port : requestedPort;
  return {
    port,
    url: `http://${host}:${port}/`,
    close: async () => {
      await http.close();
      fenceLedger.close();
      credentialDb.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => { process.exitCode = 1; });
}
