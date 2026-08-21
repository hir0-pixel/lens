import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createOrchestratorHttp, type OrchestratorChatRequest, type OrchestratorChatResponse, type OrchestratorHttp } from "../src/http";

const TOKEN = "w".repeat(40);
const NOW = 1_700_000_000_000;
const OUTPUT_DIGEST = `sha256:${"f".repeat(64)}` as const;
const INPUT_TEXT = "What does the policy say?";
const QUERY_DIGEST = `sha256:${createHash("sha256").update(INPUT_TEXT).digest("hex")}`;

function validBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    request_id: "req-1",
    turn_id: "turn-1",
    subject_ref: "subject-1",
    session_ref: "session-1",
    device_ref: "device-1",
    application_id: "lens-employee-client",
    purpose_ref: "assistant",
    retrieval_class: "enterprise-grounded",
    capability: "grounded-assistant",
    input_text: INPUT_TEXT,
    query_digest: QUERY_DIGEST,
    deadline_at: NOW + 30_000,
    retry_budget: 0,
    bulkhead: "interactive",
    ...overrides,
  };
}

describe("createOrchestratorHttp", () => {
  let http: OrchestratorHttp;
  let base: string;
  let handleChat: ReturnType<typeof vi.fn<(request: OrchestratorChatRequest, signal: AbortSignal) => Promise<OrchestratorChatResponse>>>;

  beforeEach(async () => {
    handleChat = vi.fn(async (request) => ({
      status: "COMPLETED",
      requestId: request.requestId,
      turnId: request.turnId,
      output: `ok:${request.inputText}`,
      citations: [{ source: "policy.docx", section: "Section 2" }],
      outputDigest: OUTPUT_DIGEST,
    }));
    http = createOrchestratorHttp({ workloadToken: TOKEN, handleChat, now: () => NOW });
    await http.listen(0, "127.0.0.1");
    const { port } = http.server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await http.close();
  });

  const post = async (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lens-orchestrator-token": TOKEN,
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("rejects invalid constructor settings", () => {
    expect(() => createOrchestratorHttp({ workloadToken: "short", handleChat: async () => ({ status: "FAILED", requestId: "req" }) })).toThrow(/at least 32/);
    expect(() => createOrchestratorHttp({ workloadToken: TOKEN, handleChat: async () => ({ status: "FAILED", requestId: "req" }), maxActiveRequests: 0 })).toThrow(/at least 1/);
  });

  it("rejects requests without a valid workload token", async () => {
    const unauthenticated = await fetch(`${base}/v1/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody()),
    });
    expect(unauthenticated.status).toBe(401);

    const wrongToken = await post("/v1/chat", validBody(), { "x-lens-orchestrator-token": "x".repeat(40) });
    expect(wrongToken.status).toBe(401);
  });

  it("serves liveness and readiness probes", async () => {
    const live = await fetch(`${base}/livez`);
    expect(live.status).toBe(200);

    const ready = await fetch(`${base}/readyz`);
    expect(ready.status).toBe(200);

    http.setReadiness(false);
    const notReady = await fetch(`${base}/readyz`);
    expect(notReady.status).toBe(503);
    http.setReadiness(true);
  });

  it("rejects unknown routes and malformed JSON", async () => {
    const missing = await post("/v1/other", validBody());
    expect(missing.status).toBe(404);

    const malformed = await post("/v1/chat", "not-json{");
    expect(malformed.status).toBe(400);
  });

  it("rejects invalid or authority-injected request bodies", async () => {
    const missingField = await post("/v1/chat", { ...validBody(), request_id: undefined });
    expect(missingField.status).toBe(400);

    const injected = await post("/v1/chat", validBody({ role: "admin" }));
    expect(injected.status).toBe(400);

    const digestMismatch = await post("/v1/chat", validBody({ query_digest: `sha256:${"a".repeat(64)}` }));
    expect(digestMismatch.status).toBe(400);

    const emptyInput = await post("/v1/chat", validBody({ input_text: "   " }));
    expect(emptyInput.status).toBe(400);

    const oversizedInput = await post("/v1/chat", validBody({ input_text: "x".repeat(12_001) }));
    expect(oversizedInput.status).toBe(400);

    const staleDeadline = await post("/v1/chat", validBody({ deadline_at: NOW }));
    expect(staleDeadline.status).toBe(400);

    const excessiveDeadline = await post("/v1/chat", validBody({ deadline_at: NOW + 65_001 }));
    expect(excessiveDeadline.status).toBe(400);
  });

  it("rejects oversized header envelopes", async () => {
    const smallHeaders = createOrchestratorHttp({
      workloadToken: TOKEN,
      handleChat,
      now: () => NOW,
      maxHeaderBytes: 64,
    });
    await smallHeaders.listen(0, "127.0.0.1");
    const { port } = smallHeaders.server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lens-orchestrator-token": TOKEN,
        "x-extra": "z".repeat(128),
      },
      body: JSON.stringify(validBody()),
    });
    expect(response.status).toBe(431);
    await smallHeaders.close();
  });

  it("returns 429 when request capacity is exhausted", async () => {
    const overloaded = createOrchestratorHttp({
      workloadToken: TOKEN,
      handleChat,
      now: () => NOW,
      maxActiveRequests: 1,
    });
    await overloaded.listen(0, "127.0.0.1");
    const { port } = overloaded.server.address() as AddressInfo;
    const net = await import("node:net");
    const socket = net.connect(port, "127.0.0.1");
    socket.write(`POST /v1/chat HTTP/1.1\r\nHost: 127.0.0.1\r\ncontent-type: application/json\r\nx-lens-orchestrator-token: ${TOKEN}\r\ncontent-length: 1000\r\n\r\npartial`);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const response = await fetch(`http://127.0.0.1:${port}/v1/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lens-orchestrator-token": TOKEN,
      },
      body: JSON.stringify(validBody({ request_id: "req-2", turn_id: "turn-2" })),
    });
    expect(response.status).toBe(429);

    socket.destroy();
    await overloaded.close();
  });

  it("returns 503 DRAINING to new work while draining with in-flight requests", async () => {
    const net = await import("node:net");
    const { port } = http.server.address() as AddressInfo;
    const inflight = net.connect(port, "127.0.0.1");
    await new Promise<void>((resolve) => inflight.on("connect", resolve));
    inflight.write(`POST /v1/chat HTTP/1.1\r\nHost: h\r\ncontent-type: application/json\r\nx-lens-orchestrator-token: ${TOKEN}\r\ncontent-length: 1000\r\n\r\npartial`);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const draining = http.close();
    const response = await post("/v1/chat", validBody({ request_id: "req-3", turn_id: "turn-3" }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "DRAINING" });

    inflight.destroy();
    await draining;
  });

  it("parses and forwards a valid request to handleChat", async () => {
    const response = await post("/v1/chat", validBody());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "COMPLETED",
      requestId: "req-1",
      turnId: "turn-1",
      output: "ok:What does the policy say?",
      citations: [{ source: "policy.docx", section: "Section 2" }],
      outputDigest: OUTPUT_DIGEST,
    });
    expect(handleChat).toHaveBeenCalledTimes(1);
    expect(handleChat.mock.calls[0]?.[0]).toEqual({
      requestId: "req-1",
      turnId: "turn-1",
      subjectRef: "subject-1",
      sessionRef: "session-1",
      deviceRef: "device-1",
      applicationId: "lens-employee-client",
      purposeRef: "assistant",
      retrievalClass: "enterprise-grounded",
      capability: "grounded-assistant",
      inputText: "What does the policy say?",
      queryDigest: QUERY_DIGEST,
      deadlineAt: NOW + 30_000,
      retryBudget: 0,
      bulkhead: "interactive",
    });
    expect(handleChat.mock.calls[0]?.[1].aborted).toBe(false);
  });
});
