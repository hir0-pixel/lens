import { describe, expect, it } from "vitest";
import { InferenceError } from "../../services/inference-adapter/InferenceAdapter";
import { OllamaInferenceAdapter } from "../../services/inference-adapter/OllamaInferenceAdapter";

const input = { reservationId: "reservation-1", fence: 7, scopeId: "scope-1", chunks: ["Hello", " world"] };

describe("M07 Ollama inference adapter", () => {
  it("calls only the configured node-local runtime and preserves the measured usage receipt", async () => {
    const calls: { url: string; body: string | undefined }[] = [];
    const adapter = new OllamaInferenceAdapter({ model: "llama3.2" }, async (url, init) => {
      calls.push({ url: url.toString(), body: init?.body?.toString() });
      return { ok: true, json: async () => ({ response: "Local answer", done: true, eval_count: 4 }) } as Response;
    });

    await expect(adapter.execute(input, new AbortController().signal)).resolves.toEqual({
      output: "Local answer",
      receipt: { usageEventId: "usage:reservation-1:7", reservationId: "reservation-1", fence: 7, generatedTokens: 4, terminal: "completed", scopeId: "scope-1" },
    });
    expect(calls).toEqual([{ url: "http://127.0.0.1:11434/api/generate", body: '{"model":"llama3.2","prompt":"Hello world","stream":false}' }]);
  });

  it("rejects remote, malformed, and client-routable runtime endpoints", () => {
    for (const endpoint of ["https://model.example.com/api/generate", "http://192.168.1.50:11434/api/generate", "http://127.0.0.1:11434/api/tags"]) {
      try {
        new OllamaInferenceAdapter({ model: "llama3.2", endpoint });
        throw new Error("Expected endpoint configuration to be rejected.");
      } catch (error) {
        expect(error).toMatchObject<Partial<InferenceError>>({ code: "DEPENDENCY_UNAVAILABLE" });
      }
    }
  });

  it("propagates cancellation and rejects incomplete runtime receipts", async () => {
    const aborted = new AbortController();
    aborted.abort();
    const adapter = new OllamaInferenceAdapter({ model: "llama3.2" }, async () => ({ ok: true, json: async () => ({ response: "ignored", done: true, eval_count: 1 }) }) as Response);
    await expect(adapter.execute(input, aborted.signal)).rejects.toMatchObject<Partial<InferenceError>>({ code: "CANCELLED" });

    const incomplete = new OllamaInferenceAdapter({ model: "llama3.2" }, async () => ({ ok: true, json: async () => ({ response: "missing receipt", done: false }) }) as Response);
    await expect(incomplete.execute(input, new AbortController().signal)).rejects.toMatchObject<Partial<InferenceError>>({ code: "DEPENDENCY_UNAVAILABLE" });
  });
});
