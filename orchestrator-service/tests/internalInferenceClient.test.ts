import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { InternalInferenceClient } from "../src/internalInferenceClient";

const SERVICE_URL = "http://127.0.0.1:8443";
const TOKEN = "w".repeat(40);
const REQUEST_DIGEST = `sha256:${createHash("sha256").update("request").digest("hex")}`;
const OUTPUT = "generated answer";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...init.headers },
    ...init,
  });
}

function parseBody(call: readonly [RequestInfo | URL, RequestInit?]) {
  const init = call[1];
  const rawBody = init?.body;
  if (typeof rawBody !== "string") {
    throw new Error("Expected request body to be a string.");
  }
  return JSON.parse(rawBody) as Record<string, unknown>;
}

describe("InternalInferenceClient", () => {
  it("rejects public HTTP/config credentials/path/query origins and short tokens", () => {
    expect(() => new InternalInferenceClient("http://example.com", TOKEN)).toThrow(/HTTPS or loopback HTTP/);
    expect(() => new InternalInferenceClient("http://user:pass@127.0.0.1:8443", TOKEN)).toThrow(/plain internal origin/);
    expect(() => new InternalInferenceClient("http://127.0.0.1:8443/path", TOKEN)).toThrow(/plain internal origin/);
    expect(() => new InternalInferenceClient("http://127.0.0.1:8443?x=1", TOKEN)).toThrow(/plain internal origin/);
    expect(() => new InternalInferenceClient("http://127.0.0.1:8443/#frag", TOKEN)).toThrow(/plain internal origin/);
    expect(() => new InternalInferenceClient(SERVICE_URL, "too-short")).toThrow(/at least 32 characters/);
  });

  it("reserves a request, correlates the reservation response, and fails closed on 429 without retrying", async () => {
    const fetcher = vi
      .fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse({
          reservation_id: "reservation-1",
          request_digest: REQUEST_DIGEST,
          endpoint_ref: "internal-model:sha256:1111",
          fence: 7,
          expires_at: Date.now() + 30_000,
          lease_token: "ar1." + "a".repeat(40) + "." + "b".repeat(40),
          endpoint_generation: "gen-1",
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 429 }));

    const client = new InternalInferenceClient(SERVICE_URL, TOKEN, fetcher);

    const reservation = await client.reserve({
      reservationId: "reservation-1",
      requestId: "request-1",
      turnId: "turn-1",
      stepId: "step-1",
      requestDigest: REQUEST_DIGEST,
      modelRef: "model-default",
      artifactDigest: `sha256:${"1".repeat(64)}`,
      endpointRef: "internal-model:sha256:1111",
      endpointGeneration: "gen-1",
      expiresAt: Date.now() + 30_000,
    });

    expect(reservation).toEqual({
      reservationId: "reservation-1",
      requestDigest: REQUEST_DIGEST,
      endpointRef: "internal-model:sha256:1111",
      endpointGeneration: "gen-1",
      fence: 7,
      expiresAt: expect.any(Number),
      leaseToken: expect.any(String),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(parseBody(fetcher.mock.calls[0]!)).toEqual({
      reservation_id: "reservation-1",
      request_id: "request-1",
      turn_id: "turn-1",
      step_id: "step-1",
      request_digest: REQUEST_DIGEST,
      model_ref: "model-default",
      artifact_digest: `sha256:${"1".repeat(64)}`,
      endpoint_ref: "internal-model:sha256:1111",
      endpoint_generation: "gen-1",
      expires_at: expect.any(Number),
    });

    await expect(
      client.reserve({
        reservationId: "reservation-2",
        requestId: "request-1",
        turnId: "turn-1",
        stepId: "step-2",
        requestDigest: REQUEST_DIGEST,
        modelRef: "model-default",
        artifactDigest: `sha256:${"1".repeat(64)}`,
        endpointRef: "internal-model:sha256:2222",
        endpointGeneration: "gen-1",
        expiresAt: Date.now() + 30_000,
      }),
    ).rejects.toThrow("OVERLOADED");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("executes with an opaque endpoint ref and validates the matching receipt fence and scope", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({
        output: OUTPUT,
        receipt: {
          reservation_id: "reservation-9",
          fence: 19,
          scope_id: "scope:subject-1",
          schema_version: 1,
          request_id: "request-9",
          turn_id: "turn-9",
          step_id: "step-9",
          artifact_digest: "sha256:0000000000000000000000000000000000000000000000000000000000000009",
          endpoint_generation: "gen-9",
          usage_event_id: "usage-1",
          measured_units: 31,
          terminal: "completed",
          usage_signature: "signed-usage-token",
        },
      }),
    );
    const client = new InternalInferenceClient(SERVICE_URL, TOKEN, fetcher);

    const result = await client.execute(
      {
        reservationId: "reservation-9",
        fence: 19,
        endpointRef: "internal-model:sha256:opaque",
        scopeId: "scope:subject-1",
        deadlineAt: Date.now() + 30_000,
        chunks: ["prompt", "context"],
      },
      new AbortController().signal,
    );

    expect(result).toEqual({
      output: OUTPUT,
      receipt: {
        schemaVersion: 1,
        reservationId: "reservation-9",
        requestId: "request-9",
        turnId: "turn-9",
        stepId: "step-9",
        fence: 19,
        artifactDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000009",
        endpointGeneration: "gen-9",
        usageEventId: "usage-1",
        measuredUnits: 31,
        terminal: "completed",
        usageSignature: "signed-usage-token",
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(parseBody(fetcher.mock.calls[0]!)).toEqual({
      reservation_id: "reservation-9",
      fence: 19,
      endpoint_ref: "internal-model:sha256:opaque",
      endpoint_generation: undefined,
      request_digest: undefined,
      lease_token: undefined,
      scope_id: "scope:subject-1",
      deadline_at: expect.any(Number),
      chunks: ["prompt", "context"],
    });
  });

  it("fails closed on mismatched, malformed, and oversized responses", async () => {
    const mismatchFetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({
        reservation_id: "reservation-1",
        request_digest: REQUEST_DIGEST,
        endpoint_ref: "internal-model:sha256:1111",
        fence: 0,
        expires_at: Date.now() + 30_000,
      }),
    );
    const mismatchClient = new InternalInferenceClient(SERVICE_URL, TOKEN, mismatchFetcher);
    await expect(
      mismatchClient.reserve({
        reservationId: "reservation-1",
        requestId: "request-1",
        turnId: "turn-1",
        stepId: "step-1",
        requestDigest: REQUEST_DIGEST,
        modelRef: "model-default",
        artifactDigest: `sha256:${"1".repeat(64)}`,
        endpointRef: "internal-model:sha256:1111",
        endpointGeneration: "gen-1",
        expiresAt: Date.now() + 30_000,
      }),
    ).rejects.toThrow("DEPENDENCY_UNAVAILABLE");

    const scopeMismatchFetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({
        output: OUTPUT,
        receipt: {
          reservation_id: "reservation-9",
          fence: 19,
          scope_id: "scope:other",
          usage_event_id: "usage-1",
          generated_tokens: 31,
          terminal: "completed",
        },
      }),
    );
    const scopeMismatchClient = new InternalInferenceClient(SERVICE_URL, TOKEN, scopeMismatchFetcher);
    await expect(
      scopeMismatchClient.execute(
        {
          reservationId: "reservation-9",
          fence: 19,
          endpointRef: "internal-model:sha256:opaque",
          scopeId: "scope:subject-1",
          deadlineAt: Date.now() + 30_000,
          chunks: ["prompt"],
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("DEPENDENCY_UNAVAILABLE");

    const oversizedFetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({
        output: "x".repeat(64 * 1024 + 1),
        receipt: {
          reservation_id: "reservation-9",
          fence: 19,
          scope_id: "scope:subject-1",
          usage_event_id: "usage-1",
          generated_tokens: 31,
          terminal: "completed",
        },
      }),
    );
    const oversizedClient = new InternalInferenceClient(SERVICE_URL, TOKEN, oversizedFetcher);
    await expect(
      oversizedClient.execute(
        {
          reservationId: "reservation-9",
          fence: 19,
          endpointRef: "internal-model:sha256:opaque",
          scopeId: "scope:subject-1",
          deadlineAt: Date.now() + 30_000,
          chunks: ["prompt"],
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("DEPENDENCY_UNAVAILABLE");
  });

  it("maps cancellation to CANCELLED", async () => {
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
    const client = new InternalInferenceClient(SERVICE_URL, TOKEN, fetcher);
    const controller = new AbortController();
    const promise = client.execute(
      {
        reservationId: "reservation-9",
        fence: 19,
        endpointRef: "internal-model:sha256:opaque",
        scopeId: "scope:subject-1",
        deadlineAt: Date.now() + 30_000,
        chunks: ["prompt"],
      },
      controller.signal,
    );

    controller.abort();

    await expect(promise).rejects.toThrow("CANCELLED");
  });

  it("assembles bounded NDJSON generation without buffering an unbounded body", async () => {
    const fetcher = vi.fn(async () => new Response(
      `{"delta":"hel"}\n{"delta":"lo"}\n{"done":true,"receipt":{"reservation_id":"reservation-9","fence":19,"scope_id":"scope:subject-1","schema_version":1,"request_id":"request-9","turn_id":"turn-9","step_id":"step-9","artifact_digest":"sha256:0000000000000000000000000000000000000000000000000000000000000009","endpoint_generation":"gen-9","usage_event_id":"u1","measured_units":2,"terminal":"completed","usage_signature":"signed-usage-token"}}\n`,
      { status: 200, headers: { "content-type": "application/x-ndjson" } },
    ));
    const client = new InternalInferenceClient(SERVICE_URL, TOKEN, fetcher);
    const result = await client.execute({
      reservationId: "reservation-9",
      fence: 19,
      endpointRef: "internal-model:sha256:opaque",
      scopeId: "scope:subject-1",
      deadlineAt: Date.now() + 30_000,
      chunks: ["prompt"],
    }, new AbortController().signal);
    expect(result.output).toBe("hello");
    expect(result.receipt.measuredUnits).toBe(2);
  });
});
