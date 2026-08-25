import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthClient } from "../../src/shared/bff-auth";

describe("bff RAG UI client", () => {
  afterEach(() => {
    document.cookie =
      "lens_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    vi.restoreAllMocks();
  });

  it("uses the authenticated RAG endpoint with cookies and CSRF, never the legacy generation endpoint", async () => {
    document.cookie = "lens_csrf=csrf-token; path=/";
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ authenticated: true, subject: "user-1" }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: "Use the employee handbook.",
            citations: [{ source: "Employee Handbook", section: "4.2" }],
            conversationRef: "c1.opaque-reference",
          }),
          { status: 200 },
        ),
      );

    const client = createAuthClient({ baseUrl: "", fetcher });
    await expect(client.askRag("Where is the vacation policy?")).resolves.toEqual({
      output: "Use the employee handbook.",
      citations: [{ source: "Employee Handbook", section: "4.2" }],
      conversationRef: "c1.opaque-reference",
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/session",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/rag/ask",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          "content-type": "application/json",
          accept: "application/json",
          "x-lens-csrf": "csrf-token",
        }),
        body: JSON.stringify({ query: "Where is the vacation policy?" }),
      }),
    );
    expect(fetcher.mock.calls.some(([url]) => url === "/api/generate")).toBe(false);
  });

  it("propagates cancellation to the authenticated RAG request", async () => {
    const controller = new AbortController();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ authenticated: true, subject: "user-1" }),
          { status: 200 },
        ),
      )
      .mockImplementationOnce(
        async (_url, init) =>
          await new Promise<Response>((_resolve, reject) => {
            if (init?.signal?.aborted) {
              reject(new DOMException("Aborted", "AbortError"));
              return;
            }
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      );

    const client = createAuthClient({ baseUrl: "", fetcher });
    const pending = client.askRag("Cancel me", { signal: controller.signal });
    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("surfaces typed overload and capacity errors for the UI", async () => {
    const overloadedFetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ authenticated: true, subject: "user-1" }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "OVERLOADED", retryable: true }),
          { status: 429 },
        ),
      );
    const overloadedClient = createAuthClient({
      baseUrl: "",
      fetcher: overloadedFetcher,
    });

    await expect(overloadedClient.askRag("busy")).rejects.toMatchObject({
      name: "AuthClientError",
      code: "OVERLOADED",
      status: 429,
    });

    const capacityFetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ authenticated: true, subject: "user-1" }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "DRAINING" }), { status: 503 }),
      );
    const capacityClient = createAuthClient({
      baseUrl: "",
      fetcher: capacityFetcher,
    });

    await expect(capacityClient.askRag("later")).rejects.toMatchObject({
      name: "AuthClientError",
      code: "CAPACITY_UNAVAILABLE",
      status: 503,
    });
  });
});
