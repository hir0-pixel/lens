/** @vitest-environment node */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentAuthorityHttpClient } from "../../services/agent-authority/AgentAuthorityHttpClient";
import { HttpFenceLedger } from "../../services/pdp/FenceLedger";
import { PolicyDecisionPoint, PdpError } from "../../services/pdp/PolicyDecisionPoint";
import { EncryptedSqliteSecretStore } from "../../services/secrets/SecretStore";
import { McpCredentialBroker } from "../../services/mcp-registry/McpCredentialBroker";
import { RemoteMcpSecretResolver } from "../../services/mcp-registry/McpSecretResolver";
import { SqliteMcpRegistry, mcpServerTargetRef, mcpToolAction } from "../../services/mcp-registry/McpRegistry";
import { McpAdminService } from "../../services/mcp-registry/adminService";
import { assertAgentEnvironment } from "../../services/agent-integration/modelTransport";
import { loadAgentAuthorityClient, loadMcpTools, type OrchestratorServiceEnv } from "../../orchestrator-service/src/main";
import { main } from "../src/main";
import { spawnAgentAuthority } from "./spawnAgentAuthority";

const TOKEN = "a".repeat(40);
const SECRET_VALUE = "s3cr3t-mcp-credential-do-not-leak";
const roots: string[] = [];
const servers: Array<{ close: () => Promise<void> }> = [];
const subprocesses: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (subprocesses.length > 0) await subprocesses.pop()!.close();
  while (servers.length > 0) await servers.pop()!.close();
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function startAgentAuthority() {
  const root = tempRoot("agent-authority-");
  const dbPath = join(root, "authority.db");
  const secretPath = join(root, "secrets.db");
  const secretKey = createHash("sha256").update("broker-test-secret-key").digest("hex");
  const secrets = new EncryptedSqliteSecretStore(secretPath, secretKey);
  const running = await main({
    PORT: "0",
    HOST: "127.0.0.1",
    AGENT_AUTHORITY_WORKLOAD_TOKEN: TOKEN,
    AGENT_AUTHORITY_DB_PATH: dbPath,
    MCP_SECRET_STORE_PATH: secretPath,
    MCP_SECRET_STORE_KEY: secretKey,
  });
  servers.push(running);
  const client = new AgentAuthorityHttpClient(running.url, TOKEN);
  return { client, secrets, root, port: running.port, dbPath, secretPath, secretKey };
}

