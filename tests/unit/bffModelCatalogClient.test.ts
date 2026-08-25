import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthClient } from "../../src/shared/bff-auth";

describe("BFF employee model catalog client", () => {
  afterEach(() => {
    document.cookie = "lens_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    vi.restoreAllMocks();
  });

  it("loads the catalog via the BFF and submits only model_ref", async () => {
    document.cookie = "lens_csrf=csrf-token; path=/";
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: true, subject: "user-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ modelRef: "acme-chat", label: "acme-chat", available: true }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: true, subject: "user-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: "Grounded.",
        citations: [{ source: "policy.md", section: "1" }],
        conversationRef: "c1.opaque",
      }), { status: 200 }));

    const client = createAuthClient({ baseUrl: "", fetcher });
    await expect(client.listModels()).resolves.toEqual([{ modelRef: "acme-chat", label: "acme-chat", available: true }]);
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/models", expect.objectContaining({ method: "GET", credentials: "include" }));

    await client.askRag("What is leave?", { modelId: "acme-chat" });
    const body = JSON.parse(String(fetcher.mock.calls[3][1].body));
    expect(body).toEqual({ query: "What is leave?", modelId: "acme-chat" });
    expect(JSON.stringify(body)).not.toMatch(/apiKey|secret|baseUrl/);
    expect(localStorage.getItem("provider-key")).toBeNull();
    expect(sessionStorage.getItem("provider-key")).toBeNull();
  });

  it("rejects an admin response that includes key material", async () => {
    document.cookie = "lens_csrf=csrf-token; path=/";
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: true, subject: "admin" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "prv_1", status: "active", apiKey: "sk-leak" }), { status: 201 }));
    const client = createAuthClient({ baseUrl: "", fetcher });
    await expect(client.onboardProvider({
      adapterType: "openai-compatible",
      baseUrl: "http://127.0.0.1:8080",
      apiKey: "sk-live-provider-secret",
      tlsWorkloadRef: "workload:runtime",
      allowedModels: ["acme-chat"],
      capabilities: ["generate"],
      timeoutMs: 1000,
      maxConcurrency: 1,
      idempotencyKey: "abc12345",
    })).rejects.toThrow();
  });
});
