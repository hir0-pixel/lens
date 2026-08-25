export type AdapterType = "openai-compatible" | "gemini-dev";
export type ProviderProfile = "sovereign" | "development";

export interface ProviderEndpointConfig {
  adapterType: AdapterType;
  baseUrl: string;
  secretRef: string;
  tlsWorkloadRef: string;
  allowedModels: readonly string[];
  expectedCapabilities: readonly ("generate" | "embed" | "stream")[];
  timeoutMs: number;
  maxConcurrency: number;
  profile: ProviderProfile;
}

export interface ModelDescriptor {
  id: string;
  capabilities: readonly ("generate" | "embed" | "stream")[];
}

export interface ProviderGenerateInput {
  model: string;
  chunks: readonly string[];
  deadlineAt: number;
}

export interface NormalizedProviderError {
  code: "STALE_FENCE" | "CANCELLED" | "FORBIDDEN" | "DEPENDENCY_UNAVAILABLE" | "OVERLOADED";
  retryable: boolean;
}

export interface ModelProviderAdapter {
  readonly adapterType: AdapterType;
  discoverModels(): Promise<readonly ModelDescriptor[]>;
  getModelCapabilities(model: string): Promise<readonly string[]>;
  generateStream(input: ProviderGenerateInput, signal: AbortSignal): AsyncGenerator<string>;
  embed?(input: { model: string; text: string }, signal: AbortSignal): Promise<number[]>;
  health(): Promise<boolean>;
  normalizeError(error: unknown): NormalizedProviderError;
  meterUsage(text: string): number;
}
