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

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: readonly ChatToolCall[] }
  | { role: "tool"; content: string; toolCallId: string };

export interface ChatTool {
  name: string;
  description: string;
  parameters: unknown;
}

export interface ProviderChatInput {
  model: string;
  messages: readonly ChatMessage[];
  tools: readonly ChatTool[];
  deadlineAt: number;
}

export type ChatDelta =
  | { type: "text"; text: string }
  | { type: "tool-call"; index: number; id?: string; name?: string; argumentsDelta?: string };

export interface NormalizedProviderError {
  code: "STALE_FENCE" | "CANCELLED" | "FORBIDDEN" | "DEPENDENCY_UNAVAILABLE" | "OVERLOADED";
  retryable: boolean;
}

export interface ModelProviderAdapter {
  readonly adapterType: AdapterType;
  discoverModels(): Promise<readonly ModelDescriptor[]>;
  getModelCapabilities(model: string): Promise<readonly string[]>;
  generateStream(input: ProviderGenerateInput, signal: AbortSignal): AsyncGenerator<string>;
  generateChatStream?(input: ProviderChatInput, signal: AbortSignal): AsyncGenerator<ChatDelta>;
  embed?(input: { model: string; text: string }, signal: AbortSignal): Promise<number[]>;
  health(): Promise<boolean>;
  normalizeError(error: unknown): NormalizedProviderError;
  meterUsage(text: string): number;
}
