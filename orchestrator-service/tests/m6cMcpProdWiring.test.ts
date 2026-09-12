/** @vitest-environment node */
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CompanyRagProfile } from "../../services/rag-profile/companyRagProfile";
import { AgentRuntime } from "../../services/agent-runtime/AgentRuntime";
import type { AgentRunAuthorityPort } from "../../services/agent-run-authority/AgentRunAuthority";
import type { CostAuthorityPort } from "../../services/cost-authority/CostAuthority";
import type { ModelUseAuthorityPort } from "../../services/pdp/ModelUseAuthority";
import type { FactReaders, PolicyBundle } from "../../services/pdp/PolicyDecisionPoint";
import { searchCorpusCatalogEntry } from "../../services/agent-integration/corpusTool";
import { SqliteMcpRegistry, mcpServerTargetRef, mcpToolAction } from "../../services/mcp-registry/McpRegistry";
import { McpAdminService } from "../../services/mcp-registry/adminService";
import { McpHttpConnector } from "../../services/mcp-registry/McpHttpConnector";
import { EncryptedSqliteSecretStore } from "../../services/secrets/SecretStore";
import { INTERNAL_EGRESS_PROFILE, NO_EGRESS_PROFILE } from "../../tests/helpers/mcpDataFlow";
import { StubMcpServer } from "../../tests/helpers/stubMcpServer";
import { spawnAgentAuthority } from "../../agent-authority-service/tests/spawnAgentAuthority";
import { createProductionAgentHarness } from "../src/agentHarness";
import { createAgentAuditLedger, createAgentPolicyReplica } from "../src/agentPdpReplica";
import { loadMcpTools, main, type OrchestratorServiceEnv } from "../src/main";

const hash = (value: string): `sha256:${string}` => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const assertionKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
const AUTHORITY_TOKEN = "a".repeat(40);

const roots: string[] = [];
const authorityServers: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  while (authorityServers.length > 0) await authorityServers.pop()!.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDbPath(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return join(root, "db.sqlite");
}

async function startTestAgentAuthority(secretPath: string, secretKey: string) {
  const authorityDbPath = tempDbPath("m6c-agent-authority-");
  const spawned = await spawnAgentAuthority({
    dbPath: authorityDbPath,
    secretPath,
    secretKey,
    token: AUTHORITY_TOKEN,
  });
  authorityServers.push(spawned);
  return { url: spawned.url, token: AUTHORITY_TOKEN };
}

const ragProfile: CompanyRagProfile = {
  profileVersion: 1,
  companyId: "acme",
  corpora: ["hr-handbook"],
  connectors: [],
  chunking: { maxTokens: 400, overlapTokens: 40 },
  embeddingAdapterRef: "embed",
  groundingPolicyRef: "signed",
  tools: [],
  retentionDays: 30,
  eligibleModelPatterns: ["*"],
  retrievalProfiles: { default: { corpusRef: "hr-handbook", mode: "semantic" } },
};
const TRIVIAL_POLICY: PolicyBundle = { revision: 1, digest: "sha256:policy-v1", signed: true, evaluate: () => true };

function env(overrides: Partial<OrchestratorServiceEnv> = {}): OrchestratorServiceEnv {
  return {
    ORCHESTRATOR_WORKLOAD_TOKEN: "o".repeat(40),
    RETRIEVAL_URL: "http://127.0.0.1:1/",
    RETRIEVAL_WORKLOAD_TOKEN: "r".repeat(40),
    MODEL_RUNTIME_URL: "http://127.0.0.1:1/",
    MODEL_RUNTIME_WORKLOAD_TOKEN: "m".repeat(40),
    MODEL_ARTIFACT_DIGEST: `sha256:${"a".repeat(64)}`,
    AUTHORITY_URL: "http://127.0.0.1:1/",
    AUTHORITY_WORKLOAD_TOKEN: "a".repeat(40),
    ASSERTION_VERIFY_KEY: assertionKey,
    MEMORY_ASSERTION_VERIFY_KEY: assertionKey,
    ORCHESTRATOR_AUTHORITY_PROFILE: "test",
    CONVERSATION_HISTORY_PROFILE: "test",
    ...overrides,
  };
}

