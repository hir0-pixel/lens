export type GitFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "ignored"
  | "conflict";

export type DiffViewMode = "side-by-side" | "inline";

export type GitProvider = "github" | "gitlab" | "bitbucket" | "azure" | "local";

export type GitOperation =
  | "idle"
  | "fetching"
  | "pulling"
  | "pushing"
  | "committing"
  | "syncing"
  | "checking-out";

export interface GitChange {
  id: string;
  path: string;
  status: GitFileStatus;
  staged: boolean;
  additions: number;
  deletions: number;
  originalPath?: string;
  language: string;
}

export interface DiffLine {
  type: "add" | "delete" | "context" | "modify";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface GitDiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface GitFileDiff {
  path: string;
  language: string;
  status: GitFileStatus;
  additions: number;
  deletions: number;
  hunks: GitDiffHunk[];
}

export interface GitBranch {
  name: string;
  current: boolean;
  remote?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  favorite?: boolean;
  lastCommitAt?: string;
}

export interface GitCommit {
  id: string;
  hash: string;
  shortHash: string;
  message: string;
  description?: string;
  author: string;
  email: string;
  avatarColor: string;
  timestamp: string;
  relativeTime: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  refs?: string[];
}

export interface MergeConflict {
  id: string;
  path: string;
  currentLabel: string;
  incomingLabel: string;
  currentContent: string;
  incomingContent: string;
  baseContent?: string;
  resolved?: "current" | "incoming" | "both" | null;
}

export interface GitRepository {
  id: string;
  name: string;
  path: string;
  provider: GitProvider;
  remoteUrl?: string;
  defaultBranch: string;
}

export interface CommitTemplate {
  id: string;
  label: string;
  message: string;
  description?: string;
}
