import { InferenceError, type RuntimeReceipt } from "./InferenceAdapter";

type FetchPort = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface OllamaInferenceOptions {
  model: string;
  endpoint?: string;
}

interface OllamaGenerateResponse {
  response?: unknown;
  done?: unknown;
  eval_count?: unknown;
}

/**
 * Adapter for a node-local Ollama runtime. Model selection stays in server
 * configuration; callers can supply neither a runtime address nor a model name.
 */
export class OllamaInferenceAdapter {
  private readonly endpoint: URL;
  private readonly model: string;

  constructor(options: OllamaInferenceOptions, private readonly fetcher: FetchPort = fetch) {
    this.model = options.model.trim();
    this.endpoint = this.localEndpoint(options.endpoint ?? "http://127.0.0.1:11434/api/generate");
    if (!this.model) throw new InferenceError("DEPENDENCY_UNAVAILABLE");
  }

  async execute(input: { reservationId: string; fence: number; scopeId: string; chunks: readonly string[] }, signal: AbortSignal): Promise<{ output: string; receipt: RuntimeReceipt }> {
    if (!input.reservationId || !input.scopeId || input.fence < 1) throw new InferenceError("STALE_FENCE");
    if (signal.aborted) throw new InferenceError("CANCELLED");

    try {
      const response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ model: this.model, prompt: input.chunks.join(""), stream: false }),
        signal,
      });
      if (!response.ok) throw new InferenceError("DEPENDENCY_UNAVAILABLE");
      const payload = await response.json() as OllamaGenerateResponse;
      const generatedTokens = payload.eval_count;
      if (payload.done !== true || typeof payload.response !== "string" || typeof generatedTokens !== "number" || !Number.isSafeInteger(generatedTokens) || generatedTokens < 0) throw new InferenceError("DEPENDENCY_UNAVAILABLE");
      return {
        output: payload.response,
        receipt: {
          usageEventId: `usage:${input.reservationId}:${input.fence}`,
          reservationId: input.reservationId,
          fence: input.fence,
          generatedTokens,
          terminal: "completed",
          scopeId: input.scopeId,
        },
      };
    } catch (error) {
      if (signal.aborted || error instanceof DOMException && error.name === "AbortError") throw new InferenceError("CANCELLED");
      if (error instanceof InferenceError) throw error;
      throw new InferenceError("DEPENDENCY_UNAVAILABLE");
    }
  }

  private localEndpoint(value: string): URL {
    try {
      const endpoint = new URL(value);
      const localHost = endpoint.hostname === "127.0.0.1" || endpoint.hostname === "[::1]";
      if (endpoint.protocol !== "http:" || !localHost || endpoint.pathname !== "/api/generate" || endpoint.search || endpoint.hash) throw new Error("non-local runtime");
      return endpoint;
    } catch {
      throw new InferenceError("DEPENDENCY_UNAVAILABLE");
    }
  }
}