function harnessOptions(mcpTools: Awaited<ReturnType<typeof loadMcpTools>>, runtime: AgentRuntime) {
  const ledger = createAgentAuditLedger();
  const factReaders: FactReaders = {
    subject: () => ({ revision: 1, active: true, groups: [] }),
    device: () => ({ revision: 1, compliant: true }),
    resources: (refs) => refs.map((resourceRef) => ({ resourceRef, revision: 1, published: true, integrityValid: true, aclAllows: true })),
  };
  const replica = createAgentPolicyReplica({
    factReaders,
    policyBundle: TRIVIAL_POLICY,
    signer: { sign: (fence) => `signed:${fence.fenceId}`, verify: (fence) => fence.signature === `signed:${fence.fenceId}` },
    auditLedger: ledger,
  });
  const unused = (name: string) => async () => { throw new Error(`unused: ${name}`); };
  const modelUseAuthority: ModelUseAuthorityPort = { authorizeGenerate: unused("authorizeGenerate"), authorizeModelUse: unused("authorizeModelUse") };
  const costAuthority: CostAuthorityPort = {
    reserveWorkflowBudget: unused("reserveWorkflowBudget"),
    consumeSubEnvelope: unused("consumeSubEnvelope"),
    finalizeSubEnvelope: unused("finalizeSubEnvelope"),
    closeWorkflowBudget: unused("closeWorkflowBudget"),
    getWorkflowBudgetStatus: unused("getWorkflowBudgetStatus"),
  };
  const agentRunAuthority: AgentRunAuthorityPort = {
    beginAgentRun: unused("beginAgentRun"),
    reserveAgentStep: unused("reserveAgentStep"),
    consumeAgentStep: unused("consumeAgentStep"),
    finalizeAgentStep: unused("finalizeAgentStep"),
    closeAgentRun: unused("closeAgentRun"),
    getAgentRunStatus: unused("getAgentRunStatus"),
  };
  return {
    gateway: { generateChat: unused("generateChat") },
    retrieval: { retrieve: unused("retrieve") },
    profile: ragProfile,
    pdp: replica.pdp,
    auditLedger: ledger,
    modelSelection: { resolve: () => ({ artifactDigest: hash("model") }) },
    modelEligibility: {
      resolveEndpoint: async () => ({ endpointRef: "runtime", snapshotExpiresAt: Date.now() + 30_000, external: false }),
      currentDenyEpoch: () => 0,
    },
    modelUseAuthority,
    costAuthority,
    agentRunAuthority,
    environment: {},
    runtime,
    mcpTools,
  } as const;
}

function beginRun(runtime: AgentRuntime) {
  return runtime.begin({
    requestId: "request-1",
    subjectRef: "employee-1",
    deviceRef: "device-1",
    applicationRef: "lens-employee-client",
    envelope: { maxSteps: 4, maxSideEffects: 4, maxCostUnits: 100, deadlineAt: Date.now() + 60_000, workflowProfileDigest: hash("wf"), budgetDecisionRef: "budget-1" },
  });
}

