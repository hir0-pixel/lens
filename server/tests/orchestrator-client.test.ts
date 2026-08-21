import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { OrchestratorClient, OrchestratorClientError } from "../src/rag/orchestratorClient";

const TOKEN = "t".repeat(32);

function okBody() {
  const output = "The remote-work stipend is $1,500.";
  return {
    status: "COMPLETED",
    requestId: "req-1",
    turnId: "turn-req-1",
    output,
    outputDigest: `sha256:${createHash("sha256").update(output).digest("hex")}`,
    citations: [{ source: "remote_work_policy.docx", section: "Section 2" }],
  };
}

describe("OrchestratorClient (Track 1 ownership boundary)", () => {
  it("accepts only HTTPS or loopback HTTP endpoints", () => {
    expect(() => new OrchestratorClient("https://orchestrator.platform.internal", TOKEN)).not.toThrow();
    expect(() => new OrchestratorClient("http://127.0.0.1:3002", TOKEN)).not.toThrow();
    expect(() => new OrchestratorClient("http://public.example.com", TOKEN)).toThrow(/internal HTTPS or loopback/);
    expect(() => new OrchestratorClient("http://10.0.0.5:3002", TOKEN)).toThrow(/internal HTTPS or loopback/);
    expect(() => new OrchestratorClient("https://api.external.example", TOKEN)).toThrow(/internal HTTPS/);
    expect(() => new OrchestratorClient("https://user:pass@orchestrator.platform.internal/v1", TOKEN)).toThrow(/plain HTTPS or loopback/);
  });

  it("rejects a short shared token", () => {
    expect(() => new OrchestratorClient("http://127.0.0.1:3002", "short")).toThrow(/at least 32/);
  });

  it("builds a server-derived request with trusted identity fields only", async () => {
    let captured: unknown;
    let capturedHeaders: HeadersInit | undefined;
    const fetcher = (async (url: URL, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      capturedHeaders = init.headers;
      return new Response(JSON.stringify({ ...okBody(), requestId: "req-1" }), { status: 200 });
    }) as typeof fetch;
    const client = new OrchestratorClient("http://127.0.0.1:3002", TOKEN, fetcher);

    const answer = await client.ask({
      requestId: "req-1",
      query: "What is the stipend?",
      subjectRef: "user-1",
      sessionRef: "session-1",
      deviceRef: "device-1",
      applicationId: "lens-employee-client",
      purposeRef: "assistant",
      retrievalClass: "enterprise-grounded",
      deadlineMs: 30_000,
      retryBudget: 0,
    });

    expect(answer.output).toBe("The remote-work stipend is $1,500.");
    expect(answer.citations).toEqual([{ source: "remote_work_policy.docx", section: "Section 2" }]);
    const body = captured as Record<string, unknown>;
    expect(body.request_id).toBe("req-1");
    expect(body.input_text).toBe("What is the stipend?");
    expect(body.subject_ref).toBe("user-1");
    expect(body.session_ref).toBe("session-1");
    expect(body.device_ref).toBe("device-1");
    expect(body.application_id).toBe("lens-employee-client");
    expect(body.purpose_ref).toBe("assistant");
    expect(body.retrieval_class).toBe("enterprise-grounded");
    expect(body.bulkhead).toBe("interactive");
    expect(body.capability).toBe("grounded-assistant");
    expect(body.query_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(body.deadline_at).toBeGreaterThan(Date.now());
    expect(body.cancellation).toBe(false);
    expect(body.retry_budget).toBe(0);
    expect(JSON.stringify(capturedHeaders)).not.toContain("x-lens-subject-ref");
  });

  it("does not send a client-chosen subject, role, endpoint, or policy decision", async () => {
    let captured: unknown;
    const fetcher = (async (url: URL, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ ...okBody(), requestId: "req-2" }), { status: 200 });
    }) as typeof fetch;
    const client = new OrchestratorClient("http://127.0.0.1:3002", TOKEN, fetcher);

    await client.ask({
      requestId: "req-2",
      query: "hello",
      subjectRef: "server-user-2",
      sessionRef: "server-session-2",
      deviceRef: "server-device-2",
      applicationId: "lens-employee-client",
      purposeRef: "assistant",
      retrievalClass: "enterprise-grounded",
      deadlineMs: 30_000,
      retryBudget: 0,
    });

    const body = captured as Record<string, unknown>;
    for (const forbidden of ["role", "clearance", "policy_decision", "model_endpoint", "index_generation", "authorization_manifest"]) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it("rejects a non-COMPLETED response", async () => {
    const fetcher = (async (url: URL, init: RequestInit) =>
      new Response(JSON.stringify({ status: "DENIED", requestId: "req-3" }), { status: 200 })) as typeof fetch;
    const client = new OrchestratorClient("http://127.0.0.1:3002", TOKEN, fetcher);
    await expect(client.ask({
      requestId: "req-3", query: "q", subjectRef: "s", sessionRef: "s1", deviceRef: "d1",
      applicationId: "lens-employee-client", purposeRef: "assistant", retrievalClass: "enterprise-grounded",
      deadlineMs: 30_000, retryBudget: 0,
    })).rejects.toThrow(OrchestratorClientError);
  });

  it("rejects an oversized or citation-invalid response", async () => {
    const fetcher = (async (url: URL, init: RequestInit) =>
      new Response(JSON.stringify({ ...okBody(), output: "x".repeat(64_001) }), { status: 200 })) as typeof fetch;
    const client = new OrchestratorClient("http://127.0.0.1:3002", TOKEN, fetcher);
    await expect(client.ask({
      requestId: "req-4", query: "q", subjectRef: "s", sessionRef: "s1", deviceRef: "d1",
      applicationId: "lens-employee-client", purposeRef: "assistant", retrievalClass: "enterprise-grounded",
      deadlineMs: 30_000, retryBudget: 0,
    })).rejects.toThrow(/INVALID_RESPONSE/);
  });
});
