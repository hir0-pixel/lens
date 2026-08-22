import { describe, expect, it, vi } from "vitest";
import { createGeminiGateway, GeminiGatewayError } from "../src/gemini/gateway";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Gemini gateway", () => {
  it("paginates and exposes only text generateContent models", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({
        models: [
          { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/imagen-4", displayName: "Imagen", supportedGenerationMethods: ["generateContent"] },
          { name: "models/nano-banana-pro-preview", displayName: "Nano Banana Pro", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemma-4-31b-it", displayName: "Gemma", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-flash-latest", displayName: "Gemini Flash Latest", supportedGenerationMethods: ["generateContent"] },
        ], nextPageToken: "next",
      }))
      .mockResolvedValueOnce(response({
        models: [{ name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro", supportedGenerationMethods: ["generateContent"] }],
      }));
    const gateway = createGeminiGateway({ apiKey: "secret", fetcher, ttlMs: 60_000 });
    await expect(gateway.listModels()).resolves.toEqual([
      expect.objectContaining({ id: "gemini-2.5-flash" }),
      expect.objectContaining({ id: "gemini-2.5-pro" }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1].headers["x-goog-api-key"]).toBe("secret");
    expect(JSON.stringify(fetcher.mock.calls)).toContain("secret");
  });

  it("deduplicates concurrent catalog refreshes", async () => {
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>((r) => { resolve = r; });
    const fetcher = vi.fn().mockReturnValue(pending);
    const gateway = createGeminiGateway({ apiKey: "secret", fetcher });
    const a = gateway.listModels();
    const b = gateway.listModels();
    resolve(response({ models: [] }));
    await Promise.all([a, b]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("revalidates the selected model before generation", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ models: [] }));
    const gateway = createGeminiGateway({ apiKey: "secret", fetcher });
    await expect(gateway.generate("hello", "not-allowed")).rejects.toMatchObject({ code: "INVALID_MODEL" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("forwards the exact catalog-selected model to generateContent", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ models: [{ name: "models/gemini-2.5-flash", displayName: "Flash", supportedGenerationMethods: ["generateContent"] }] }))
      .mockResolvedValueOnce(response({ candidates: [{ content: { parts: [{ text: "answer" }] } }] }));
    const gateway = createGeminiGateway({ apiKey: "secret", fetcher });
    await expect(gateway.generate("hello", "gemini-2.5-flash")).resolves.toMatchObject({ output: "answer" });
    expect(fetcher.mock.calls[1][0]).toContain("/models/gemini-2.5-flash:generateContent");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      systemInstruction: {
        parts: [{ text: expect.stringContaining("gemini-2.5-flash") }],
      },
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
    });
  });

  it("does not consume generation quota while listing models", async () => {
    const fetcher = vi.fn(async () => response({ models: [
        { name: "models/gemini-stale", displayName: "Stale", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-live", displayName: "Live", supportedGenerationMethods: ["generateContent"] },
      ] }));
    const gateway = createGeminiGateway({ apiKey: "secret", fetcher });
    await expect(gateway.listModels()).resolves.toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).not.toContain(":generateContent");
  });

  it("maps a catalog model rejected at generation time to INVALID_MODEL", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ models: [{ name: "models/gemini-retired", displayName: "Retired", supportedGenerationMethods: ["generateContent"] }] }))
      .mockResolvedValueOnce(response({ error: { message: "not available" } }, 404));
    const gateway = createGeminiGateway({ apiKey: "secret", fetcher });
    await expect(gateway.generate("hello", "gemini-retired")).rejects.toMatchObject({ code: "INVALID_MODEL" });
  });

  it("fails closed when no deployment secret is configured", async () => {
    const gateway = createGeminiGateway({ fetcher: vi.fn() });
    await expect(gateway.listModels()).rejects.toBeInstanceOf(GeminiGatewayError);
  });
});