describe("M6c MCP production wiring", () => {
  it("mcp.prod-wiring-exposes-approved-tools", async () => {
    const stub = new StubMcpServer();
    const endpoint = await stub.start();
    try {
      const registryPath = tempDbPath("m6c-registry-");
      const secretPath = tempDbPath("m6c-secrets-");
      const secretKey = "k".repeat(32);
      const authority = await startTestAgentAuthority(secretPath, secretKey);
      const registry = new SqliteMcpRegistry(registryPath);
      const admin = new McpAdminService(registry, new EncryptedSqliteSecretStore(secretPath, secretKey), fetch);
      const { id: serverId } = await admin.registerServer({ endpoint, transport: "http", secret: "s".repeat(20) });
      await admin.discoverTools(serverId);
      await admin.approveTool({ serverId, toolId: "echo", dataFlowProfile: NO_EGRESS_PROFILE, resultAuthorization: "tool-gated" });
      await admin.approveTool({ serverId, toolId: "lookup_ticket", dataFlowProfile: INTERNAL_EGRESS_PROFILE, resultAuthorization: "resource-gated" });
      await registry.setToolState(serverId, "lookup_ticket", "disabled");

      const mcpTools = await loadMcpTools(env({
        MCP_REGISTRY_PATH: registryPath,
        AGENT_AUTHORITY_URL: authority.url,
        AGENT_AUTHORITY_WORKLOAD_TOKEN: authority.token,
      }));
      expect(mcpTools?.descriptors.map((descriptor) => descriptor.toolId)).toEqual(["echo"]);

      const runtime = new AgentRuntime({ authorize: () => true });
      expect(() => createProductionAgentHarness(harnessOptions(mcpTools, runtime))).not.toThrow();
      const run = beginRun(runtime);
      expect(() => runtime.reserveStep({
        runId: run.runId, expectedRevision: run.revision, stepId: "step-echo",
        toolId: "echo", toolVersion: "1", intentDigest: hash("intent-echo"), declaredCostUnits: 1,
      })).not.toThrow();
      expect(() => runtime.reserveStep({
        runId: run.runId, expectedRevision: run.revision, stepId: "step-disabled",
        toolId: "lookup_ticket", toolVersion: "1", intentDigest: hash("intent-disabled"), declaredCostUnits: 1,
      })).toThrow("CATALOG_INVALID");
    } finally {
      await stub.stop();
    }
  });

  it("mcp.prod-wiring-absent-means-no-mcp", async () => {
    const mcpTools = await loadMcpTools(env());
    expect(mcpTools).toBeUndefined();

    const runtime = new AgentRuntime({ authorize: () => true });
    expect(() => createProductionAgentHarness(harnessOptions(mcpTools, runtime))).not.toThrow();
    const run = beginRun(runtime);
    expect(() => runtime.reserveStep({
      runId: run.runId, expectedRevision: run.revision, stepId: "step-search",
      toolId: searchCorpusCatalogEntry.toolId, toolVersion: searchCorpusCatalogEntry.version,
      intentDigest: hash("intent-search"), declaredCostUnits: 1,
    })).not.toThrow();
  });

  it("mcp.prod-wiring-memory-registry-refused-in-production", async () => {
    await expect(main(env({
      ORCHESTRATOR_AUTHORITY_PROFILE: "production",
      MCP_REGISTRY_PATH: ":memory:",
      AGENT_AUTHORITY_URL: "http://127.0.0.1:8794/",
      AGENT_AUTHORITY_WORKLOAD_TOKEN: AUTHORITY_TOKEN,
    }))).rejects.toThrow(/in-memory MCP registry/);
  });

  it("mcp.prod-wiring-uses-factory-connector", async () => {
    const stub = new StubMcpServer();
    const endpoint = await stub.start();
    try {
      const registryPath = tempDbPath("m6c-registry-");
      const secretPath = tempDbPath("m6c-secrets-");
      const secretKey = "k".repeat(32);
      const authority = await startTestAgentAuthority(secretPath, secretKey);
      const registry = new SqliteMcpRegistry(registryPath);
      const admin = new McpAdminService(registry, new EncryptedSqliteSecretStore(secretPath, secretKey), fetch);
      const { id: serverId } = await admin.registerServer({ endpoint, transport: "http", secret: "s".repeat(20) });
      await admin.discoverTools(serverId);
      await admin.approveTool({ serverId, toolId: "echo", dataFlowProfile: NO_EGRESS_PROFILE, resultAuthorization: "tool-gated" });

      const mcpTools = await loadMcpTools(env({
        MCP_REGISTRY_PATH: registryPath,
        AGENT_AUTHORITY_URL: authority.url,
        AGENT_AUTHORITY_WORKLOAD_TOKEN: authority.token,
      }));
      expect(mcpTools?.sandbox).toBeInstanceOf(McpHttpConnector);

      const { credentialRef } = await mcpTools!.broker.issue({
        subjectRef: "employee-1",
        targetRef: mcpServerTargetRef(serverId),
        action: mcpToolAction("echo"),
        executionFence: "mcp-fence:req-1:tool-echo",
      });
      const outcome = await mcpTools!.sandbox.dispatch({
        targetRef: mcpServerTargetRef(serverId),
        action: mcpToolAction("echo"),
        credentialRef,
        executionFence: "mcp-fence:req-1:tool-echo",
        idempotencyKey: "idem-1",
        argumentsDigest: "sha256:deadbeef",
      });
      expect(outcome.status).toBe("succeeded");
      expect(outcome.result?.content).toContain("hello from the stub");
    } finally {
      await stub.stop();
    }
  });
});
