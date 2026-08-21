import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { RetrievalRequest, RetrievalResult, RetrievedContext } from "../../libs/rag-contracts";
import { RetrievalClientError, RetrievalHttpClient } from "../src/retrievalClient";

const TOKEN = "w".repeat(40);
const SERVICE_URL = "https://retrieval.platform.internal";
const NOW = Date.now();

function request(overrides: Partial<RetrievalRequest> = {}): RetrievalRequest {
  return {
    request_id: "req-1",
    turn_id: "turn-1",
    caller_workload_ref: "ai-orchestrator",
    subject_ref: "subject-1",
    session_ref: "session-1",
    device_ref: "device-1",
    application_id: "lens-employee-client",
    query_digest: `sha256:${"a".repeat(64)}`,
    query_text: "What is the remote-work stipend?",
    purpose_ref: "assistant",
    retrieval_class: "enterprise-grounded",
    corpus_ref: "enterprise-docs",
    mode: "hybrid",
    candidate_limit: 12,
    deadline_at: Date.now() + 30_000,
    cancellation: false,
    bulkhead: "interactive",
    visibility_minimum: 3,
    ...overrides,
  };
}

function contextSource(text = "The remote-work stipend is $1,500 per year."): RetrievedContext {
  return {
    document_version_ref: "policy.docx@v7",
    chunk_ref: "chunk-1",
    content_digest: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    citation_anchor: "Section 2",
    classification_ref: "internal",
    text,
  };
}

function validResult(req: RetrievalRequest, overrides: Partial<RetrievalResult & { manifest: Record<string, unknown> }> = {}): RetrievalResult {
  const source = contextSource();
  const now = Date.now();
  return {
    status: "context",
    retrieval_id: "retrieval-1",
    request_id: req.request_id,
    turn_id: req.turn_id,
    visibility_sequence: req.visibility_minimum,
    index_generation: "index:gen-1",
    context_digest: source.content_digest,
    manifest: {
      digest: source.content_digest,
      retrieved_at: NOW,
      source_revision_digest: `sha256:${"b".repeat(64)}`,
      operation_decision_ref: "decision:operation",
      candidate_decision_ref: "decision:candidates",
      policy_revision: 11,
      subject_security_revision: 5,
      resource_security_revision_digest: `sha256:${"c".repeat(64)}`,
      expires_at: Math.min(req.deadline_at - 1, now + 25_000),
      sources: [
        {
          document_version_ref: source.document_version_ref,
          chunk_ref: source.chunk_ref,
          content_digest: source.content_digest,
          citation_anchor: source.citation_anchor,
          classification_ref: source.classification_ref,
        },
      ],
    },
    sources: [source],
    ...overrides,
  } as RetrievalResult;
}

function responseFromJson(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...init.headers },
    ...init,
  });
}

