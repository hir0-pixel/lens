import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createRetrievalHttp, MAX_QUERY_TEXT_UTF8_BYTES, type RetrievalHttp } from "../src/http";
import { RetrievalService, type RetrievalPdpPort, type RetrievalIndexPort, type AuthorizedContentPort, type RetrievalAuditPort, type PublicationPort, type RetrievalCandidate } from "../../services/retrieval/RetrievalService";

const token = "w".repeat(40);
const queryText = "What is the remote-work stipend?";

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function buildService() {
  const pdp: RetrievalPdpPort = {
    authorizeOperation: () => ({ allowed: true, decisionRef: "decision:op", policyRevision: 1 }),
    authorizeBatch: () => ({
      allowedRefs: ["version-a"],
      decisionRef: "decision:batch",
      fence: "signed:fence-1",
      revisionDigest: "revisions",
      policyRevision: 1,
      subjectSecurityRevision: 1,
      resourceSecurityRevisionDigest: "sha256:resources",
    }),
  };
  const indexes: RetrievalIndexPort = {
    search: (input) => ({
      indexGeneration: input.indexGeneration,
      visibilitySequence: input.visibilitySequence,
      sourceRevisionDigest: input.sourceRevisionDigest,
      candidates: [candidate("version-a", "chunk-a", 1)],
    }),
  };
  const content: AuthorizedContentPort = {
    fetch: () => [
      { resourceRef: "resource:version-a", versionRef: "version-a", chunkRef: "chunk-a", contentHash: "sha256:chunk-a", text: "alpha", citationAnchor: "doc-a" },
    ],
  };
  const audit: RetrievalAuditPort = { admit: () => ({ receipt: "receipt:1" }) };
  const publication: PublicationPort = {
    activeGeneration: () => ({ indexGeneration: "index:gen1", visibilitySequence: 1, sourceRevisionDigest: "sha256:source-1" }),
  };
  return new RetrievalService(pdp, indexes, content, audit, publication);
}

function candidate(versionRef: string, chunkRef: string, rank: number): RetrievalCandidate {
  return { resourceRef: `resource:${versionRef}`, versionRef, chunkRef, contentHash: `sha256:${chunkRef}`, lane: "lexical", rank, classificationRef: "internal" };
}

const validBody = {
  request_id: "req-1",
  turn_id: "turn-1",
  caller_workload_ref: "ai-orchestrator",
  subject_ref: "subject-1",
  session_ref: "session-1",
  device_ref: "device-1",
  application_id: "lens-employee-client",
  query_digest: sha256(queryText),
  query_text: queryText,
  purpose_ref: "purpose-1",
  retrieval_class: "enterprise-grounded",
  corpus_ref: "corpus-1",
  mode: "hybrid",
  candidate_limit: 100,
  deadline_at: Date.now() + 60_000,
  cancellation: false,
  bulkhead: "interactive",
  visibility_minimum: 1,
};

