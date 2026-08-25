import { describe, expect, it, vi } from "vitest";
import { AuthorityClientConfigError, AuthorityHttpClient } from "../src/authorityClient";

const SERVICE_URL = "https://authority.platform.internal";
const TOKEN = "w".repeat(40);
const DIGEST = `sha256:${"a".repeat(64)}` as const;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...init.headers },
    ...init,
  });
}

function parseBody(call: readonly [RequestInfo | URL, RequestInit?]): Record<string, unknown> {
  const rawBody = call[1]?.body;
  if (typeof rawBody !== "string") throw new Error("Expected request body to be a string.");
  return JSON.parse(rawBody) as Record<string, unknown>;
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe("AuthorityHttpClient", () => {
  it("rejects public origins, URL-embedded credentials/path/query fragments, and short tokens", () => {
    expect(() => new AuthorityHttpClient("http://example.com", TOKEN)).toThrow(AuthorityClientConfigError);
    expect(() => new AuthorityHttpClient("https://user:pass@authority.platform.internal", TOKEN)).toThrow(/plain internal origin/);
    expect(() => new AuthorityHttpClient("https://authority.platform.internal/path", TOKEN)).toThrow(/plain internal origin/);
    expect(() => new AuthorityHttpClient("https://authority.platform.internal?x=1", TOKEN)).toThrow(/plain internal origin/);
    expect(() => new AuthorityHttpClient("https://authority.platform.internal/#frag", TOKEN)).toThrow(/plain internal origin/);
    expect(() => new AuthorityHttpClient(SERVICE_URL, "too-short")).toThrow(/at least 32 characters/);
    expect(() => new AuthorityHttpClient(SERVICE_URL, TOKEN)).not.toThrow();
    expect(() => new AuthorityHttpClient("http://127.0.0.1:8789", TOKEN)).not.toThrow();
  });

  it("posts generation context fence revalidation with workload identity headers and validates the receipt", async () => {
    const expiresAt = Date.now() + 30_000;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({
        request_id: "req-1",
        turn_id: "turn-1",
        boundary: "generation_start",
        fence_ref: "fence-1",
        context_digest: DIGEST,
        expires_at: expiresAt - 1,
        checked_at: Date.now(),
      }),
    );
    const client = new AuthorityHttpClient(SERVICE_URL, TOKEN, fetcher);

    await expect(
      client.revalidate(
        {
          requestId: "req-1",
          turnId: "turn-1",
          subjectRef: "subject-1",
          deviceRef: "device-1",
          sessionRef: "session-1",
          contextDigest: DIGEST,
          manifestExpiresAt: expiresAt,
          boundary: "generation_start",
          resourceRefs: ["resource-1"],
          indexGeneration: "index:1",
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      fenceRef: "fence-1",
      contextDigest: DIGEST,
      expiresAt: expiresAt - 1,
      checkedAt: expect.any(Number),
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((fetcher.mock.calls[0]?.[0] as URL).toString()).toBe(`${SERVICE_URL}/v1/generation-context-fences/revalidate`);
    expect(Object.fromEntries(new Headers(fetcher.mock.calls[0]?.[1]?.headers).entries())).toMatchObject({
      "content-type": "application/json",
      accept: "application/json",
      "x-lens-caller-workload": "ai-orchestrator",
      "x-lens-authority-token": TOKEN,
      "x-lens-request-id": "req-1",
    });
    expect(parseBody(fetcher.mock.calls[0]!)).toMatchObject({
      request_id: "req-1",
      turn_id: "turn-1",
      subject_ref: "subject-1",
      device_ref: "device-1",
      session_ref: "session-1",
      context_digest: DIGEST,
      boundary: "generation_start",
      resource_refs: ["resource-1"],
      index_generation: "index:1",
    });
  });

  it("posts RAG profile lineage with audit admissions and validates its echoed receipt", async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      kind: "generation",
      request_id: "req-1",
      turn_id: "turn-1",
      input_digest: DIGEST,
      rag_profile_version: 7,
      rag_profile_digest: DIGEST,
      receipt_digest: DIGEST,
    }));
    const client = new AuthorityHttpClient(SERVICE_URL, TOKEN, fetcher);

    await expect(client.admit({
      kind: "generation",
      requestId: "req-1",
      turnId: "turn-1",
      inputDigest: DIGEST,
      ragProfileVersion: 7,
      ragProfileDigest: DIGEST,
    }, new AbortController().signal)).resolves.toEqual({ receiptDigest: DIGEST });

    expect(parseBody(fetcher.mock.calls[0]!)).toMatchObject({
      rag_profile_version: 7,
      rag_profile_digest: DIGEST,
    });
  });

  it("maps authority overload and forbidden status responses to orchestrator failure codes without retrying", async () => {
    const overloaded = new AuthorityHttpClient(
      SERVICE_URL,
      TOKEN,
      vi.fn(async () => new Response(null, { status: 429 })),
    );
    await expectCode(
      overloaded.admit(
        {
          kind: "generation",
          requestId: "req-1",
          turnId: "turn-1",
          inputDigest: DIGEST,
          ragProfileVersion: 7,
          ragProfileDigest: DIGEST,
        },
        new AbortController().signal,
      ),
      "OVERLOADED",
    );

    const forbidden = new AuthorityHttpClient(
      SERVICE_URL,
      TOKEN,
      vi.fn(async () => new Response(null, { status: 412 })),
    );
    await expectCode(
      forbidden.authorize(
        {
          requestId: "req-1",
          subjectRef: "subject-1",
          outputRef: "output-1",
          outputDigest: DIGEST,
          classificationRef: "internal",
          disclosureReservationRef: "reservation-1",
        },
        new AbortController().signal,
      ),
      "FORBIDDEN",
    );
  });

  it("fails closed on malformed, oversized, and mismatched authority responses", async () => {
    const malformed = new AuthorityHttpClient(
      SERVICE_URL,
      TOKEN,
      vi.fn(async () => new Response("{not-json", { status: 200, headers: { "content-type": "application/json" } })),
    );
    await expect(malformed.verifyBlob({ outputRef: "output-1", outputDigest: DIGEST }, new AbortController().signal)).rejects.toThrow(
      /invalid JSON/,
    );

    const oversized = new AuthorityHttpClient(
      SERVICE_URL,
      TOKEN,
      vi.fn(async () => jsonResponse({}, { headers: { "content-length": String(256 * 1024 + 1) } })),
    );
    await expect(oversized.verifyBlob({ outputRef: "output-1", outputDigest: DIGEST }, new AbortController().signal)).rejects.toThrow(
      /byte envelope/,
    );

    const mismatch = new AuthorityHttpClient(
      SERVICE_URL,
      TOKEN,
      vi.fn(async () =>
        jsonResponse({
          output_ref: "other-output",
          output_digest: DIGEST,
          verified: true,
        }),
      ),
    );
    await expectCode(mismatch.verifyBlob({ outputRef: "output-1", outputDigest: DIGEST }, new AbortController().signal), "DEPENDENCY_UNAVAILABLE");
  });

  it("maps caller cancellation to CANCELLED", async () => {
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
    const client = new AuthorityHttpClient(SERVICE_URL, TOKEN, fetcher);
    const controller = new AbortController();
    const promise = client.admit(
      {
        kind: "release",
        requestId: "req-1",
        turnId: "turn-1",
        inputDigest: DIGEST,
        ragProfileVersion: 7,
        ragProfileDigest: DIGEST,
      },
      controller.signal,
    );

    controller.abort();

    await expectCode(promise, "CANCELLED");
  });
});
