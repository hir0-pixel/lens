import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentHarness,
  JsonlSessionRepo,
  NodeExecutionEnv,
  TODO_CONTEXT,
} from "@earendil-works/pi-agent-core/node";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  bindToolGovernance,
  createEchoTool,
  type ToolGovernanceLogEvent,
} from "../../services/agent-integration/governanceBinding";
import { PolicyDecisionPoint } from "../../services/pdp/PolicyDecisionPoint";

const mode = process.argv[2];
if (mode !== "healthy" && mode !== "throwing") {
  throw new Error("Usage: npm run evidence:m1-governance -- healthy|throwing");
}

const now = 1_000;
const readers = mode === "throwing"
  ? {
      subject: () => { throw new Error("authority unavailable"); },
      device: () => ({ revision: 1, compliant: true }),
      resources: () => [],
    }
  : {
      subject: () => ({ revision: 1, active: true, groups: [] }),
      device: () => ({ revision: 1, compliant: true }),
      resources: (refs: readonly string[]) => refs.map((resourceRef) => ({
        resourceRef,
        revision: 1,
        published: true,
        integrityValid: true,
        aclAllows: true,
      })),
    };
const pdp = new PolicyDecisionPoint(
  readers,
  { admitDecision: () => ({ receiptDigest: "audit-1" }) },
  { sign: () => "signed", verify: (fence) => fence.signature === "signed" },
  () => now,
  () => "manual-fence-1",
);
pdp.activate(
  { revision: 1, digest: "sha256:policy", signed: true, evaluate: () => true },
  { independent: true, auditAdmitted: true, compatibilityPassed: true },
);

const root = mkdtempSync(join(tmpdir(), "lens-m01-evidence-"));
const env = new NodeExecutionEnv({ cwd: root });
const repo = new JsonlSessionRepo({ fileSystem: env, sessionsRoot: join(root, "sessions") });
const session = await repo.create({ id: `m01-${mode}`, cwd: root }, TODO_CONTEXT);
const faux = fauxProvider({ provider: `lens-m01-evidence-${mode}`, models: [{ id: "model" }] });
const models = createModels();
models.setProvider(faux.provider);
faux.setResponses([
  fauxAssistantMessage(
    fauxToolCall("echo", { resourceRef: "manual-resource", value: "hello" }, { id: "call-1" }),
    { stopReason: "toolUse" },
  ),
  fauxAssistantMessage("done"),
]);

let executions = 0;
const { harness } = await AgentHarness.create({
  session,
  models,
  model: faux.getModel(),
  tools: [createEchoTool(() => { executions += 1; })],
  systemPrompt: "M1 governance evidence",
}, TODO_CONTEXT);

const print = (event: ToolGovernanceLogEvent) => {
  const detail = event.event === "tool_blocked" ? event.reason : event.toolName;
  console.log(
    `${event.event.padEnd(20)} ${detail} runId=${event.runId} toolCallId=${event.toolCallId} toolName=${event.toolName}`,
  );
};

bindToolGovernance(harness, {
  pdp,
  scope: {
    requestId: "manual-request",
    callerWorkloadRef: "prime-agent",
    subjectRef: "manual-subject",
    deviceRef: "manual-device",
    deadlineAt: 2_000,
  },
  resolveIntent: (event) => ({
    action: `agent.tool.${event.toolName}`,
    resourceRefs: [String(event.args.resourceRef)],
  }),
  log: { emit: print },
  recordOutcome: () => undefined,
  now: () => now,
});

try {
  const lane = await harness.lane("main", TODO_CONTEXT);
  await lane.prompt("run echo", [], TODO_CONTEXT);
  const expectedExecutions = mode === "healthy" ? 1 : 0;
  if (executions !== expectedExecutions) {
    throw new Error(`Expected ${expectedExecutions} tool executions, received ${executions}`);
  }
} finally {
  await harness.close(TODO_CONTEXT);
  await repo.close(TODO_CONTEXT);
  rmSync(root, { recursive: true, force: true });
}