describe("retrieval HTTP ingress", () => {
  let http: RetrievalHttp;
  let base: string;

  beforeEach(async () => {
    http = createRetrievalHttp({ service: buildService(), workloadToken: token });
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
      headers: { "content-type": "application/json", "x-lens-orchestrator-token": token, "x-lens-caller-workload": "ai-orchestrator", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("rejects requests without an attested orchestrator workload", async () => {
    const res = await fetch(`${base}/v1/retrieve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(validBody) });
    expect(res.status).toBe(401);
  });

  it("rejects requests with a wrong token", async () => {
    const res = await post("/v1/retrieve", validBody, { "x-lens-orchestrator-token": "x".repeat(40) });
    expect(res.status).toBe(401);
  });

  it("serves liveness and readiness probes", async () => {
    const live = await fetch(`${base}/livez`);
    expect(live.status).toBe(200);
    const ready = await fetch(`${base}/readyz`);
    expect(ready.status).toBe(200);
  });

  it("returns 503 on readiness probe while not ready", async () => {
    http.setReadiness(false);
    const ready = await fetch(`${base}/readyz`);
    expect(ready.status).toBe(503);
    http.setReadiness(true);
  });

  it("returns 404 for unknown routes", async () => {
    const res = await post("/v1/other", validBody);
    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed body", async () => {
    const res = await post("/v1/retrieve", "not-json{");
    expect(res.status).toBe(400);
  });

  it("returns 400 for a request missing required fields", async () => {
    const { request_id, ...missing } = validBody;
    const res = await post("/v1/retrieve", missing);
    expect(res.status).toBe(400);
  });

  it("rejects digest mismatch before invoking retrieval dependencies", async () => {
    let called = false;
    const service = {
      retrieve: async () => {
        called = true;
        return { status: "no_context" as const };
      },
    } as never;
    const guarded = createRetrievalHttp({ service, workloadToken: token });
    await guarded.listen(0, "127.0.0.1");
    const { port } = guarded.server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/v1/retrieve`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lens-orchestrator-token": token, "x-lens-caller-workload": "ai-orchestrator" },
      body: JSON.stringify({ ...validBody, query_digest: `sha256:${"b".repeat(64)}` }),
    });
    expect(res.status).toBe(400);
    expect(called).toBe(false);
    await guarded.close();
  });

  it("rejects a multibyte query over the UTF-8 byte cap before invoking retrieval dependencies", async () => {
    let called = false;
    const service = {
      retrieve: async () => {
        called = true;
        return { status: "no_context" as const };
      },
    } as never;
    const guarded = createRetrievalHttp({ service, workloadToken: token, maxBodyBytes: 64 * 1024 });
    await guarded.listen(0, "127.0.0.1");
    const { port } = guarded.server.address() as AddressInfo;
    const oversized = "😀".repeat(Math.floor(MAX_QUERY_TEXT_UTF8_BYTES / 4) + 1);
    const res = await fetch(`http://127.0.0.1:${port}/v1/retrieve`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lens-orchestrator-token": token, "x-lens-caller-workload": "ai-orchestrator" },
      body: JSON.stringify({ ...validBody, query_text: oversized, query_digest: sha256(oversized) }),
    });
    expect(res.status).toBe(400);
    expect(called).toBe(false);
    await guarded.close();
  });

  it("returns 413 when the body exceeds the payload bound", async () => {
    const res = await post("/v1/retrieve", "x".repeat(49 * 1024));
    expect(res.status).toBe(413);
  });

  it("returns 429 when request capacity is exhausted", async () => {
    const overloaded = createRetrievalHttp({ service: buildService(), workloadToken: token, maxActiveRequests: 1 });
    await overloaded.listen(0, "127.0.0.1");
    const { port } = overloaded.server.address() as AddressInfo;
    // Occupy the single slot with a connection that never finishes its body.
    const net = await import("node:net");
    const socket = net.connect(port, "127.0.0.1");
    socket.write(`POST /v1/retrieve HTTP/1.1\r\nHost: 127.0.0.1\r\ncontent-type: application/json\r\nx-lens-orchestrator-token: ${token}\r\nx-lens-caller-workload: ai-orchestrator\r\ncontent-length: 1000\r\n\r\npartial`);
    await new Promise<void>((r) => setTimeout(r, 50));
    const res = await fetch(`http://127.0.0.1:${port}/v1/retrieve`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lens-orchestrator-token": token, "x-lens-caller-workload": "ai-orchestrator" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(429);
    socket.destroy();
    await overloaded.close();
  });

  it("returns 503 DRAINING to new work while draining with in-flight requests", async () => {
    const net = await import("node:net");
    const { port } = http.server.address() as AddressInfo;
    // Open an in-flight request that never completes its body, holding one slot.
    const inflight = net.connect(port, "127.0.0.1");
    await new Promise<void>((r) => inflight.on("connect", r));
    inflight.write(`POST /v1/retrieve HTTP/1.1\r\nHost: h\r\ncontent-type: application/json\r\nx-lens-orchestrator-token: ${token}\r\nx-lens-caller-workload: ai-orchestrator\r\ncontent-length: 1000\r\n\r\npartial`);
    await new Promise<void>((r) => setTimeout(r, 50));

    // Drain begins while a request is still in flight: listener stays open,
    // new work is rejected with 503 DRAINING.
    const draining = http.close();
    const res = await post("/v1/retrieve", validBody);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("DRAINING");

    // Release the in-flight request; drain completes once active reaches zero.
    inflight.destroy();
    await draining;
  });

  it("round-trips a valid retrieve request to a context result", async () => {
    const res = await post("/v1/retrieve", validBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status?: string; manifest?: unknown; sources?: unknown[] };
    expect(body.status).toBe("context");
    expect(body.manifest).toBeDefined();
    expect(body.sources).toHaveLength(1);
  });
});
