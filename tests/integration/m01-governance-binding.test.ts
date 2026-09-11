import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentHarness,
  JsonlSessionRepo,
  NodeExecutionEnv,
  TODO_CONTEXT,
  type HookHandler,
  type Hooks,
} from "@earendil-works/pi-agent-core/node";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  bindToolGovernance,
  createEchoTool,
  normalizedToolIntentDigest,
  type ToolGovernanceScope,
  type ToolGovernanceLogEvent,
  type ToolOutcome,
  type ToolPolicyPort,
} from "../../services/agent-integration/governanceBinding";
import { PolicyDecisionPoint } from "../../services/pdp/PolicyDecisionPoint";

const scope: ToolGovernanceScope = {
  requestId: "request-1",
  callerWorkloadRef: "prime-agent",
  subjectRef: "subject-1",
  deviceRef: "device-1",
  deadlineAt: 2_000,
};

const resolveIntent = (event: { toolName: string; args: Record<string, unknown> }) => ({
  action: `agent.tool.${event.toolName}`,
  resourceRefs: [String(event.args.resourceRef)],
});

function createPdp(aclAllows = true, now = () => 1_000): PolicyDecisionPoint {
  let fence = 0;
  const pdp = new PolicyDecisionPoint(
    {
      subject: () => ({ revision: 1, active: true, groups: [] }),
      device: () => ({ revision: 1, compliant: true }),
      resources: (refs) => refs.map((resourceRef) => ({
        resourceRef,
        revision: 1,
        published: true,
        integrityValid: true,
        aclAllows,
      })),
    },
    { admitDecision: () => ({ receiptDigest: "audit-1" }) },
    {
      sign: () => "signed",
      verify: (candidate) => candidate.signature === "signed",
    },
    now,
    () => `fence-${++fence}`,
  );
  pdp.activate(
    { revision: 1, digest: "sha256:policy", signed: true, evaluate: () => true },
    { independent: true, auditAdmitted: true, compatibilityPassed: true },
  );
  return pdp;
}

let providerSequence = 0;

async function runEchoCalls(options: {
  pdp: ToolPolicyPort;
  calls?: Array<{ resourceRef: string; value: string }>;
  now?: () => number;
}) {
  const root = mkdtempSync(join(tmpdir(), "lens-m01-"));
  const env = new NodeExecutionEnv({ cwd: root });
  const repo = new JsonlSessionRepo({ fileSystem: env, sessionsRoot: join(root, "sessions") });
  const session = await repo.create({ id: "m01", cwd: root }, TODO_CONTEXT);
  const faux = fauxProvider({
    provider: `lens-m01-${++providerSequence}`,
    models: [{ id: "model" }],
  });
  const models = createModels();
  models.setProvider(faux.provider);
  const calls = options.calls ?? [{ resourceRef: "document-1", value: "hello" }];
  faux.setResponses([
    ...calls.map((args, index) => fauxAssistantMessage(
      fauxToolCall("echo", args, { id: `call-${index + 1}` }),
      { stopReason: "toolUse" },
    )),
    fauxAssistantMessage("done"),
  ]);

  let executions = 0;
  const timeline: string[] = [];
  const logs: ToolGovernanceLogEvent[] = [];
  const outcomes: ToolOutcome[] = [];
  const { harness } = await AgentHarness.create(
    {
      session,
      models,
      model: faux.getModel(),
      tools: [createEchoTool(() => {
        executions += 1;
        timeline.push("execution");
      })],
      systemPrompt: "M01 governance test",
    },
    TODO_CONTEXT,
  );
  bindToolGovernance(harness, {
    pdp: options.pdp,
    scope,
    resolveIntent,
    log: {
      emit(event) {
        logs.push(event);
        timeline.push(event.event);
      },
    },
    recordOutcome: (outcome) => { outcomes.push(outcome); },
    now: options.now ?? (() => 1_000),
  });

  try {
    const lane = await harness.lane("main", TODO_CONTEXT);
    await lane.prompt("run the echo tool", [], TODO_CONTEXT);
    const entries = await session.findEntries(undefined, TODO_CONTEXT);
    return { executions, logs, outcomes, timeline, transcript: JSON.stringify(entries) };
  } finally {
    await harness.close(TODO_CONTEXT);
    await repo.close(TODO_CONTEXT);
    rmSync(root, { recursive: true, force: true });
  }
}

