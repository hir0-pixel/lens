import { describe, expect, it, vi } from "vitest";
import {
  createRetrievalDependencyClients,
  RetrievalDependencyClientError,
  type RetrievalDependencyClientConfig,
} from "../src/adapters";
import { main } from "../src/main";

const TOKEN = "s".repeat(40);
const BASE = "https://authority.platform.internal";

function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...init.headers },
    ...init,
  });
}

function config(fetcher: typeof fetch): RetrievalDependencyClientConfig {
  const options = { baseUrl: BASE, credential: TOKEN, fetcher };
  return {
    pdp: options,
    index: options,
    content: options,
    audit: options,
    publication: options,
  };
}

describe("retrieval production dependency adapters", () => {
  it("rejects missing production config before the service starts", async () => {
    await expect(main({
      WORKLOAD_TOKEN: TOKEN,
      PDP_URL: "",
      PDP_WORKLOAD_TOKEN: TOKEN,
      INDEX_URL: BASE,
      INDEX_WORKLOAD_TOKEN: TOKEN,
      CONTENT_URL: BASE,
      CONTENT_WORKLOAD_TOKEN: TOKEN,
      AUDIT_URL: BASE,
      AUDIT_WORKLOAD_TOKEN: TOKEN,
      PUBLICATION_URL: BASE,
      PUBLICATION_WORKLOAD_TOKEN: TOKEN,
      NODE_ENV: "production",
    })).rejects.toThrow(/LENS_RETRIEVAL_PDP_URL is required/);
  });

  it("requires HTTPS internal endpoints unless injected test options explicitly enable loopback HTTP", () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(() => createRetrievalDependencyClients(config(fetcher))).not.toThrow();
    expect(() => createRetrievalDependencyClients({
      ...config(fetcher),
      index: { baseUrl: "https://fcbad.com", credential: TOKEN, fetcher },
    })).toThrow(RetrievalDependencyClientError);
    expect(() => createRetrievalDependencyClients({
      ...config(fetcher),
      index: { baseUrl: "http://search.platform.internal", credential: TOKEN, fetcher },
    })).toThrow(RetrievalDependencyClientError);
    expect(() => createRetrievalDependencyClients({
      ...config(fetcher),
      index: { baseUrl: "http://127.0.0.1:9000", credential: TOKEN, fetcher, allowLoopbackHttp: true },
    })).not.toThrow();
  });

  it("does not allow production startup to enable loopback HTTP with env alone", async () => {
    const env = {
      PORT: "0",
      HOST: "127.0.0.1",
      WORKLOAD_TOKEN: TOKEN,
      PDP_URL: "http://127.0.0.1:9101",
      PDP_WORKLOAD_TOKEN: TOKEN,
      INDEX_URL: "http://127.0.0.1:9102",
      INDEX_WORKLOAD_TOKEN: TOKEN,
      CONTENT_URL: "http://127.0.0.1:9103",
      CONTENT_WORKLOAD_TOKEN: TOKEN,
      AUDIT_URL: "http://127.0.0.1:9104",
      AUDIT_WORKLOAD_TOKEN: TOKEN,
      PUBLICATION_URL: "http://127.0.0.1:9105",
      PUBLICATION_WORKLOAD_TOKEN: TOKEN,
      NODE_ENV: "production",
      ALLOW_LOOPBACK_HTTP: "true",
    };
    await expect(main(env)).rejects.toThrow(/HTTPS on an internal hostname/);
  });

  it("sends raw query only in the configured search JSON body", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({
      indexGeneration: "index:gen1",
      visibilitySequence: 7,
      sourceRevisionDigest: `sha256:${"c".repeat(64)}`,
      candidates: [
        {
          resourceRef: "resource:v1",
          versionRef: "v1",
          chunkRef: "c1",
          contentHash: `sha256:${"a".repeat(64)}`,
          lane: "lexical",
          rank: 1,
          classificationRef: "internal",
        },
      ],
    }));
    const clients = createRetrievalDependencyClients(config(fetcher));
    const queryText = "Sensitive internal policy question";

    const result = await clients.index.search({
      mode: "hybrid",
      queryDigest: `sha256:${"b".repeat(64)}`,
      queryText,
      corpusRef: "enterprise-docs",
      indexGeneration: "index:gen1",
      visibilitySequence: 7,
      sourceRevisionDigest: `sha256:${"c".repeat(64)}`,
      laneLimit: 10,
      deadlineAt: Date.now() + 30_000,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      indexGeneration: "index:gen1",
      visibilitySequence: 7,
      sourceRevisionDigest: `sha256:${"c".repeat(64)}`,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect((url as URL).toString()).toBe(`${BASE}/v1/search`);
    expect((url as URL).toString()).not.toContain(queryText);
    expect(init?.redirect).toBe("error");
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    expect(JSON.stringify(headers)).not.toContain(queryText);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      query_text: queryText,
      index_generation: "index:gen1",
      visibility_sequence: 7,
    });
  });

  it("fails closed on bounded response and invalid response shapes", async () => {
    const tooLarge = vi.fn<typeof fetch>(async () => response({}, { headers: { "content-length": String(256 * 1024 + 1) } }));
    const oversized = createRetrievalDependencyClients(config(tooLarge));
    await expect(oversized.index.search({
      mode: "hybrid",
      queryDigest: `sha256:${"b".repeat(64)}`,
      queryText: "query",
      corpusRef: "enterprise-docs",
      indexGeneration: "index:gen1",
      visibilitySequence: 7,
      sourceRevisionDigest: `sha256:${"c".repeat(64)}`,
      laneLimit: 10,
      deadlineAt: Date.now() + 30_000,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

    const invalid = vi.fn<typeof fetch>(async () => response({ indexGeneration: "index:gen1", visibilitySequence: 7, sourceRevisionDigest: `sha256:${"c".repeat(64)}`, candidates: [{ versionRef: "missing-required-fields" }] }));
    const malformed = createRetrievalDependencyClients(config(invalid));
    await expect(malformed.index.search({
      mode: "hybrid",
      queryDigest: `sha256:${"b".repeat(64)}`,
      queryText: "query",
      corpusRef: "enterprise-docs",
      indexGeneration: "index:gen1",
      visibilitySequence: 7,
      sourceRevisionDigest: `sha256:${"c".repeat(64)}`,
      laneLimit: 10,
      deadlineAt: Date.now() + 30_000,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("propagates cancellation into dependency fetch calls", async () => {
    const fetcher = vi.fn<typeof fetch>((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }),
    );
    const clients = createRetrievalDependencyClients(config(fetcher));
    const controller = new AbortController();
    const pending = clients.publication.activeGeneration({
      corpusRef: "enterprise-docs",
      deadlineAt: Date.now() + 30_000,
      signal: controller.signal,
    });

    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});
