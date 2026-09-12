import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentHarness, JsonlSessionRepo, NodeExecutionEnv, TODO_CONTEXT } from "@earendil-works/pi-agent-core/node";
import { createModels } from "@earendil-works/pi-ai";
import { PolicyDecisionPoint, type FactReaders } from "../../services/pdp/PolicyDecisionPoint";
import type { CredentialBroker, Sandbox } from "../../services/tool-execution/ToolExecutionService";
import { parseMcpToolAction } from "../../services/mcp-registry/McpRegistry";
import { computeSchemaDigest } from "../../services/mcp-registry/schemaDigest";
import { bindContextAuthorization } from "../../services/agent-integration/contextBinding";
import { bindToolGovernance } from "../../services/agent-integration/governanceBinding";
import { createLensAgentProvider } from "../../services/agent-integration/modelTransport";
import { createMcpTool, resolveMcpToolIntent, type McpToolDescriptor } from "../../services/agent-integration/mcpTool";
import { withMcpToolResourceFacts } from "../../orchestrator-service/src/agentPdpReplica";

const WEATHER_SCHEMA = { type: "object", properties: { city: { type: "string" } }, additionalProperties: false };
const TICKET_SCHEMA = { type: "object", properties: { ticketId: { type: "string" } }, additionalProperties: false };

function stubSandbox(handler: (toolId: string, args: Record<string, unknown> | undefined) => { content: string; resourceRefs: readonly string[] }): Sandbox {
  return {
    async dispatch(input) {
      const toolId = parseMcpToolAction(input.action);
      return { status: "succeeded", result: handler(toolId, input.arguments) };
    },
  };
}
const stubBroker: CredentialBroker = { async issue() { return { credentialRef: "cred-evidence" }; } };

async function runScenario(options: {
  label: string;
  descriptor: McpToolDescriptor;
  toolCalls: { id: string; args: Record<string, unknown> }[];
  sandbox: Sandbox;
  factReaders: FactReaders;
}) {
  const root = mkdtempSync(join(tmpdir(), "lens-m6b-evidence-"));
  const env = new NodeExecutionEnv({ cwd: root });
  const repo = new JsonlSessionRepo({ fileSystem: env, sessionsRoot: join(root, "sessions") });
  const session = await repo.create({ id: options.label, cwd: root }, TODO_CONTEXT);
  const payloads: unknown[] = [];
  let generation = 0;
  const transport = createLensAgentProvider({
    selection: { modelRef: "model" },
    environment: {},
    prepareDispatch: () => ({
      requestId: "request", turnId: "turn", stepId: "step", stepClass: "tool", requestDigest: "digest",
      capability: "chat", artifactDigest: `sha256:${"a".repeat(64)}`, denyEpoch: 1,
      workflowReservationRef: "budget", deadlineAt: Date.now() + 30_000, scopeId: "scope",
      authority: { generationDecision: "generation", modelUseDecision: "model", costConsumption: "cost", agentStep: "step" },
    }),
    gateway: {
      async generateChat(input) {
        payloads.push(input);
        generation += 1;
        if (generation === 1) {
          return {
            deltas: options.toolCalls.map((call, index) => ({
              type: "tool-call" as const, index, id: call.id, name: options.descriptor.toolId, argumentsDelta: JSON.stringify(call.args),
            })),
            receipt: { measuredUnits: 1 } as never,
          };
        }
        const toolText = input.messages.filter((m: { role: string }) => m.role === "tool").map((m: { content: string }) => m.content).join("\n");
        return { deltas: [{ type: "text" as const, text: toolText || "done" }], receipt: { measuredUnits: 1 } as never };
      },
    },
  });
  const models = createModels();
  models.setProvider(transport.provider);
  const tool = createMcpTool(options.descriptor, { broker: stubBroker, sandbox: options.sandbox, scope: { requestId: "request", subjectRef: "employee-evidence" } });
  const { harness } = await AgentHarness.create({ session, models, model: transport.model, tools: [tool], systemPrompt: "evidence" }, TODO_CONTEXT);
  transport.bind(harness);
  const pdp = new PolicyDecisionPoint(options.factReaders, { admitDecision: () => ({ receiptDigest: "receipt" }) }, {
    sign: (fence) => `signed:${fence.fenceId}`,
    verify: (fence) => fence.signature === `signed:${fence.fenceId}`,
  });
  pdp.activate(
    { revision: 1, digest: "sha256:policy-evidence", signed: true, evaluate: () => true },
    { independent: true, auditAdmitted: true, compatibilityPassed: true },
  );
  const scope = { requestId: "request", callerWorkloadRef: "evidence", subjectRef: "employee-evidence", deviceRef: "device-evidence", deadlineAt: Date.now() + 30_000 };
  bindToolGovernance(harness, {
    pdp,
    scope,
    resolveIntent: () => resolveMcpToolIntent(options.descriptor),
    log: { emit: () => {} },
    recordOutcome: () => {},
  });
  bindContextAuthorization(harness, { pdp, scope, log: { emit: () => {} } });

  try {
    const lane = await harness.lane("main", TODO_CONTEXT);
    await lane.prompt("Run the tool", [], TODO_CONTEXT);
  } finally {
    await harness.close(TODO_CONTEXT);
    await repo.close(TODO_CONTEXT);
    rmSync(root, { recursive: true, force: true });
  }
  console.log(`=== ${options.label}: final model payload ===`);
  console.log(JSON.stringify(payloads.at(-1), null, 2));
  console.log("");
}

