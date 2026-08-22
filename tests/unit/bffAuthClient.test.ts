import { describe, expect, it, vi, afterEach } from "vitest";
import {
  createAuthClient,
  getBffAuthConfig,
  getBffAuthClient,
  resetBffAuthClient,
} from "../../src/shared/bff-auth";

describe("bff-auth frontend client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetBffAuthClient();
  });

  it("is same-origin and enabled by default", () => {
    expect(getBffAuthConfig({})).toEqual({ enabled: true, baseUrl: "" });
    expect(getBffAuthConfig({ VITE_LENS_BFF_URL: "http://localhost:3001" })).toEqual({
      enabled: true,
      baseUrl: "http://localhost:3001",
    });
  });

  it("rejects malformed BFF override urls and falls back to same-origin", () => {
    expect(getBffAuthConfig({ VITE_LENS_BFF_URL: "not-a-url" })).toEqual({
      enabled: true,
      baseUrl: "",
    });
  });

  it("reveals only safe session data, never tokens", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          authenticated: true,
          subject: "user-1",
          name: "Test User",
          email: "u@example.com",
        }),
        { status: 200 },
      ),
    );
    const client = createAuthClient({
      baseUrl: "",
      fetcher,
    });
    const session = await client.getSession();
    expect(session.authenticated).toBe(true);
    expect(session.subject).toBe("user-1");
    expect(session).not.toHaveProperty("accessToken");
    expect(fetcher).toHaveBeenCalledWith("/api/session", expect.objectContaining({ credentials: "include" }));
  });

  it("beginLogin navigates to /auth/login on a redirect response", async () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign } });
    const fetcher = vi.fn().mockResolvedValue({
      type: "opaqueredirect",
      status: 0,
      ok: false,
    });
    const client = createAuthClient({ baseUrl: "", fetcher });
    await client.beginLogin();
    expect(fetcher).toHaveBeenCalledWith(
      "/auth/login",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(assign).toHaveBeenCalledWith("/auth/login");
  });

  it("beginLogin rejects (no navigation) when the BFF cannot start login", async () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign } });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "DEPENDENCY_UNAVAILABLE" }), { status: 503 }));
    const client = createAuthClient({ baseUrl: "", fetcher });
    await expect(client.beginLogin()).rejects.toThrow("LOGIN_UNAVAILABLE");
    expect(assign).not.toHaveBeenCalled();
  });

  it("beginLogin uses the system-browser opener when supplied (Tauri)", async () => {
    const openExternal = vi.fn();
    const client = createAuthClient({ baseUrl: "", openExternal });
    await client.beginLogin();
    expect(openExternal).toHaveBeenCalledWith("/auth/login");
  });

  it("generate routes through the authenticated endpoint and surfaces auth-required", async () => {
    const fetcher = vi
      .fn().mockResolvedValueOnce(new Response(JSON.stringify({ output: "hello from backend" }), { status: 200 }));
    const client = createAuthClient({ baseUrl: "", fetcher });
    await expect(client.generate("hi")).resolves.toBe("hello from backend");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/generate",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("beginLogin navigates directly inside a desktop webview without probing", async () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign } });
    const fetcher = vi.fn();
    const client = createAuthClient({ baseUrl: "", fetcher, directLoginNavigation: true });
    await client.beginLogin();
    expect(fetcher).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith("/auth/login");
  });

  it("loads the authenticated Gemini catalog and forwards the selected model", async () => {
    document.cookie = "lens_csrf=csrf-token";
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: true, subject: "user-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ id: "gemini-2.5-flash", name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: "selected model response", model: "gemini-2.5-flash" }), { status: 200 }));
    const client = createAuthClient({ baseUrl: "", fetcher });
    await expect(client.getGeminiModels()).resolves.toHaveLength(1);
    await expect(client.generate("hi", "gemini-2.5-flash")).resolves.toBe("selected model response");
    expect(fetcher.mock.calls[2][1]).toEqual(expect.objectContaining({
      body: JSON.stringify({ prompt: "hi", modelId: "gemini-2.5-flash" }),
      headers: expect.objectContaining({ "x-lens-csrf": "csrf-token" }),
    }));
  });

  it("generate rejects when the backend session is not authenticated", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "UNAUTHENTICATED" }), { status: 401 }));
    const client = createAuthClient({ baseUrl: "", fetcher });
    await expect(client.generate("hi")).rejects.toThrow("AUTH_REQUIRED");
  });

  it("getBffAuthClient returns an undefined client when the BFF is not usable", () => {
    resetBffAuthClient();
    expect(getBffAuthClient()).toBeDefined();
  });
});
