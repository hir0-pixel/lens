import { describe, expect, it } from "vitest";
import {
  DistributedAdmissionClient,
  DistributedAdmissionClientError,
  DistributedAdmissionClientOverloadedError,
} from "../src/admission/distributedAdmissionClient";

const TOKEN = "w".repeat(32);
const KEY_DIGEST = "a".repeat(64);

function request(deadlineAt = Date.now() + 5_000) {
  return {
    keyDigest: KEY_DIGEST,
    route: "/api/rag/ask",
    capacity: 60,
    refillTokens: 60,
    refillIntervalMs: 1_000,
    cost: 1,
    deadlineAt,
  };
}

describe("DistributedAdmissionClient", () => {
  it("rejects invalid origins and short tokens", () => {
    expect(() => new DistributedAdmissionClient("https://admission.internal", TOKEN)).not.toThrow();
    expect(() => new DistributedAdmissionClient("http://127.0.0.1:9443", TOKEN)).not.toThrow();
    expect(() => new DistributedAdmissionClient("https://user:pass@admission.internal", TOKEN)).toThrow(/plain HTTPS/);
    expect(() => new DistributedAdmissionClient("https://admission.internal/path", TOKEN)).toThrow(/must not include a path/);
    expect(() => new DistributedAdmissionClient("http://10.0.0.7:9443", TOKEN)).toThrow(/HTTPS or loopback HTTP only/);
    expect(() => new DistributedAdmissionClient("http://admission.internal", TOKEN)).toThrow(/HTTPS or loopback HTTP only/);
    expect(() => new DistributedAdmissionClient("https://admission.internal", "short")).toThrow(/at least 32/);
  });

  it("sends the exact bounded request body and workload header", async () => {
    let capturedUrl: URL | undefined;
    let capturedInit: RequestInit | undefined;
    const now = 1_000_000;
    const fetcher = (async (url: URL, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(
        JSON.stringify({ allowed: true, remaining: 59, retry_after_ms: 0 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const client = new DistributedAdmissionClient(
      "https://admission.internal",
      TOKEN,
      fetcher,
      () => now,
    );

    const result = await client.check(request(now + 4_000));
    expect(result).toEqual({ allowed: true, remaining: 59, retryAfterMs: 0 });

    expect(String(capturedUrl)).toBe("https://admission.internal/v1/admission/check");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toEqual({
      "content-type": "application/json",
      accept: "application/json",
      "x-lens-workload-token": TOKEN,
    });
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      key_digest: KEY_DIGEST,
      route: "/api/rag/ask",
      capacity: 60,
      refill_tokens: 60,
      refill_interval_ms: 1_000,
      cost: 1,
      deadline_at: now + 4_000,
    });
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns allow and deny decisions with validated counters", async () => {
    const allowFetcher = (async () =>
      new Response(JSON.stringify({ allowed: true, remaining: 12, retry_after_ms: 0 }), { status: 200 })) as typeof fetch;
    const denyFetcher = (async () =>
      new Response(JSON.stringify({ allowed: false, remaining: 0, retry_after_ms: 250 }), { status: 200 })) as typeof fetch;

    const allowClient = new DistributedAdmissionClient("https://admission.internal", TOKEN, allowFetcher);
    const denyClient = new DistributedAdmissionClient("https://admission.internal", TOKEN, denyFetcher);

    await expect(allowClient.check(request())).resolves.toEqual({
      allowed: true,
      remaining: 12,
      retryAfterMs: 0,
    });
    await expect(denyClient.check(request())).resolves.toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: 250,
    });
  });

  it("rejects malformed and oversized responses", async () => {
    const malformedFetcher = (async () =>
      new Response(JSON.stringify({ allowed: "yes", remaining: -1, retry_after_ms: 0 }), { status: 200 })) as typeof fetch;
    const oversizedFetcher = (async () =>
      new Response(`{"allowed":true,"remaining":1,"retry_after_ms":0,"pad":"${"x".repeat(9_000)}"}`, {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    const malformedClient = new DistributedAdmissionClient("https://admission.internal", TOKEN, malformedFetcher);
    const oversizedClient = new DistributedAdmissionClient("https://admission.internal", TOKEN, oversizedFetcher);

    await expect(malformedClient.check(request())).rejects.toThrow(/INVALID_RESPONSE/);
    await expect(oversizedClient.check(request())).rejects.toThrow(/RESPONSE_TOO_LARGE/);
  });

  it("maps timeout and abort to unavailable", async () => {
    const fetcher = (async (url: URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        }, { once: true });
      })) as typeof fetch;

    const client = new DistributedAdmissionClient(
      "https://admission.internal",
      TOKEN,
      fetcher,
      () => 10_000,
    );

    await expect(client.check(request(10_100))).rejects.toThrow(DistributedAdmissionClientError);
    await expect(client.check(request(10_100))).rejects.toThrow(/UNAVAILABLE/);
  });

  it("makes exactly one fetch and surfaces overload on 429", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return new Response("", { status: 429 });
    }) as typeof fetch;

    const client = new DistributedAdmissionClient("https://admission.internal", TOKEN, fetcher);
    await expect(client.check(request())).rejects.toThrow(DistributedAdmissionClientOverloadedError);
    expect(calls).toBe(1);
  });

  it("does not multiply aggregate admission budget across clients sharing one authority", async () => {
    const aggregateCapacity = 3;
    let consumed = 0;
    const fetcher = (async (_url: URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.capacity).toBe(aggregateCapacity);
      expect(body.cost).toBe(1);

      if (consumed < aggregateCapacity) {
        consumed += 1;
        return new Response(
          JSON.stringify({
            allowed: true,
            remaining: aggregateCapacity - consumed,
            retry_after_ms: 0,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ allowed: false, remaining: 0, retry_after_ms: 1_000 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const clients = [
      new DistributedAdmissionClient("https://admission.internal", TOKEN, fetcher),
      new DistributedAdmissionClient("https://admission.internal", TOKEN, fetcher),
      new DistributedAdmissionClient("https://admission.internal", TOKEN, fetcher),
    ];

    const results = await Promise.all(
      clients.flatMap((client) =>
        [0, 1].map(() => client.check({ ...request(), capacity: aggregateCapacity })),
      ),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(aggregateCapacity);
    expect(results.filter((result) => !result.allowed)).toHaveLength(3);
    expect(consumed).toBe(aggregateCapacity);
  });
});
