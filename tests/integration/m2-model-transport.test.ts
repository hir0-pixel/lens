import net from "node:net";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AgentHarness, JsonlSessionRepo, NodeExecutionEnv, TODO_CONTEXT } from "@earendil-works/pi-agent-core/node";
import { createModels } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEchoTool } from "../../services/agent-integration/governanceBinding";
import {
  assertAgentEnvironment,
  createInProcessLensAgentProvider,
  createLensAgentProvider,
} from "../../services/agent-integration/modelTransport";
import { AgentError } from "../../services/agent-runtime/AgentRuntime";
import { GpuScheduler } from "../../services/gpu-scheduler/GpuScheduler";
import { InternalInferenceClient } from "../../orchestrator-service/src/internalInferenceClient";
import { ModelGateway, type ModelGatewayAuthority, type ModelGatewayChatDispatchInput, type RuntimePort } from "../../services/model-gateway/ModelGateway";
import { OpenAICompatibleAdapter } from "../../services/model-provider/OpenAICompatibleAdapter";
import type { ProviderEndpointConfig } from "../../services/model-provider/ProviderAdapter";
import { RelationalRuntimeAttemptStore } from "../../services/runtime-attempt/RelationalRuntimeAttemptStore";
import { AuthorityReceiptIssuer, Ed25519ReceiptVerifier } from "../../services/security/authorityReceipt";
import { InMemoryClaimStore } from "../../services/security/replayClaimStore";
import { createSqlitePgCompatPool } from "../../services/storage/pgPool";

const ROOT = resolve(import.meta.dirname, "../..");
const MODEL_REF = "acme-chat";
const ARTIFACT: `sha256:${string}` = `sha256:${"a".repeat(64)}`;
const secret = "abcdefghijkl";

function config(overrides: Partial<ProviderEndpointConfig> = {}): ProviderEndpointConfig {
  return {
    adapterType: "openai-compatible",
    baseUrl: "http://127.0.0.1:8080",
    secretRef: "GATEWAY",
    tlsWorkloadRef: "workload:model-gateway",
    allowedModels: [MODEL_REF],
    expectedCapabilities: ["generate", "stream"],
    timeoutMs: 5_000,
    maxConcurrency: 4,
    profile: "sovereign",
    ...overrides,
  };
}