describe("Agent authority broker holds", () => {
  it("broker.fence-consume-atomic-across-replicas", async () => {
    const root = tempRoot("agent-authority-subprocess-");
    const dbPath = join(root, "authority.db");
    const secretPath = join(root, "secrets.db");
    const secretKey = createHash("sha256").update("broker-test-secret-key").digest("hex");
    const spawned = await spawnAgentAuthority({ dbPath, secretPath, secretKey, token: TOKEN });
    subprocesses.push(spawned);
    const { client } = spawned;
    const ledgerA = new HttpFenceLedger(client);
    const ledgerB = new HttpFenceLedger(client);
    const signer = {
      sign: () => "signed-fence",
      verify: (fence: { signature: string }) => fence.signature === "signed-fence",
    };
    const createPdp = (ledger: HttpFenceLedger) => new PolicyDecisionPoint(
      {
        subject: () => ({ revision: 3, active: true, groups: ["staff"] }),
        device: () => ({ revision: 5, compliant: true }),
        resources: (refs) => refs.map((resourceRef, index) => ({
          resourceRef,
          revision: index + 1,
          published: true,
          integrityValid: true,
          aclAllows: true,
        })),
      },
      { admitDecision: () => ({ receiptDigest: "audit" }) },
      signer,
      () => 1_000,
      undefined,
      ledger,
    );
    const pdpA = createPdp(ledgerA);
    const pdpB = createPdp(ledgerB);
    pdpA.activate({ revision: 1, digest: "sha256:policy", signed: true, evaluate: () => true }, { independent: true, auditAdmitted: true, compatibilityPassed: true });
    pdpB.activate({ revision: 1, digest: "sha256:policy", signed: true, evaluate: () => true }, { independent: true, auditAdmitted: true, compatibilityPassed: true });
    const request = {
      requestId: "r1",
      callerWorkloadRef: "retrieval",
      subjectRef: "s",
      deviceRef: "d",
      action: "document.read",
      resourceRefs: ["allowed"],
      normalizedContextDigest: "sha256:context",
      deadlineAt: 2_000,
    };
    const consumption = {
      requestId: "r1",
      callerWorkloadRef: "retrieval",
      action: "document.read",
      useBoundary: "operation" as const,
      normalizedContextDigest: "sha256:context",
      resourceRefs: ["allowed"],
    };
    const decision = pdpA.decideBatch(request);
    pdpA.consumeFence(decision.fence!, consumption);
    expect(() => pdpB.consumeFence(decision.fence!, consumption)).toThrow(PdpError);
    expect(ledgerB.consume(decision.fence!.fenceId)).toBe(false);
  }, 30_000);

  it("broker.credential-requires-live-fence", async () => {
    const { client, secrets } = await startAgentAuthority();
    const registry = new SqliteMcpRegistry(":memory:");
    const admin = new McpAdminService(registry, secrets, fetch);
    const { id: serverId } = await admin.registerServer({ endpoint: "http://127.0.0.1:1/", transport: "http", secret: SECRET_VALUE });
    const broker = new McpCredentialBroker(registry, new RemoteMcpSecretResolver(client));
    const targetRef = mcpServerTargetRef(serverId);
    const { credentialRef } = await broker.issue({
      subjectRef: "employee-1",
      targetRef,
      action: mcpToolAction("echo"),
      executionFence: "mcp-fence:req-1:tool-1",
    });
    await expect(client.resolveMcpCredential(credentialRef, "mcp-fence:req-1:tool-1")).resolves.toBe(SECRET_VALUE);
    await expect(client.resolveMcpCredential(credentialRef, "mcp-fence:req-1:tool-1")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const server = await registry.getServer(serverId);
    await client.issueMcpCredential({
      credentialRef: "mcpcred_expired",
      executionFence: "mcp-fence:req-expired:tool-1",
      secretRef: server!.secretRef,
      targetRef,
      expiresAt: Date.now() - 1,
    });
    await expect(client.resolveMcpCredential("mcpcred_expired", "mcp-fence:req-expired:tool-1")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { credentialRef: firstSharedRef } = await broker.issue({
      subjectRef: "employee-1",
      targetRef,
      action: mcpToolAction("echo"),
      executionFence: "mcp-fence:req-shared:tool-1",
    });
    const { credentialRef: secondSharedRef } = await broker.issue({
      subjectRef: "employee-1",
      targetRef,
      action: mcpToolAction("echo"),
      executionFence: "mcp-fence:req-shared:tool-1",
    });
    await expect(client.resolveMcpCredential(firstSharedRef, "mcp-fence:req-shared:tool-1")).resolves.toBe(SECRET_VALUE);
    await expect(client.resolveMcpCredential(secondSharedRef, "mcp-fence:req-shared:tool-1")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("broker.orchestrator-env-has-no-secret-key", () => {
    expect(() => assertAgentEnvironment({ LENS_MCP_SECRET_STORE_KEY: "k".repeat(32) })).toThrow(/credentials/);
    const productionEnv: NodeJS.ProcessEnv = {
      LENS_ORCHESTRATOR_WORKLOAD_TOKEN: "o".repeat(40),
      LENS_AGENT_AUTHORITY_URL: "http://127.0.0.1:8794/",
      LENS_AGENT_AUTHORITY_WORKLOAD_TOKEN: TOKEN,
    };
    expect(() => assertAgentEnvironment(productionEnv)).not.toThrow();
  });

  it("broker.orchestrator-holds-refs-only", async () => {
    const { client, secrets } = await startAgentAuthority();
    const registry = new SqliteMcpRegistry(":memory:");
    const admin = new McpAdminService(registry, secrets, fetch);
    const { id: serverId } = await admin.registerServer({ endpoint: "http://127.0.0.1:1/", transport: "http", secret: SECRET_VALUE });
    const broker = new McpCredentialBroker(registry, new RemoteMcpSecretResolver(client));
    const { credentialRef } = await broker.issue({
      subjectRef: "employee-1",
      targetRef: mcpServerTargetRef(serverId),
      action: mcpToolAction("echo"),
      executionFence: "mcp-fence:req-refs:tool-1",
    });
    expect(credentialRef.startsWith("mcpcred_")).toBe(true);
    expect(JSON.stringify(process.env)).not.toContain(SECRET_VALUE);
    const originalFetch = globalThis.fetch;
    const bodies: string[] = [];
    globalThis.fetch = (async (input, init) => {
      if (typeof init?.body === "string") bodies.push(init.body);
      return originalFetch(input, init);
    }) as typeof fetch;
    try {
      await broker.resolve(credentialRef, "mcp-fence:req-refs:tool-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(bodies.every((body) => !body.includes(SECRET_VALUE))).toBe(true);
  });

  it("broker.production-requires-service", async () => {
    const env = {
      ORCHESTRATOR_AUTHORITY_PROFILE: "production",
    } as OrchestratorServiceEnv;
    expect(() => loadAgentAuthorityClient(env, "production")).toThrow(/LENS_AGENT_AUTHORITY_URL/);
    await expect(loadMcpTools({
      ...env,
      MCP_REGISTRY_PATH: "/tmp/registry.sqlite",
    })).rejects.toThrow(/LENS_AGENT_AUTHORITY_URL/);
  });
});