function responseFromStream(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(chunks[index++]));
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function parseBody(call: readonly [RequestInfo | URL, RequestInit?]): Record<string, unknown> {
  const raw = call[1]?.body;
  if (typeof raw !== "string") throw new Error("Expected string body.");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("RetrievalHttpClient", () => {
  it("validates internal service URLs and workload token length", () => {
    expect(() => new RetrievalHttpClient("http://example.com", TOKEN)).toThrow(RetrievalClientError);
    expect(() => new RetrievalHttpClient("http://user:pass@127.0.0.1:8443", TOKEN)).toThrow(/plain HTTPS or loopback HTTP/);
    expect(() => new RetrievalHttpClient("http://127.0.0.1:8443?x=1", TOKEN)).toThrow(/plain HTTPS or loopback HTTP/);
    expect(() => new RetrievalHttpClient("http://127.0.0.1:8443/#frag", TOKEN)).toThrow(/plain HTTPS or loopback HTTP/);
    expect(() => new RetrievalHttpClient(SERVICE_URL, "too-short")).toThrow(/at least 32 characters/);
    expect(() => new RetrievalHttpClient("http://127.0.0.1:8443", TOKEN)).not.toThrow();
    expect(() => new RetrievalHttpClient("http://127.0.0.1:8443/path", TOKEN)).not.toThrow();
  });

  it("sends the expected headers and body and preserves request/turn correlation on a valid result", async () => {
    const req = request();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      responseFromJson(validResult(req)),
    );
    const client = new RetrievalHttpClient(SERVICE_URL, TOKEN, fetcher);

    const result = await client.retrieve(req, new AbortController().signal);

    expect(result).toMatchObject({
      status: "context",
      request_id: "req-1",
      turn_id: "turn-1",
      context_digest: `sha256:${createHash("sha256").update("The remote-work stipend is $1,500 per year.").digest("hex")}`,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBeInstanceOf(URL);
    expect((fetcher.mock.calls[0]?.[0] as URL).toString()).toBe(`${SERVICE_URL}/v1/retrieve`);

    const init = fetcher.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeDefined();
    expect(Object.fromEntries(new Headers(init?.headers).entries())).toMatchObject({
      "content-type": "application/json",
      accept: "application/json",
      "x-lens-caller-workload": "ai-orchestrator",
      "x-lens-orchestrator-token": TOKEN,
      "x-lens-request-id": "req-1",
    });
    expect(parseBody(fetcher.mock.calls[0]!)).toEqual(req);
  });

  it("aborts on the absolute deadline and forwards the abort signal to fetch", async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      });
    });
    const client = new RetrievalHttpClient(SERVICE_URL, TOKEN, fetcher);
    const deadlineAt = Date.now() + 20;
    const outcomePromise = client
      .retrieve(request({ deadline_at: deadlineAt }), new AbortController().signal)
      .then(
        (value) => ({ status: "fulfilled" as const, value }),
        (error) => ({ status: "rejected" as const, error }),
      );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(fetcher).toHaveBeenCalledTimes(1);
    const signal = fetcher.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeDefined();
    expect(signal?.aborted).toBe(true);
    const outcome = await outcomePromise;
    expect(outcome).toEqual({
      status: "rejected",
      error: expect.objectContaining({ code: "UNAVAILABLE", message: "Retrieval is unavailable." }),
    });
  });

  it("rejects responses that exceed the byte envelope before parsing", async () => {
    const declaredTooLarge = vi.fn(async () =>
      responseFromJson({}, { headers: { "content-length": String(256 * 1024 + 1) } }),
    );
    const client = new RetrievalHttpClient(SERVICE_URL, TOKEN, declaredTooLarge);

    await expect(client.retrieve(request(), new AbortController().signal)).rejects.toThrow(/byte envelope/);

    const streamedTooLarge = vi.fn(async () => responseFromStream(["x".repeat(200_000), "y".repeat(70_000)]));
    const streamingClient = new RetrievalHttpClient(SERVICE_URL, TOKEN, streamedTooLarge);

    await expect(streamingClient.retrieve(request(), new AbortController().signal)).rejects.toThrow(/byte envelope/);
  });

  it("fails closed on mismatched request/turn correlation, context-manifest disagreement, protected-text digest mismatch, manifest text leakage, and malformed JSON", async () => {
    const mismatchClient = new RetrievalHttpClient(
      SERVICE_URL,
      TOKEN,
      vi.fn(async () =>
        responseFromJson({
          ...validResult(request()),
          turn_id: "turn-other",
        }),
      ),
    );
    await expect(mismatchClient.retrieve(request(), new AbortController().signal)).rejects.toThrow(/invalid contract payload/);

    const manifestDigestMismatchClient = new RetrievalHttpClient(
      SERVICE_URL,
      TOKEN,
      vi.fn(async () => {
        const result = validResult(request()) as Extract<RetrievalResult, { status: "context" }>;
        return responseFromJson({
          ...result,
          manifest: { ...result.manifest, digest: `sha256:${"d".repeat(64)}` },
        });
      }),
    );
    await expect(manifestDigestMismatchClient.retrieve(request(), new AbortController().signal)).rejects.toThrow(/invalid contract payload/);

    const protectedTextMismatchClient = new RetrievalHttpClient(
      SERVICE_URL,
      TOKEN,
      vi.fn(async () => {
        const result = validResult(request()) as Extract<RetrievalResult, { status: "context" }>;
        return responseFromJson({
          ...result,
          sources: [
            {
              ...result.sources[0],
              text: "tampered text",
            },
          ],
        });
      }),
    );
    await expect(protectedTextMismatchClient.retrieve(request(), new AbortController().signal)).rejects.toThrow(/invalid contract payload/);

    const manifestTextLeakClient = new RetrievalHttpClient(
      SERVICE_URL,
      TOKEN,
      vi.fn(async () => {
        const result = validResult(request()) as Extract<RetrievalResult, { status: "context" }>;
        return responseFromJson({
          ...result,
          manifest: {
            ...result.manifest,
            sources: [
              {
                ...result.manifest.sources[0],
                text: "leaked text",
              },
            ],
          },
        });
      }),
    );
    await expect(manifestTextLeakClient.retrieve(request(), new AbortController().signal)).rejects.toThrow(/invalid contract payload/);

    const malformedJsonClient = new RetrievalHttpClient(
      SERVICE_URL,
      TOKEN,
      vi.fn(async () => new Response("{not-json", { status: 200, headers: { "content-type": "application/json" } })),
    );
    await expect(malformedJsonClient.retrieve(request(), new AbortController().signal)).rejects.toThrow(/invalid JSON/);
  });
});
