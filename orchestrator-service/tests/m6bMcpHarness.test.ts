import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentHarness, JsonlSessionRepo, NodeExecutionEnv, TODO_CONTEXT } from "@earendil-works/pi-agent-core/node";
import { createModels } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "../../services/agent-runtime/AgentRuntime";
import type { AgentRunAuthorityPort } from "../../services/agent-run-authority/AgentRunAuthority";
import type { CostAuthorityPort } from "../../services/cost-authority/CostAuthority";
import type { ModelUseAuthorityPort } from "../../services/pdp/ModelUseAuthority";
import type { FactReaders, PolicyBundle } from "../../services/pdp/PolicyDecisionPoint";
import type { CredentialBroker, Sandbox } from "../../services/tool-execution/ToolExecutionService";
import { parseMcpToolAction } from "../../services/mcp-registry/McpRegistry";
import { computeSchemaDigest } from "../../services/mcp-registry/schemaDigest";
import { bindContextAuthorization, WITHHELD_TOOL_CONTENT } from "../../services/agent-integration/contextBinding";
import { createLensAgentProvider } from "../../services/agent-integration/modelTransport";
import { createMcpTool, mcpToolResourceRef, type McpToolDescriptor } from "../../services/agent-integration/mcpTool";
import { createProductionAgentHarness, type AgentHarnessRequest } from "../src/agentHarness";
import { createAgentAuditLedger, createAgentPolicyReplica, withMcpToolResourceFacts, type McpToolGrantReader } from "../src/agentPdpReplica";

const roots: string[] = [];
const hash = (value: string): `sha256:${string}` => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const TRIVIAL_POLICY: PolicyBundle = { revision: 1, digest: "sha256:policy-v1", signed: true, evaluate: () => true };
const profile = {
  profileVersion: 1,
  companyId: "company-1",
  corpora: ["company-corpus"],
  connectors: [],
  chunking: { maxTokens: 512, overlapTokens: 32 },
  embeddingAdapterRef: "embedding-1",
  groundingPolicyRef: "grounding-1",
  tools: ["search_corpus"],
  retentionDays: 30,
  eligibleModelPatterns: ["model"],
  retrievalProfiles: { default: { corpusRef: "company-corpus", mode: "hybrid" as const } },
};

const WEATHER_SCHEMA = { type: "object", properties: { city: { type: "string" } }, additionalProperties: false };
const TICKET_SCHEMA = { type: "object", properties: { ticketId: { type: "string" } }, additionalProperties: false };

function weatherDescriptor(overrides: Partial<McpToolDescriptor> = {}): McpToolDescriptor {
  return {
    toolId: "get_weather",
    version: "1",
    serverId: "server-1",
    inputSchema: WEATHER_SCHEMA,
    schemaDigest: computeSchemaDigest(WEATHER_SCHEMA),
    resultAuthorization: "tool-gated",
    risk: "read",
    ...overrides,
  };
}

function ticketDescriptor(overrides: Partial<McpToolDescriptor> = {}): McpToolDescriptor {
  return {
    toolId: "lookup_ticket",
    version: "1",
    serverId: "server-1",
    inputSchema: TICKET_SCHEMA,
    schemaDigest: computeSchemaDigest(TICKET_SCHEMA),
    resultAuthorization: "resource-gated",
    declaredResourceRefs: ["crm-corpus"],
    risk: "read",
    ...overrides,
  };
}

type StubResult = { content: string; resourceRefs: readonly string[] } | "unavailable";

function stubSandbox(handler: (toolId: string, args: Record<string, unknown> | undefined, callIndex: number) => StubResult) {
  const calls: { toolId: string; args?: Record<string, unknown> }[] = [];
  const sandbox: Sandbox = {
    async dispatch(input) {
      const toolId = parseMcpToolAction(input.action);
      calls.push({ toolId, args: input.arguments });
      const outcome = handler(toolId, input.arguments, calls.length - 1);
      if (outcome === "unavailable") throw new Error("MCP server unavailable.");
      return { status: "succeeded", result: outcome };
    },
  };
  return { sandbox, calls };
}

