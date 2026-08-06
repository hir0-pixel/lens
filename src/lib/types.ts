export type AgentMode = "agent" | "claude-code";

export type ModelProvider =
  | "orchids"
  | "chatgpt"
  | "claude"
  | "gemini"
  | "copilot";

export interface Model {
  id: string;
  label: string;
  provider: ModelProvider;
}

export type ToolCallStatus = "running" | "done" | "error";

export interface ToolCallRecord {
  id: string;
  name: string;
  detail: string;
  status: ToolCallStatus;
  durationMs?: number;
}

export type MessageRole = "user" | "assistant";

export interface FileEdit {
  path: string;
  language: string;
  summary: string;
  additions: number;
  deletions: number;
}

export interface Attachment {
  id: string;
  name: string;
  kind: "image" | "video" | "file";
  sizeLabel: string;
  preview?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  checkpoint?: string;
  toolCalls?: ToolCallRecord[];
  fileEdits?: FileEdit[];
  attachments?: Attachment[];
  model?: string;
}

export type OutputTab = "browser" | "editor" | "terminal";

export type ViewKind = "workspace" | "projects" | "analytics";

export type Theme = "dark" | "light";

export interface Project {
  id: string;
  name: string;
  stack: string;
  path: string;
  branch: string;
  deployStatus: "idle" | "building" | "live" | "failed";
  deployedUrl?: string;
  updatedAt: string;
  color: string;
}

export type ProviderId = "chatgpt" | "claude" | "gemini" | "copilot";

export interface ProviderState {
  id: ProviderId;
  name: string;
  connected: boolean;
  via: "subscription" | "api-key";
  keyLabel?: string;
  defaultModel?: string;
}
