export type AgentMode = "agent" | "claude-code";

export type ModelProvider =
  | "lens"
  | "chatgpt"
  | "claude"
  | "gemini"
  | "copilot";

export interface Model {
  id: string;
  label: string;
  provider: ModelProvider;
  available?: boolean;
}

export type ToolCallStatus = "running" | "done" | "error";

export type ToolCallCategory =
  | "thinking"
  | "read"
  | "write"
  | "edit"
  | "terminal"
  | "search"
  | "git"
  | "generic";

export interface ToolCallRecord {
  id: string;
  name: string;
  detail: string;
  status: ToolCallStatus;
  durationMs?: number;
  category?: ToolCallCategory;
  timestamp?: string;
  expandedContent?: string;
}

export type AIMode = "agent" | "ask" | "edit";

export type ContextChipKind =
  | "workspace"
  | "file"
  | "folder"
  | "selection"
  | "terminal"
  | "git"
  | "errors"
  | "diagnostics";

export interface ContextChip {
  id: string;
  kind: ContextChipKind;
  label: string;
  detail?: string;
}

export interface Conversation {
  id: string;
  title: string;
  preview: string;
  updatedAt: Date;
  pinned?: boolean;
}

export type DiffLineType = "add" | "delete" | "context" | "modify";

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffFileChange {
  path: string;
  language: string;
  lines: DiffLine[];
  additions: number;
  deletions: number;
  status?: "pending" | "accepted" | "rejected";
}

export type MentionKind =
  | "file"
  | "folder"
  | "terminal"
  | "git"
  | "diagnostics"
  | "codebase"
  | "session";

export interface MentionItem {
  id: string;
  kind: MentionKind;
  label: string;
  detail?: string;
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

export interface Citation {
  source: string;
  section: string;
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
  citations?: Citation[];
  model?: string;
}

export type OutputTab = "browser" | "editor" | "terminal" | "task";

export interface AgentPlanStep {
  id: string;
  label: string;
  status: "done" | "in_progress" | "pending";
}

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