function sse(...events: Array<object | "[DONE]">): Response {
  return new Response(events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function authority(issuer: AuthorityReceiptIssuer, input: { requestId: string; turnId: string; stepId: string; modelRef: string; deadlineAt: number }): ModelGatewayAuthority {
  const ttlMs = Math.max(1, input.deadlineAt - Date.now());
  const generationDecision = issuer.issue({ purpose: "authorize_generate", issuer: "authority-model-use", requestId: input.requestId, boundDigest: ARTIFACT, revision: 1 }, ttlMs).token;
  const modelUseDecision = issuer.issue({ purpose: "authorize_model_use", issuer: "authority-model-use", requestId: input.requestId, turnId: input.turnId, stepId: input.stepId, stepClass: "tool", modelRef: input.modelRef, artifactDigest: ARTIFACT, capability: "chat", boundDigest: ARTIFACT, revision: 1 }, ttlMs).token;
  const costConsumption = issuer.issue({ purpose: "cost_sub_envelope_consumption", issuer: "authority-cost", requestId: input.requestId, turnId: input.turnId, stepId: input.stepId, reservationRef: "budget-1", subEnvelope: "tool", boundDigest: ARTIFACT, revision: 1 }, ttlMs).token;
  const agentStep = issuer.issue({ purpose: "agent_step", issuer: "authority-agent-run", requestId: input.requestId, turnId: input.turnId, stepId: input.stepId, stepClass: "tool", boundDigest: `sha256:${createHash("sha256").update(modelUseDecision).digest("hex")}`, revision: 1 }, ttlMs).token;
  return { generationDecision, modelUseDecision, costConsumption, agentStep };
}

function gatewayFactory(options: { modelRef?: string; runtimeContacts?: { count: number } } = {}) {
  const now = () => Date.now();
  const keys = generateKeyPairSync("ed25519");
  const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now });
  const verifier = new Ed25519ReceiptVerifier(keys.publicKey, { now });
  let step = 0;
  return {
    prepareDispatch(event: { runId: string }): Omit<ModelGatewayChatDispatchInput, "modelRef" | "messages" | "tools"> {
      const deadlineAt = now() + 30_000;
      const stepId = `agent-${++step}`;
      const requestId = "request-transport";
      const turnId = event.runId;
      const modelRef = options.modelRef ?? MODEL_REF;
      return {
        requestId,
        turnId,
        stepId,
        stepClass: "tool",
        requestDigest: `digest-${stepId}`,
        capability: "chat",
        artifactDigest: ARTIFACT,
        denyEpoch: 1,
        workflowReservationRef: "budget-1",
        deadlineAt,
        scopeId: "scope:subject:revision",
        authority: authority(issuer, { requestId, turnId, stepId, modelRef, deadlineAt }),
      };
    },
    createGateway(runtime: RuntimePort): ModelGateway {
      const scheduler = new GpuScheduler(8, now, issuer);
      const counted: RuntimePort = {
        execute: (input, signal) => runtime.execute(input, signal),
        executeChat: async (input, signal) => {
          if (!runtime.executeChat) throw new Error("DEPENDENCY_UNAVAILABLE");
          if (options.runtimeContacts) options.runtimeContacts.count += 1;
          return runtime.executeChat(input, signal);
        },
      };
      return new ModelGateway(
        {
          resolve: async () => ({ endpointRef: "inference-1", snapshotExpiresAt: now() + 30_000, external: false, endpointGeneration: "gen-1" }),
          resolveChat: async (input) => {
            if (input.modelRef !== MODEL_REF) throw new Error("unknown model");
            return { endpointRef: "inference-1", snapshotExpiresAt: now() + 30_000, external: false, endpointGeneration: "gen-1" };
          },
        },
        { reserve: async (input) => scheduler.reserve(input), start: async (...args) => { scheduler.start(...args); }, release: async (...args) => { scheduler.release(...args); } },
        counted,
        verifier,
        new InMemoryClaimStore(),
        new RelationalRuntimeAttemptStore(createSqlitePgCompatPool(":memory:")),
        now,
      );
    },
  };
}

async function runHarness(transport: ReturnType<typeof createInProcessLensAgentProvider>, withTool = false) {
  const root = mkdtempSync(join(tmpdir(), "lens-m2-"));
  const env = new NodeExecutionEnv({ cwd: root });
  const repo = new JsonlSessionRepo({ fileSystem: env, sessionsRoot: join(root, "sessions") });
  const session = await repo.create({ id: "m2", cwd: root }, TODO_CONTEXT);
  const models = createModels();
  models.setProvider(transport.provider);
  let executions = 0;
  const { harness } = await AgentHarness.create({
    session,
    models,
    model: transport.model,
    tools: withTool ? [createEchoTool(() => { executions += 1; })] : [],
    systemPrompt: "Lens system prompt",
  }, TODO_CONTEXT);
  transport.bind(harness);
  try {
    const lane = await harness.lane("main", TODO_CONTEXT);
    await lane.prompt("complete the task", [], TODO_CONTEXT);
    const entries = await session.findEntries(undefined, TODO_CONTEXT);
    return { executions, transcript: JSON.stringify(entries) };
  } finally {
    await harness.close(TODO_CONTEXT);
    await repo.close(TODO_CONTEXT);
    rmSync(root, { recursive: true, force: true });
  }
}

afterEach(() => {
  delete process.env.LENS_SECRET_GATEWAY;
  vi.restoreAllMocks();
});