function stubBroker(): CredentialBroker {
  return { async issue() { return { credentialRef: "cred-stub" }; } };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function request(index: number, overrides: Partial<AgentHarnessRequest> = {}): AgentHarnessRequest {
  const subjectRef = overrides.subjectRef ?? `employee-${index}`;
  return {
    requestId: `request-${index}`,
    turnId: `turn-${index}`,
    subjectRef,
    sessionRef: `session-${index}`,
    conversationRef: `conversation-${index}`,
    deviceRef: `device-${index}`,
    applicationId: "lens-employee-client",
    workspaceRef: "workspace:lens",
    purposeRef: "employee-assistance",
    retrievalClass: "enterprise-grounded",
    inputText: "do the task",
    queryDigest: hash("do the task"),
    deadlineAt: Date.now() + 30_000,
    modelRef: "model",
    ...overrides,
  };
}

function authorities() {
  const receipt = (name: string) => ({ token: name, claims: { receiptId: name } }) as never;
  // Keyed by runId: concurrent runs sharing this one authorities() instance (as production
  // sharing a single authority client would) must never see each other's in-flight steps.
  const pendingStepsByRun = new Map<string, Set<string>>();
  const stepsFor = (runId: string) => {
    let steps = pendingStepsByRun.get(runId);
    if (!steps) { steps = new Set<string>(); pendingStepsByRun.set(runId, steps); }
    return steps;
  };
  const modelUseAuthority: ModelUseAuthorityPort = {
    authorizeGenerate: async (input) => receipt(`generation:${input.requestId}`),
    authorizeModelUse: async (input) => receipt(`model:${input.stepId}`),
  };
  const costAuthority: CostAuthorityPort = {
    reserveWorkflowBudget: async (input) => ({ reservationRef: input.reservationRef, revision: 1 }),
    consumeSubEnvelope: async (input) => receipt(`cost:${input.stepId}`),
    finalizeSubEnvelope: async () => {},
    closeWorkflowBudget: async () => {},
    getWorkflowBudgetStatus: async () => { throw new Error("unused"); },
  };
  const agentRunAuthority: AgentRunAuthorityPort = {
    beginAgentRun: async (input) => ({ runId: input.runId, envelopeRevision: 1 }),
    reserveAgentStep: async (input) => { stepsFor(input.runId).add(input.stepId); return receipt(`agent-step:${input.stepId}`); },
    consumeAgentStep: async (runId, stepId) => { if (!stepsFor(runId).has(stepId)) throw new Error("step is not reserved"); },
    finalizeAgentStep: async (runId, stepId) => { if (!stepsFor(runId).delete(stepId)) throw new Error("step is not reserved"); },
    closeAgentRun: async (runId) => { if (stepsFor(runId).size > 0) throw new Error("run has nonterminal steps"); pendingStepsByRun.delete(runId); },
    getAgentRunStatus: async () => { throw new Error("unused"); },
  };
  return { modelUseAuthority, costAuthority, agentRunAuthority };
}

interface ToolCall { name: string; args: Record<string, unknown> }

function fixture(options: {
  mcpDescriptors?: readonly McpToolDescriptor[];
  sandbox?: Sandbox;
  hasGrant?: McpToolGrantReader;
  deniedResources?: readonly string[];
  policyBundle?: PolicyBundle;
  toolCalls?: readonly ToolCall[];
  includeSearchCorpus?: boolean;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "lens-m6b-"));
  roots.push(root);
  const ledger = createAgentAuditLedger();
  const audit = vi.spyOn(ledger, "appendIntent");
  let retrievalCalls = 0;
  const baseFactReaders: FactReaders = {
    subject: () => ({ revision: 1, active: true, groups: [] }),
    device: () => ({ revision: 1, compliant: true }),
    resources: (refs) => refs.map((resourceRef) => ({
      resourceRef,
      revision: 1,
      published: true,
      integrityValid: true,
      aclAllows: !options.deniedResources?.includes(resourceRef),
    })),
  };
  const factReaders = withMcpToolResourceFacts(baseFactReaders, options.hasGrant ?? (() => true));
  const replica = createAgentPolicyReplica({
    factReaders,
    policyBundle: options.policyBundle ?? TRIVIAL_POLICY,
    signer: { sign: (fence) => `signed:${fence.fenceId}`, verify: (fence) => fence.signature === `signed:${fence.fenceId}` },
    auditLedger: ledger,
  });

  const callCounts = new Map<string, number>();
  const gateway = {
    async generateChat(input: { requestId: string; messages: readonly { role: string; content: string }[] }) {
      const callCount = (callCounts.get(input.requestId) ?? 0) + 1;
      callCounts.set(input.requestId, callCount);
      if (callCount === 1 && (options.toolCalls?.length ?? 0) > 0) {
        return {
          deltas: options.toolCalls!.map((call, index) => ({
            type: "tool-call" as const,
            index,
            id: `${input.requestId}-call-${index}`,
            name: call.name,
            argumentsDelta: JSON.stringify(call.args),
          })),
          receipt: { measuredUnits: 1 } as never,
        };
      }
      const toolText = input.messages.filter((message) => message.role === "tool").map((message) => message.content).join("\n");
      return { deltas: [{ type: "text" as const, text: toolText || "done" }], receipt: { measuredUnits: 1 } as never };
    },
  };

  const runtime = new AgentRuntime({ authorize: () => true });
  const harness = createProductionAgentHarness({
    gateway: gateway as never,
    retrieval: {
      async retrieve(input) {
        retrievalCalls += 1;
        return {
          status: "context" as const,
          request_id: input.request_id,
          turn_id: input.turn_id,
          index_generation: "generation-1",
          profile_version: profile.profileVersion,
          profile_digest: hash(JSON.stringify(profile)),
          manifest: {
            digest: hash(`manifest:${input.request_id}`),
            retrieved_at: Date.now(),
            source_revision_digest: hash("sources"),
            operation_decision_ref: "operation",
            candidate_decision_ref: "candidate",
            policy_revision: 1,
            subject_security_revision: 1,
            resource_security_revision_digest: hash("resources"),
            expires_at: input.deadline_at,
            profile_version: profile.profileVersion,
            profile_digest: hash(JSON.stringify(profile)),
            sources: [{ resource_ref: "company-corpus", version_ref: "company-corpus", chunk_ref: "chunk-1", content_hash: hash("company-corpus") }],
          },
          sources: [{
            document_version_ref: "company-corpus",
            chunk_ref: "chunk-1",
            text: "search corpus text",
            citation_anchor: "company-corpus:1",
            content_digest: hash("company-corpus"),
            classification_ref: "confidential" as const,
          }],
        };
      },
    },
    profile,
    pdp: replica.pdp,
    auditLedger: ledger,
    modelSelection: { resolve: () => ({ artifactDigest: hash("model") }) },
    modelEligibility: {
      resolveEndpoint: async () => ({ endpointRef: "runtime", snapshotExpiresAt: Date.now() + 30_000, external: false }),
      currentDenyEpoch: () => 0,
    },
    ...authorities(),
    sessionRoot: join(root, "sessions"),
    environment: {},
    runtime,
    mcpTools: options.mcpDescriptors && options.mcpDescriptors.length > 0
      ? { descriptors: options.mcpDescriptors, broker: stubBroker(), sandbox: options.sandbox ?? stubSandbox(() => "unavailable").sandbox }
      : undefined,
  });
  return { harness, audit, getRetrievalCalls: () => retrievalCalls };
}

