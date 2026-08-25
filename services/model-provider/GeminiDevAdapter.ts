import { measureOutputUnits } from "../inference-adapter/localMeter";
import type { ModelDescriptor, ModelProviderAdapter, NormalizedProviderError, ProviderEndpointConfig, ProviderGenerateInput } from "./ProviderAdapter";
import { modelAllowed, resolveSecretRef } from "./providerEndpointPolicy";
import type { SecretStore } from "../secrets/SecretStore";

/** Isolated development/non-sovereign Gemini adapter. Forbidden when profile is sovereign. */
export class GeminiDevAdapter implements ModelProviderAdapter {
  readonly adapterType = "gemini-dev" as const;
  constructor(
    private readonly config: ProviderEndpointConfig,
    secrets?: SecretStore,
  ) {
    if (config.adapterType !== "gemini-dev") throw new Error("adapter_type mismatch.");
    if (config.profile === "sovereign") throw new Error("Gemini is not permitted in sovereign production.");
    if (!secrets) resolveSecretRef(config.secretRef);
  }

  async discoverModels(): Promise<readonly ModelDescriptor[]> {
    return this.config.allowedModels.map((id) => ({ id, capabilities: this.config.expectedCapabilities }));
  }

  async getModelCapabilities(model: string): Promise<readonly string[]> {
    if (!modelAllowed(model, this.config.allowedModels)) throw this.normalizeError(new Error("FORBIDDEN"));
    return this.config.expectedCapabilities;
  }

  async *generateStream(input: ProviderGenerateInput, signal: AbortSignal): AsyncGenerator<string> {
    if (signal.aborted) throw this.normalizeError(new Error("abort"));
    if (!modelAllowed(input.model, this.config.allowedModels)) throw this.normalizeError(new Error("FORBIDDEN"));
    yield `[gemini-dev:${input.model}] ${input.chunks.join("")}`;
  }

  async health(): Promise<boolean> {
    return true;
  }

  normalizeError(error: unknown): NormalizedProviderError {
    const message = error instanceof Error ? error.message : "";
    if (message === "FORBIDDEN") return { code: "FORBIDDEN", retryable: false };
    if (message.includes("abort")) return { code: "CANCELLED", retryable: false };
    return { code: "DEPENDENCY_UNAVAILABLE", retryable: false };
  }

  meterUsage(text: string): number {
    return measureOutputUnits(text);
  }
}
