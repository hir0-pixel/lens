import { createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { OrchestratorClient } from "../src/rag/orchestratorClient";
import { createApiRouter } from "../src/routes/api";

const TOKEN = "t".repeat(32);

beforeAll(() => {
  process.env.SESSION_SECRET = "s".repeat(48);
});

function completed(requestId: string, status: "COMPLETED" | "INCOMPLETE" = "COMPLETED") {
  const output = status === "COMPLETED" ? "Finished" : "Partial answer";
  return {
    status,
    requestId,
    output,
    outputDigest: `sha256:${createHash("sha256").update(output).digest("hex")}`,
    citations: [],
  };
}

function clientInput(agentMode?: true) {
  return {
    requestId: "req-m5",
    query: "Find the policy",
    subjectRef: "employee-1",
    sessionRef: "session-1",
    deviceRef: "device-1",
    conversationRef: "conversation-1",
    sessionAssertion: "a".repeat(128),
    memorySessionAssertion: "m".repeat(128),
    applicationId: "lens-employee-client",
    purposeRef: "assistant",
    retrievalClass: "enterprise-grounded",
    deadlineMs: 30_000,
    retryBudget: 0 as const,
    ...(agentMode ? { agentMode } : {}),
  };
}

afterEach(() => vi.useRealTimers());

describe("M5 BFF routing opt-in", () => {
  it("routing.default-off", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T00:00:00.000Z"));
    let body = "";
    const client = new OrchestratorClient("http://127.0.0.1:3002", TOKEN, (async (_url, init) => {
      body = String(init?.body);
      return new Response(JSON.stringify(completed("req-m5")));
    }) as typeof fetch);

    await client.ask(clientInput());

    expect(body).toBe(JSON.stringify({
      request_id: "req-m5",
      turn_id: "turn-req-m5",
      subject_ref: "employee-1",
      session_ref: "session-1",
      device_ref: "device-1",
      conversation_ref: "conversation-1",
      session_assertion: "a".repeat(128),
      memory_session_assertion: "m".repeat(128),
      application_id: "lens-employee-client",
      purpose_ref: "assistant",
      retrieval_class: "enterprise-grounded",
      input_text: "Find the policy",
      query_digest: `sha256:${createHash("sha256").update("Find the policy").digest("hex")}`,
      deadline_at: Date.parse("2026-09-11T00:00:30.000Z"),
      cancellation: false,
      retry_budget: 0,
      bulkhead: "interactive",
      capability: "grounded-assistant",
    }));
  });

  it("routing.opt-in-forwards-and-reports-incomplete", async () => {
    let outbound: Record<string, unknown> = {};
    const client = new OrchestratorClient("http://127.0.0.1:3002", TOKEN, (async (_url, init) => {
      outbound = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(completed("req-m5", "INCOMPLETE")));
    }) as typeof fetch);

    await expect(client.ask(clientInput(true))).resolves.toEqual({
      output: "Partial answer",
      citations: [],
      incomplete: true,
    });
    expect(outbound.agent_mode).toBe(true);
  });

  it("routing.ask-toggle-defaults-off", async () => {
    const ragHandler = vi.fn(async (input: { agentMode?: true }) => input.agentMode
      ? { output: "Partial answer", citations: [], incomplete: true as const }
      : { output: "Finished", citations: [] });
    const app = express();
    app.use(express.json());
    app.use("/api", createApiRouter({
      auth: {
        getRateLimitPrincipal: () => "employee-1",
        getTrustedSession: async () => ({ authenticated: true, subject: "employee-1", sessionRef: "session-1", deviceRef: "device-1" }),
      } as never,
      ragHandler,
      conversationReferenceCodec: { issue: () => "conversation-1", verify: () => undefined } as never,
      sessionAssertionIssuer: { issue: () => "session-assertion" } as never,
      memoryAssertionIssuer: { issue: () => "memory-assertion" } as never,
    }));

    const legacy = await request(app).post("/api/rag/ask").send({ query: "Find the policy" });
    const agent = await request(app).post("/api/rag/ask").send({ query: "Find the policy", agentMode: true });

    expect(legacy.body).toEqual({ output: "Finished", citations: [], conversationRef: "conversation-1" });
    expect(ragHandler.mock.calls[0]?.[0]).not.toHaveProperty("agentMode");
    expect(agent.body).toEqual({ output: "Partial answer", citations: [], conversationRef: "conversation-1", incomplete: true });
    expect(ragHandler.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ agentMode: true }));
  });
});