describe("M6b MCP harness", () => {
  it("mcp.tool-gated-reaches-model", async () => {
    const { sandbox, calls } = stubSandbox(() => ({ content: "sunny in NYC", resourceRefs: [] }));
    const { harness } = fixture({
      mcpDescriptors: [weatherDescriptor()],
      sandbox,
      hasGrant: () => true,
      toolCalls: [{ name: "get_weather", args: { city: "NYC" } }],
    });
    const result = await harness.run(request(1), new AbortController().signal);
    expect(result.status).toBe("COMPLETED");
    expect(result.output).toContain("sunny in NYC");
    expect(calls).toHaveLength(1);
  });

  it("mcp.tool-gated-withheld-without-grant", async () => {
    // (a) M1 blocks outright: the subject lacks the grant, decideBatch denies the tool-boundary
    // action, and the connector is never even dispatched to.
    const { sandbox: blockedSandbox, calls: blockedCalls } = stubSandbox(() => ({ content: "sunny in NYC", resourceRefs: [] }));
    const blocked = fixture({
      mcpDescriptors: [weatherDescriptor()],
      sandbox: blockedSandbox,
      hasGrant: () => false,
      toolCalls: [{ name: "get_weather", args: { city: "NYC" } }],
    });
    const blockedResult = await blocked.harness.run(request(2), new AbortController().signal);
    expect(blockedResult).toMatchObject({ status: "DENIED", output: "Not permitted" });
    expect(blockedCalls).toHaveLength(0);

    // (b) Forced past M1 (a policy bundle that allows the tool-boundary action but denies the
    // same ref under M4's "agent.context.use" action): the connector DOES execute, proving M1
    // let it through, but the result never reaches the model — M4 independently withholds it.
    const toolRef = mcpToolResourceRef("get_weather", "1");
    const { sandbox: forcedSandbox, calls: forcedCalls } = stubSandbox(() => ({ content: "sunny in NYC", resourceRefs: [] }));
    const forcedPolicy: PolicyBundle = {
      revision: 1,
      digest: "sha256:policy-forced",
      signed: true,
      evaluate: (input) => !(input.action === "agent.context.use" && input.resource.resourceRef === toolRef),
    };
    const forced = fixture({
      mcpDescriptors: [weatherDescriptor()],
      sandbox: forcedSandbox,
      hasGrant: () => true,
      policyBundle: forcedPolicy,
      toolCalls: [{ name: "get_weather", args: { city: "NYC" } }],
    });
    const forcedResult = await forced.harness.run(request(3), new AbortController().signal);
    expect(forcedCalls).toHaveLength(1); // M1 let it through — the connector really ran.
    expect(forcedResult.status).toBe("COMPLETED");
    expect(forcedResult.output).toBe(WITHHELD_TOOL_CONTENT);
    expect(forcedResult.output).not.toContain("sunny in NYC");
  });

  it("mcp.resource-gated-filtered", async () => {
    const { sandbox, calls } = stubSandbox((_toolId, args) => (args?.ticketId === "TCK-1"
      ? { content: "ticket TCK-1 allowed content", resourceRefs: ["doc:ticket-allowed"] }
      : { content: "ticket TCK-2 denied content", resourceRefs: ["doc:ticket-denied"] }));
    const { harness } = fixture({
      mcpDescriptors: [ticketDescriptor()],
      sandbox,
      hasGrant: () => true,
      deniedResources: ["doc:ticket-denied"],
      toolCalls: [
        { name: "lookup_ticket", args: { ticketId: "TCK-1" } },
        { name: "lookup_ticket", args: { ticketId: "TCK-2" } },
      ],
    });
    const result = await harness.run(request(4), new AbortController().signal);
    expect(calls).toHaveLength(2); // both calls executed — M1's declared corpus ref allowed both
    expect(result.output).toContain("ticket TCK-1 allowed content");
    expect(result.output).not.toContain("ticket TCK-2 denied content");
    expect(result.output).toContain(WITHHELD_TOOL_CONTENT);
  });

  it("mcp.resource-gated-no-provenance-withheld", async () => {
    const { sandbox } = stubSandbox(() => ({ content: "no provenance content", resourceRefs: [] }));
    const { harness } = fixture({
      mcpDescriptors: [ticketDescriptor()],
      sandbox,
      hasGrant: () => true,
      toolCalls: [{ name: "lookup_ticket", args: { ticketId: "TCK-9" } }],
    });
    const result = await harness.run(request(5), new AbortController().signal);
    expect(result.output).toBe(WITHHELD_TOOL_CONTENT);
    expect(result.output).not.toContain("no provenance content");
  });

  it("mcp.every-call-decided", async () => {
    const { sandbox, calls } = stubSandbox(() => ({ content: "sunny in NYC", resourceRefs: [] }));
    const { harness, audit, getRetrievalCalls } = fixture({
      mcpDescriptors: [weatherDescriptor()],
      sandbox,
      hasGrant: () => true,
      toolCalls: [
        { name: "search_corpus", args: { query: "terms" } },
        { name: "get_weather", args: { city: "NYC" } },
      ],
    });
    const result = await harness.run(request(6), new AbortController().signal);
    expect(result.status).toBe("COMPLETED");
    const fenceConsumed = audit.mock.calls.filter((call) => call[1].action === "fence_consumed").length;
    expect(fenceConsumed).toBe(getRetrievalCalls() + calls.length);
    expect(fenceConsumed).toBe(2);
  });

  it("mcp.drifted-tool-blocked-at-harness", async () => {
    // The tool descriptor is simply absent — a `drifted` (or otherwise unapproved) tool is not
    // part of the approved catalog handed to the harness, so it is never in the dispatch table.
    const { sandbox, calls } = stubSandbox(() => ({ content: "sunny in NYC", resourceRefs: [] }));
    const { harness } = fixture({
      mcpDescriptors: [],
      sandbox,
      hasGrant: () => true,
      toolCalls: [{ name: "get_weather", args: { city: "NYC" } }],
    });
    const result = await harness.run(request(7), new AbortController().signal);
    expect(result).toMatchObject({ status: "DENIED", output: "Not permitted" });
    expect(calls).toHaveLength(0);
  });

  it("mcp.concurrent-isolation", async () => {
    const grantedSubjects = new Set(["employee-10", "employee-12"]);
    const { sandbox } = stubSandbox((_toolId, args) => ({ content: `weather for ${String(args?.city)}`, resourceRefs: [] }));
    const { harness } = fixture({
      mcpDescriptors: [weatherDescriptor()],
      sandbox,
      hasGrant: ({ subjectRef }) => grantedSubjects.has(subjectRef),
      toolCalls: [{ name: "get_weather", args: { city: "shared-city" } }],
    });
    const [granted, denied] = await Promise.all([
      harness.run(request(10, { subjectRef: "employee-10" }), new AbortController().signal),
      harness.run(request(12, { subjectRef: "employee-11" }), new AbortController().signal),
    ]);
    void denied;
    expect(granted.output).toContain("weather for shared-city");
    const deniedResult = await harness.run(request(11, { subjectRef: "employee-11" }), new AbortController().signal);
    expect(deniedResult).toMatchObject({ status: "DENIED", output: "Not permitted" });
  });

  it("mcp.concurrent-isolation: ten sessions", async () => {
    const { sandbox } = stubSandbox((_toolId, args) => ({ content: `weather for ${String(args?.city)}`, resourceRefs: [] }));
    const { harness } = fixture({
      mcpDescriptors: [weatherDescriptor()],
      sandbox,
      hasGrant: ({ subjectRef }) => Number(subjectRef.split("-")[1]) % 2 === 0,
      toolCalls: [{ name: "get_weather", args: { city: "city" } }],
    });
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) =>
      harness.run(request(20 + index, { subjectRef: `employee-${index}`, requestId: `req-${index}` }), new AbortController().signal)));
    results.forEach((result, index) => {
      if (index % 2 === 0) {
        expect(result.output).toContain("weather for city");
      } else {
        expect(result).toMatchObject({ status: "DENIED", output: "Not permitted" });
      }
    });
  });
});