describe("M01 governance binding", () => {
  it("pdp.tool.denied-blocks", async () => {
    const result = await runEchoCalls({ pdp: createPdp(false) });
    expect(result.executions).toBe(0);
    expect(result.transcript).toContain("Not permitted");
  });

  it("pdp.tool.allowed-proceeds", async () => {
    const pdp = createPdp();
    let decisions = 0;
    let consumptions = 0;
    const port: ToolPolicyPort = {
      decideBatch(input) {
        decisions += 1;
        return pdp.decideBatch(input);
      },
      consumeFence(fence, input) {
        pdp.consumeFence(fence, input);
        consumptions += 1;
      },
    };
    const result = await runEchoCalls({ pdp: port });
    expect({ decisions, consumptions, executions: result.executions }).toEqual({
      decisions: 1,
      consumptions: 1,
      executions: 1,
    });
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({ toolName: "echo", isError: false });
  });

  describe("pdp.tool.fail-closed", () => {
    it("blocks a thrown policy exception", async () => {
      const pdp = new PolicyDecisionPoint(
        {
          subject: () => { throw new Error("authority unavailable"); },
          device: () => ({ revision: 1, compliant: true }),
          resources: () => [],
        },
        { admitDecision: () => ({ receiptDigest: "audit-1" }) },
        { sign: () => "signed", verify: () => true },
        () => 1_000,
      );
      pdp.activate(
        { revision: 1, digest: "sha256:policy", signed: true, evaluate: () => true },
        { independent: true, auditAdmitted: true, compatibilityPassed: true },
      );
      const result = await runEchoCalls({
        pdp,
      });
      expect(result.executions).toBe(0);
      expect(result.transcript).toContain("Not permitted");
      expect(result.transcript).not.toContain("authority unavailable");
    });

    it("blocks a decision that exceeds deadlineAt", async () => {
      let now = 1_000;
      let consumptions = 0;
      const pdp = createPdp(true, () => now);
      const result = await runEchoCalls({
        now: () => now,
        pdp: {
          decideBatch(input) {
            const decision = pdp.decideBatch(input);
            now = input.deadlineAt;
            return decision;
          },
          consumeFence(fence, input) {
            consumptions += 1;
            pdp.consumeFence(fence, input);
          },
        },
      });
      expect(result.executions).toBe(0);
      expect(consumptions).toBe(0);
      expect(result.transcript).toContain("Not permitted");
    });
  });

  it("pdp.tool.fence-replay-rejected", async () => {
    const pdp = createPdp();
    const args = { resourceRef: "document-1", value: "hello" };
    const action = "agent.tool.echo";
    const normalizedContextDigest = normalizedToolIntentDigest("echo", args);
    const decision = pdp.decideBatch({
      ...scope,
      action,
      resourceRefs: [args.resourceRef],
      normalizedContextDigest,
      useBoundary: "tool_boundary",
    });
    let consumptionAttempts = 0;
    const result = await runEchoCalls({
      calls: [args, args],
      pdp: {
        decideBatch: () => decision,
        consumeFence(fence, input) {
          consumptionAttempts += 1;
          pdp.consumeFence(fence, input);
        },
      },
    });
    expect(consumptionAttempts).toBe(2);
    expect(result.executions).toBe(1);
    expect(result.transcript).toContain("Not permitted");
  });

  it("pdp.tool.every-call-decided", async () => {
    const pdp = createPdp();
    let decisions = 0;
    let consumptions = 0;
    const result = await runEchoCalls({
      calls: [
        { resourceRef: "document-1", value: "one" },
        { resourceRef: "document-1", value: "two" },
        { resourceRef: "document-1", value: "three" },
      ],
      pdp: {
        decideBatch(input) {
          decisions += 1;
          return pdp.decideBatch(input);
        },
        consumeFence(fence, input) {
          pdp.consumeFence(fence, input);
          consumptions += 1;
        },
      },
    });
    expect(decisions).toBe(3);
    expect(consumptions).toBe(3);
    expect(result.executions).toBe(3);
    expect(result.executions).toBe(consumptions);
  });

  it("pdp.tool.digest-stable", () => {
    const first = normalizedToolIntentDigest("echo", {
      resourceRef: "document-1",
      value: "hello",
    });
    const reordered = normalizedToolIntentDigest("echo", {
      value: "hello",
      resourceRef: "document-1",
    });
    expect(first).toBe(reordered);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(normalizedToolIntentDigest("echo", {
      resourceRef: "document-1",
      value: "changed",
    })).not.toBe(first);
    expect(normalizedToolIntentDigest("different-tool", {
      resourceRef: "document-1",
      value: "hello",
    })).not.toBe(first);
  });

  it("pdp.tool.log-ordering", async () => {
    const allowed = await runEchoCalls({ pdp: createPdp() });
    expect(allowed.logs.map(({ event }) => event)).toEqual([
      "decision_requested",
      "fence_consumed",
      "tool_completed",
    ]);
    expect(allowed.timeline).toEqual([
      "decision_requested",
      "fence_consumed",
      "execution",
      "tool_completed",
    ]);

    const secretResource = "classified-document-8472";
    const blocked = await runEchoCalls({
      pdp: createPdp(false),
      calls: [{ resourceRef: secretResource, value: "secret input" }],
    });
    expect(blocked.logs.map(({ event }) => event)).toEqual([
      "decision_requested",
      "tool_blocked",
    ]);
    expect(blocked.timeline).toEqual(["decision_requested", "tool_blocked"]);
    expect(blocked.executions).toBe(0);
    expect(JSON.stringify(blocked.logs)).not.toContain(secretResource);
    expect(JSON.stringify(blocked.logs)).not.toContain("secret input");
  });

  it("does not disclose unauthorized resource ids in block reasons", async () => {
    const handlers = new Map<string, unknown>();
    const hooks = {
      on(name: string, handler: unknown) {
        handlers.set(name, handler);
        return () => undefined;
      },
    } as unknown as Hooks;
    bindToolGovernance({ hooks }, {
      pdp: createPdp(false),
      scope,
      resolveIntent,
      log: { emit: () => undefined },
      recordOutcome: () => undefined,
      now: () => 1_000,
    });
    const beforeTool = handlers.get("before_tool") as HookHandler<"before_tool">;
    const secretResource = "classified-document-8472";
    const result = await beforeTool({
      runId: "run-1",
      lane: "main",
      toolCallId: "call-1",
      toolName: "echo",
      args: { resourceRef: secretResource, value: "hello" },
    }, TODO_CONTEXT);
    expect(result).toEqual({ block: { reason: "Not permitted" } });
    expect(JSON.stringify(result)).not.toContain(secretResource);
  });
});