async function main() {
  console.log("=== EVIDENCE 1: tool-gated allowed case ===");
  const weatherDescriptor: McpToolDescriptor = {
    toolId: "get_weather", version: "1", serverId: "server-1", inputSchema: WEATHER_SCHEMA,
    schemaDigest: computeSchemaDigest(WEATHER_SCHEMA), resultAuthorization: "tool-gated", risk: "read",
  };
  const grantedFactReaders: FactReaders = withMcpToolResourceFacts(
    { subject: () => ({ revision: 1, active: true, groups: [] }), device: () => ({ revision: 1, compliant: true }), resources: () => [] },
    () => true,
  );
  await runScenario({
    label: "tool-gated allowed",
    descriptor: weatherDescriptor,
    toolCalls: [{ id: "call-weather", args: { city: "NYC" } }],
    sandbox: stubSandbox(() => ({ content: "sunny in NYC, 72F", resourceRefs: [] })),
    factReaders: grantedFactReaders,
  });

  console.log("=== EVIDENCE 2: resource-gated mixed entitlement case ===");
  const ticketDescriptor: McpToolDescriptor = {
    toolId: "lookup_ticket", version: "1", serverId: "server-1", inputSchema: TICKET_SCHEMA,
    schemaDigest: computeSchemaDigest(TICKET_SCHEMA), resultAuthorization: "resource-gated",
    declaredResourceRefs: ["crm-corpus"], risk: "read",
  };
  const mixedFactReaders: FactReaders = {
    subject: () => ({ revision: 1, active: true, groups: [] }),
    device: () => ({ revision: 1, compliant: true }),
    resources: (refs) => refs.map((resourceRef) => ({
      resourceRef, revision: 1, published: true, integrityValid: true, aclAllows: resourceRef !== "doc:ticket-denied",
    })),
  };
  await runScenario({
    label: "resource-gated mixed",
    descriptor: ticketDescriptor,
    toolCalls: [
      { id: "call-allowed", args: { ticketId: "TCK-1" } },
      { id: "call-denied", args: { ticketId: "TCK-2" } },
    ],
    sandbox: stubSandbox((_toolId, args) => (args?.ticketId === "TCK-1"
      ? { content: "ticket TCK-1 allowed content", resourceRefs: ["doc:ticket-allowed"] }
      : { content: "ticket TCK-2 denied content", resourceRefs: ["doc:ticket-denied"] })),
    factReaders: mixedFactReaders,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
