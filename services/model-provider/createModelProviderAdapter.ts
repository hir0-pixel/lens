import { GeminiDevAdapter } from "./GeminiDevAdapter";
import { OpenAICompatibleAdapter } from "./OpenAICompatibleAdapter";
import type { ModelProviderAdapter, ProviderEndpointConfig } from "./ProviderAdapter";
import type { SecretStore } from "../secrets/SecretStore";

type FetchPort = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createModelProviderAdapter(
  config: ProviderEndpointConfig,
  fetcher?: FetchPort,
  secrets?: SecretStore,
): ModelProviderAdapter {
  if (!config.adapterType || !config.baseUrl || !config.secretRef || !config.tlsWorkloadRef) {
    throw new Error("Provider configuration requires adapter_type, base_url, secret_ref, and TLS/workload identity.");
  }
  if (config.allowedModels.length < 1) throw new Error("Provider configuration requires an explicit model allowlist.");
  if (config.profile === "sovereign" && config.adapterType !== "openai-compatible") {
    throw new Error("Sovereign production only permits openai-compatible internal gateways.");
  }
  switch (config.adapterType) {
    case "openai-compatible":
      return new OpenAICompatibleAdapter(config, fetcher, secrets);
    case "gemini-dev":
      return new GeminiDevAdapter(config, secrets);
    default:
      throw new Error("Unknown adapter_type.");
  }
}
