import { measureOutputUnits } from "../inference-adapter/localMeter";
import type { SecretStore } from "../secrets/SecretStore";
import type { ModelDescriptor, ModelProviderAdapter, NormalizedProviderError, ProviderEndpointConfig, ProviderGenerateInput } from "./ProviderAdapter";
import { assertInternalProviderUrl, modelAllowed, openAiCompatibleResourceUrl, parseOpenAiCompatibleModelCatalog, resolveSecretRef } from "./providerEndpointPolicy";

type FetchPort = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class OpenAICompatibleAdapter implements ModelProviderAdapter {
  readonly adapterType = "openai-compatible" as const;
  private readonly origin: URL;
  private readonly secrets?: SecretStore;

  constructor(
    private readonly config: ProviderEndpointConfig,
    private readonly fetcher: FetchPort = fetch,
    secrets?: SecretStore,
  ) {
    if (config.adapterType !== "openai-compatible") throw new Error("adapter_type mismatch.");
    this.origin = assertInternalProviderUrl(config.baseUrl, config.profile);
    this.secrets = secrets;
    if (!secrets) resolveSecretRef(config.secretRef);
  }

  private async bearer(): Promise<string> {
    if (this.secrets) return this.secrets.get(this.config.secretRef);
    return resolveSecretRef(this.config.secretRef);
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.bearer();
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (this.origin.hostname === "generativelanguage.googleapis.com") {
      headers["x-goog-api-key"] = token;
    }
    return headers;
  }

  async discoverModels(): Promise<readonly ModelDescriptor[]> {
    const response = await this.fetcher(openAiCompatibleResourceUrl(this.origin, "models"), {
      headers: { ...await this.authHeaders() },
      redirect: "error",
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    if (!response.ok) throw Object.assign(new Error("discover failed"), { status: response.status });
    const body = await response.json();
    const models = parseOpenAiCompatibleModelCatalog(body).filter((id) => modelAllowed(id, this.config.allowedModels));
    return models.map((id) => ({ id, capabilities: this.config.expectedCapabilities }));
  }

  async getModelCapabilities(model: string): Promise<readonly string[]> {
    if (!modelAllowed(model, this.config.allowedModels)) throw this.normalizeError(new Error("FORBIDDEN"));
    return this.config.expectedCapabilities;
  }

  async *generateStream(input: ProviderGenerateInput, signal: AbortSignal): AsyncGenerator<string> {
    if (!modelAllowed(input.model, this.config.allowedModels)) throw this.normalizeError(new Error("FORBIDDEN"));
    const response = await this.fetcher(openAiCompatibleResourceUrl(this.origin, "chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json", ...await this.authHeaders() },
      redirect: "error",
      body: JSON.stringify({
        model: input.model,
        stream: true,
        messages: [{ role: "user", content: input.chunks.join("") }],
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, input.deadlineAt - Date.now()))]),
    });
    if (response.status === 429) throw this.normalizeError(Object.assign(new Error("OVERLOADED"), { status: 429 }));
    if (!response.ok || !response.body) {
      if (process.env.NODE_ENV === "development" && !response.ok) {
        const detail = await response.text().catch(() => "");
        console.error(`[openai-compatible] chat/completions ${response.status} ${detail.slice(0, 400)}`);
      }
      throw this.normalizeError(Object.assign(new Error("upstream"), { status: response.status }));
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (Buffer.byteLength(buffer, "utf8") > 256 * 1024) {
        await reader.cancel();
        throw this.normalizeError(new Error("UNBOUNDED"));
      }
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") return;
        const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) yield delta;
      }
    }
  }

  async embed(input: { model: string; text: string }, signal: AbortSignal): Promise<number[]> {
    if (!this.config.expectedCapabilities.includes("embed")) throw this.normalizeError(new Error("FORBIDDEN"));
    if (!modelAllowed(input.model, this.config.allowedModels)) throw this.normalizeError(new Error("FORBIDDEN"));
    const response = await this.fetcher(openAiCompatibleResourceUrl(this.origin, "embeddings"), {
      method: "POST",
      headers: { "content-type": "application/json", ...await this.authHeaders() },
      redirect: "error",
      body: JSON.stringify({ model: input.model, input: input.text }),
      signal,
    });
    if (!response.ok) throw this.normalizeError(Object.assign(new Error("embed"), { status: response.status }));
    const body = await response.json() as { data?: Array<{ embedding?: number[] }> };
    const embedding = body.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) throw this.normalizeError(new Error("embed"));
    return embedding;
  }

  async health(): Promise<boolean> {
    try {
      const response = await this.fetcher(openAiCompatibleResourceUrl(this.origin, "models"), {
        headers: { ...await this.authHeaders() },
        redirect: "error",
        signal: AbortSignal.timeout(Math.min(2_000, this.config.timeoutMs)),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  normalizeError(error: unknown): NormalizedProviderError {
    const status = error && typeof error === "object" && "status" in error ? Number((error as { status: number }).status) : 0;
    if (status === 429) return { code: "OVERLOADED", retryable: false };
    if (status === 401 || status === 403) return { code: "FORBIDDEN", retryable: false };
    const message = error instanceof Error ? error.message : "";
    if (message === "FORBIDDEN") return { code: "FORBIDDEN", retryable: false };
    if (message.includes("abort")) return { code: "CANCELLED", retryable: false };
    return { code: "DEPENDENCY_UNAVAILABLE", retryable: false };
  }

  meterUsage(text: string): number {
    return measureOutputUnits(text);
  }
}
