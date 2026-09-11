import { createHash, generateKeyPairSync } from "node:crypto";
import { readFileSync, mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InternalInferenceClient } from "../../orchestrator-service/src/internalInferenceClient";
import { main } from "../src/main";
import {
  ProviderConcurrencyGate,
  SidecarSecretStore,
  type ProviderRuntimeConfig,
  type ProviderRuntimeConfigResolver,
} from "../src/providerRuntime";

const TOKEN = "m".repeat(40);
const ARTIFACT_DIGEST = `sha256:${"a".repeat(64)}` as const;

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)));
}

function config(modelRef: string, internalUrl: string, adapterType: "openai-compatible" | "gemini-dev" = "openai-compatible"): ProviderRuntimeConfig {
  return {
    providerId: "provider:m2b",
    adapterType,
    internalUrl,
    secretRef: "secret:m2b",
    tlsWorkloadRef: "workload:m2b",
    allowedCapabilities: ["generate", "stream"],
    modelRef,
    timeoutMs: 10_000,
    maxConcurrency: 2,
    catalogVersion: 1,
    catalogDigest: `sha256:${"b".repeat(64)}`,
  };
}

describe("M2b sidecar chat transport", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (closers.length > 0) await closers.pop()!();
    vi.restoreAllMocks();
  });

  async function startSidecar(runtimeConfig: ProviderRuntimeConfig, providerProfile: "sovereign" | "development" = "development") {
    const dir = mkdtempSync(join(tmpdir(), "m2b-sidecar-"));
    const keys = generateKeyPairSync("ed25519");
    const pem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const resolver: ProviderRuntimeConfigResolver = {
      async resolve(modelRef) {
        if (modelRef !== runtimeConfig.modelRef) throw new Error("FORBIDDEN");
        return runtimeConfig;
      },
    };
    const running = await main({
      PORT: "0",
      HOST: "127.0.0.1",
      WORKLOAD_TOKEN: TOKEN,
      INTERNAL_RUNTIME_URL: "",
      INTERNAL_RUNTIME_WORKLOAD_TOKEN: "",
      SCHEDULER_SIGNING_KEY: pem,
      USAGE_SIGNING_KEY: pem,
      ATTEMPT_STORE_PROFILE: "test",
      ATTEMPT_STORE_DB_PATH: join(dir, "attempts.db"),
      PROVIDER_PROFILE: providerProfile,
    }, {
      providerRuntime: {
        configResolver: resolver,
        secretStore: new SidecarSecretStore({ async resolve() { return "sk-m2b-provider-key"; } }),
        gate: new ProviderConcurrencyGate(new Map(), 2),
      },
    });
    closers.push(running.close);
    return `http://127.0.0.1:${running.port}`;
  }

  async function handshake(origin: string, reservationId: string, modelRef: string, deadlineAt: number) {
    const headers = { "content-type": "application/json", "x-lens-model-workload-token": TOKEN };
    const requestId = `request:${reservationId}`;
    const turnId = `turn:${reservationId}`;
    const stepId = `step:${reservationId}`;
    await fetch(`${origin}/v1/attempts/accept`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        reservation_id: reservationId,
        request_id: requestId,
        turn_id: turnId,
        step_id: stepId,
        request_digest: "digest:m2b",
        model_ref: modelRef,
        artifact_digest: ARTIFACT_DIGEST,
        endpoint_generation: "generation:m2b",
        deadline_at: deadlineAt,
      }),
    });
    const lease = await fetch(`${origin}/v1/scheduler/reservations`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        reservation_id: reservationId,
        request_id: requestId,
        turn_id: turnId,
        step_id: stepId,
        request_digest: "digest:m2b",
        model_ref: modelRef,
        artifact_digest: ARTIFACT_DIGEST,
        endpoint_ref: "endpoint:m2b",
        endpoint_generation: "generation:m2b",
        expires_at: deadlineAt,
      }),
    }).then((response) => response.json() as Promise<{ fence: number; expires_at: number; lease_token: string; endpoint_ref: string }>);
    await fetch(`${origin}/v1/attempts/bind-lease`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        reservation_id: reservationId,
        fence: lease.fence,
        endpoint_ref: lease.endpoint_ref,
        endpoint_generation: "generation:m2b",
        request_digest: "digest:m2b",
        expires_at: lease.expires_at,
        lease_token: lease.lease_token,
      }),
    });
    await fetch(`${origin}/v1/attempts/contact-intent`, {
      method: "POST",
      headers,
      body: JSON.stringify({ reservation_id: reservationId }),
    });
    return lease;
  }

  it("transport.sidecar-chat-roundtrip", async () => {
    let upstreamBody: Record<string, unknown> | undefined;
    const upstream = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        upstreamBody = JSON.parse(raw) as Record<string, unknown>;
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Checking " } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "search", arguments: "{\"q\":" } }] } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"lens\"}" } }] } }] })}\n\n`);
        res.end("data: [DONE]\n\n");
      });
    });
    const upstreamPort = await listen(upstream);
    closers.push(() => new Promise<void>((resolve) => upstream.close(() => resolve())));

    const modelRef = "model:m2b";
    const origin = await startSidecar(config(modelRef, `http://127.0.0.1:${upstreamPort}`));
    const deadlineAt = Date.now() + 30_000;
    const lease = await handshake(origin, "reservation:m2b", modelRef, deadlineAt);
    const client = new InternalInferenceClient(origin, TOKEN);
    const result = await client.executeChat({
      reservationId: "reservation:m2b",
      fence: lease.fence,
      endpointRef: lease.endpoint_ref,
      endpointGeneration: "generation:m2b",
      requestDigest: "digest:m2b",
      leaseToken: lease.lease_token,
      scopeId: "scope:m2b",
      deadlineAt,
      modelRef,
      messages: [
        { role: "system", content: "Use tools." },
        { role: "user", content: "Find Lens." },
      ],
      tools: [{ name: "search", description: "Search", parameters: { type: "object" } }],
    }, new AbortController().signal);

    expect(result.deltas).toEqual([
      { type: "text", text: "Checking " },
      { type: "tool-call", index: 0, id: "call_1", name: "search", argumentsDelta: "{\"q\":" },
      { type: "tool-call", index: 0, argumentsDelta: "\"lens\"}" },
    ]);
    expect(result.receipt).toMatchObject({ reservationId: "reservation:m2b", terminal: "completed" });
    expect(upstreamBody).toMatchObject({
      model: modelRef,
      messages: [
        { role: "system", content: "Use tools." },
        { role: "user", content: "Find Lens." },
      ],
      tools: [{ type: "function", function: { name: "search", description: "Search", parameters: { type: "object" } } }],
    });
  });

  it("transport.sidecar-legacy-route-unchanged", async () => {
    const clientSource = readFileSync(join(process.cwd(), "../orchestrator-service/src/internalInferenceClient.ts"), "utf8").replace(/\r\n/g, "\n");
    const executeSource = clientSource.slice(clientSource.indexOf("  async execute(input:"), clientSource.indexOf("\n  async executeChat"));
    expect(createHash("sha256").update(executeSource).digest("hex")).toBe("f3c03c1fb7d8b230861c7d0d37193bf4c20806439a72b17349b6ebc514e93f9a");

    const sidecarSource = readFileSync(join(process.cwd(), "src/main.ts"), "utf8").replace(/\r\n/g, "\n");
    const handlerSource = sidecarSource.slice(sidecarSource.indexOf("  const generateStream = async"), sidecarSource.indexOf("\n  const chatStream"));
    expect(createHash("sha256").update(handlerSource).digest("hex")).toBe("4bce588094929ccb7b71b17d65044f1849bf7521a94d214b4ab447e2139da38b");

    const responseBody = JSON.stringify({
      output: "legacy-output",
      receipt: {
        reservation_id: "legacy-reservation",
        fence: 7,
        scope_id: "legacy-scope",
        schema_version: 1,
        request_id: "legacy-request",
        turn_id: "legacy-turn",
        step_id: "legacy-step",
        artifact_digest: ARTIFACT_DIGEST,
        endpoint_generation: "legacy-generation",
        usage_event_id: "legacy-usage",
        measured_units: 3,
        terminal: "completed",
        usage_signature: "legacy-signed-usage",
      },
    });
    let requestBody = "";
    const client = new InternalInferenceClient("http://127.0.0.1:8443", TOKEN, async (_url, init) => {
      requestBody = String(init?.body);
      return new Response(responseBody, { status: 200, headers: { "content-type": "application/json" } });
    });
    const deadlineAt = Date.now() + 30_000;
    await client.execute({
      reservationId: "legacy-reservation",
      fence: 7,
      endpointRef: "legacy-endpoint",
      scopeId: "legacy-scope",
      deadlineAt,
      chunks: ["legacy", " prompt"],
      leaseToken: "legacy-lease",
      requestDigest: "legacy-digest",
      endpointGeneration: "legacy-generation",
    }, new AbortController().signal);
    expect(requestBody).toBe(`{"reservation_id":"legacy-reservation","fence":7,"endpoint_ref":"legacy-endpoint","endpoint_generation":"legacy-generation","request_digest":"legacy-digest","lease_token":"legacy-lease","scope_id":"legacy-scope","deadline_at":${deadlineAt},"chunks":["legacy"," prompt"]}`);
    expect(responseBody).toBe("{\"output\":\"legacy-output\",\"receipt\":{\"reservation_id\":\"legacy-reservation\",\"fence\":7,\"scope_id\":\"legacy-scope\",\"schema_version\":1,\"request_id\":\"legacy-request\",\"turn_id\":\"legacy-turn\",\"step_id\":\"legacy-step\",\"artifact_digest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"endpoint_generation\":\"legacy-generation\",\"usage_event_id\":\"legacy-usage\",\"measured_units\":3,\"terminal\":\"completed\",\"usage_signature\":\"legacy-signed-usage\"}}");
  });

  it("transport.sidecar-uses-factory", async () => {
    const modelRef = "model:gemini-refused";
    const origin = await startSidecar(config(modelRef, "https://provider.internal", "gemini-dev"), "sovereign");
    const deadlineAt = Date.now() + 30_000;
    const lease = await handshake(origin, "reservation:factory", modelRef, deadlineAt);
    const response = await fetch(`${origin}/v1/inference/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lens-model-workload-token": TOKEN },
      body: JSON.stringify({
        reservation_id: "reservation:factory",
        fence: lease.fence,
        endpoint_ref: lease.endpoint_ref,
        endpoint_generation: "generation:m2b",
        request_digest: "digest:m2b",
        lease_token: lease.lease_token,
        scope_id: "scope:m2b",
        deadline_at: deadlineAt,
        model_ref: modelRef,
        messages: [{ role: "user", content: "hello" }],
        tools: [],
      }),
    });
    expect(response.status).toBe(500);

    const runtimeSource = readFileSync(join(process.cwd(), "src/providerRuntime.ts"), "utf8");
    const chatFlow = runtimeSource.slice(runtimeSource.indexOf("export async function* runProviderChatGeneration"));
    expect(chatFlow).toContain("createModelProviderAdapter(adapterConfig");
    expect(chatFlow).not.toContain("new OpenAICompatibleAdapter");
    expect(chatFlow).not.toContain("new GeminiDevAdapter");
  });
});