describe("M6b transcript pairing invariant with MCP results", () => {
  it("mcp.transcript-stays-valid", async () => {
    const root = mkdtempSync(join(tmpdir(), "lens-m6b-transcript-"));
    roots.push(root);
    const env = new NodeExecutionEnv({ cwd: root });
    const repo = new JsonlSessionRepo({ fileSystem: env, sessionsRoot: join(root, "sessions") });
    const session = await repo.create({ id: "m6b-transcript", cwd: root }, TODO_CONTEXT);
    const filteredContexts: unknown[][] = [];
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
        async generateChat() {
          generation += 1;
          const deltas = generation === 1
            ? [
                { type: "tool-call" as const, index: 0, id: "call-allowed", name: "lookup_ticket", argumentsDelta: '{"ticketId":"TCK-1"}' },
                { type: "tool-call" as const, index: 1, id: "call-denied", name: "lookup_ticket", argumentsDelta: '{"ticketId":"TCK-2"}' },
              ]
            : [{ type: "text" as const, text: "done" }];
          return { deltas, receipt: { measuredUnits: 1 } as never };
        },
      },
    });
    const models = createModels();
    models.setProvider(transport.provider);
    const { sandbox } = stubSandbox((_toolId, args) => (args?.ticketId === "TCK-1"
      ? { content: "allowed ticket content", resourceRefs: ["doc:allowed"] }
      : { content: "denied ticket content", resourceRefs: ["doc:denied"] }));
    const tool = createMcpTool(ticketDescriptor(), {
      broker: stubBroker(),
      sandbox,
      scope: { requestId: "request", subjectRef: "employee-7" },
    });
    const { harness } = await AgentHarness.create({
      session,
      models,
      model: transport.model,
      tools: [tool],
      systemPrompt: "test",
    }, TODO_CONTEXT);
    transport.bind(harness);
    bindContextAuthorization(harness, {
      scope: { requestId: "request", callerWorkloadRef: "prime-agent", subjectRef: "employee-7", deviceRef: "device-7", deadlineAt: Date.now() + 30_000 },
      pdp: { decideBatch: (input) => ({ allowed: input.resourceRefs.filter((ref) => ref !== "doc:denied") }) },
      log: { emit: () => {} },
    });
    harness.hooks.on("transform_context", (event) => {
      filteredContexts.push(event.messages);
      return undefined;
    });

    try {
      const lane = await harness.lane("main", TODO_CONTEXT);
      await lane.prompt("Look up both tickets", [], TODO_CONTEXT);
      type TranscriptMessage = { role: string; toolCallId?: string; content: readonly { type: string; id?: string }[]; details?: unknown };
      const messages = filteredContexts.at(-1) as TranscriptMessage[];
      const toolCallIds = messages.flatMap((message) => message.role === "assistant"
        ? message.content.flatMap((content) => content.type === "toolCall" && content.id ? [content.id] : [])
        : []);
      const resultIds = new Set(messages.flatMap((message) => message.role === "toolResult" ? [message.toolCallId] : []));
      expect(messages).toContainEqual(expect.objectContaining({
        role: "toolResult",
        toolCallId: "call-denied",
        content: [{ type: "text", text: WITHHELD_TOOL_CONTENT }],
        details: { resourceRefs: [] },
      }));
      expect(toolCallIds.length).toBeGreaterThan(0);
      expect(toolCallIds.every((id: string) => resultIds.has(id))).toBe(true);
    } finally {
      await harness.close(TODO_CONTEXT);
      await repo.close(TODO_CONTEXT);
    }
  });
});