describe("M2a model transport", () => {
  it("transport.legacy-body-unchanged", async () => {
    process.env.LENS_SECRET_GATEWAY = secret;
    let body = "";
    const adapter = new OpenAICompatibleAdapter(config(), async (_input, init) => {
      body = String(init?.body);
      return sse("[DONE]");
    });
    for await (const _ of adapter.generateStream({ model: MODEL_REF, chunks: ["hello ", "world"], deadlineAt: Date.now() + 5_000 }, new AbortController().signal)) {
      // Drain the legacy stream.
    }
    expect(body).toBe('{"model":"acme-chat","stream":true,"messages":[{"role":"user","content":"hello world"}]}');
  });

  it("transport.no-direct-socket", async () => {
    process.env.LENS_SECRET_GATEWAY = secret;
    const bodies: string[] = [];
    let response = 0;
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body));
      response += 1;
      if (response === 1) return sse(
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", function: { name: "echo", arguments: '{"resourceRef":"document-1",' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"value":"hello"}' } }] } }] },
        "[DONE]",
      );
      return sse({ choices: [{ delta: { content: "done" } }] }, "[DONE]");
    };
    const runtimeContacts = { count: 0 };
    const gateway = gatewayFactory({ runtimeContacts });
    const transport = createInProcessLensAgentProvider({
      selection: { modelRef: MODEL_REF },
      providerConfig: config(),
      fetcher,
      createGateway: gateway.createGateway,
      prepareDispatch: gateway.prepareDispatch,
      environment: {},
    });
    const connect = vi.spyOn(net.Socket.prototype, "connect").mockImplementation(() => { throw new Error("direct socket"); });
    const result = await runHarness(transport, true);
    expect(result).toMatchObject({ executions: 1 });
    expect(result.transcript).toContain("done");
    expect(runtimeContacts.count).toBe(2);
    expect(connect).not.toHaveBeenCalled();
    expect(JSON.parse(bodies[0]!)).toMatchObject({
      messages: [{ role: "system", content: "Lens system prompt" }, { role: "user", content: "complete the task" }],
      tools: [{ type: "function", function: { name: "echo" } }],
    });
    const secondRequest = JSON.parse(bodies[1]!) as { messages: unknown[] };
    expect(secondRequest.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", tool_calls: [{ id: "call-1", type: "function", function: { name: "echo", arguments: '{"resourceRef":"document-1","value":"hello"}' } }] }),
      expect.objectContaining({ role: "tool", tool_call_id: "call-1" }),
    ]));
  });

  it("transport.model-ref-only", () => {
    const gateway = { generateChat: vi.fn() } as unknown as Pick<ModelGateway, "generateChat">;
    expect(() => createLensAgentProvider({
      selection: { modelRef: MODEL_REF, apiKey: "secret" } as unknown as { modelRef: string },
      gateway,
      prepareDispatch: vi.fn(),
      environment: {},
    })).toThrow(/only modelRef/);
    expect(() => createLensAgentProvider({
      selection: { modelRef: MODEL_REF, baseUrl: "https://provider.invalid", provider: "openai" } as unknown as { modelRef: string },
      gateway,
      prepareDispatch: vi.fn(),
      environment: {},
    })).toThrow(/only modelRef/);
  });

  it("transport.unknown-model-rejected", async () => {
    process.env.LENS_SECRET_GATEWAY = secret;
    const runtimeContacts = { count: 0 };
    const gateway = gatewayFactory({ modelRef: "unknown-model", runtimeContacts });
    const transport = createInProcessLensAgentProvider({
      selection: { modelRef: "unknown-model" },
      providerConfig: config({ allowedModels: ["unknown-model"] }),
      fetcher: async () => sse({ choices: [{ delta: { content: "must not run" } }] }, "[DONE]"),
      createGateway: gateway.createGateway,
      prepareDispatch: gateway.prepareDispatch,
      environment: {},
    });
    const result = await runHarness(transport);
    expect(runtimeContacts.count).toBe(0);
    expect(result.transcript).toContain("Model request failed.");
    expect(result.transcript).not.toContain("must not run");
  });

  it("transport.no-secrets-in-env", () => {
    expect(() => assertAgentEnvironment({})).not.toThrow();
    for (const name of ["SECRET_STORE_KEY", "LENS_MCP_SECRET_STORE_KEY", "CATALOG_WORKLOAD_TOKEN", "OPENAI_API_KEY", "COMPANY_PROVIDER_API_KEY"]) {
      expect(() => assertAgentEnvironment({ [name]: "secret" })).toThrow(/credentials/);
    }
  });

  it("transport.sovereign-profile-intact", () => {
    const gateway = gatewayFactory();
    expect(() => createInProcessLensAgentProvider({
      selection: { modelRef: MODEL_REF },
      providerConfig: config({ adapterType: "gemini-dev" }),
      createGateway: gateway.createGateway,
      prepareDispatch: gateway.prepareDispatch,
      environment: {},
    })).toThrow(/openai-compatible/);
  });

  it("transport.agent-path-uses-factory", () => {
    const source = readFileSync(join(ROOT, "services/agent-integration/modelTransport.ts"), "utf8");
    expect(source).toContain("createModelProviderAdapter(options.providerConfig");
    expect(source).not.toMatch(/new\s+(?:OpenAICompatibleAdapter|GeminiDevAdapter)\b/);
    const gateway = gatewayFactory();
    expect(() => createInProcessLensAgentProvider({
      selection: { modelRef: MODEL_REF },
      providerConfig: config({ adapterType: "gemini-dev" }),
      createGateway: gateway.createGateway,
      prepareDispatch: gateway.prepareDispatch,
      environment: {},
    })).toThrow(/openai-compatible/);
  });

  it("transport.envelope-exhaustion-terminates", async () => {
    process.env.LENS_SECRET_GATEWAY = secret;
    const calls = { count: 0 };
    const gateway = gatewayFactory({ runtimeContacts: calls });
    const transport = createInProcessLensAgentProvider({
      selection: { modelRef: MODEL_REF },
      providerConfig: config(),
      fetcher: async () => sse({ choices: [{ delta: { content: "partial answer" } }] }, "[DONE]"),
      createGateway: gateway.createGateway,
      prepareDispatch: () => { throw new AgentError("ENVELOPE_EXHAUSTED"); },
      environment: {},
    });
    const result = await runHarness(transport);
    expect(calls.count).toBe(0);
    expect(result.transcript).toContain("Model request was not admitted.");
    expect(result.transcript).not.toContain("partial answer");
  });

  it("transport.sidecar-agent-path", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url: String(input), body });
      const call = requests.length;
      const deltas = call === 1
        ? [
            { type: "tool-call", index: 0, id: "call-sidecar", name: "echo", argumentsDelta: '{"resourceRef":"document-1",' },
            { type: "tool-call", index: 0, argumentsDelta: '"value":"hello"}' },
          ]
        : [{ type: "text", text: "sidecar done" }];
      const lines = [
        ...deltas.map((delta) => JSON.stringify({ delta })),
        JSON.stringify({
          done: true,
          receipt: {
            reservation_id: body.reservation_id,
            fence: body.fence,
            scope_id: body.scope_id,
            schema_version: 1,
            request_id: `request-${call}`,
            turn_id: `turn-${call}`,
            step_id: `step-${call}`,
            artifact_digest: ARTIFACT,
            endpoint_generation: body.endpoint_generation,
            usage_event_id: `usage-${call}`,
            measured_units: 2,
            terminal: "completed",
            usage_signature: `signed-usage-token-${call}`,
          },
        }),
      ];
      return new Response(`${lines.join("\n")}\n`, { status: 200, headers: { "content-type": "application/x-ndjson" } });
    });
    const client = new InternalInferenceClient("http://127.0.0.1:8793", "w".repeat(40), fetcher);
    const gateway = gatewayFactory();
    const transport = createLensAgentProvider({
      selection: { modelRef: MODEL_REF },
      gateway: gateway.createGateway(client),
      prepareDispatch: gateway.prepareDispatch,
      environment: {},
    });
    const connect = vi.spyOn(net.Socket.prototype, "connect").mockImplementation(() => { throw new Error("direct socket"); });
    const result = await runHarness(transport, true);

    expect(result).toMatchObject({ executions: 1 });
    expect(result.transcript).toContain("sidecar done");
    expect(connect).not.toHaveBeenCalled();
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.url.endsWith("/v1/inference/chat"))).toBe(true);
    expect(requests[0]!.body).toMatchObject({
      model_ref: MODEL_REF,
      messages: [{ role: "system", content: "Lens system prompt" }, { role: "user", content: "complete the task" }],
      tools: [{ name: "echo" }],
    });
    expect(requests[1]!.body.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", toolCalls: [{ id: "call-sidecar", name: "echo", arguments: '{"resourceRef":"document-1","value":"hello"}' }] }),
      expect.objectContaining({ role: "tool", toolCallId: "call-sidecar" }),
    ]));
  });
});
