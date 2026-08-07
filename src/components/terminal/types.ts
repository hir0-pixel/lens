export type ShellType = "powershell" | "bash" | "cmd" | "zsh";

export type TerminalConnectionKind = "local" | "ssh" | "docker" | "remote";

export type TerminalSessionStatus = "running" | "exited" | "killed";

export interface TerminalSession {
  id: string;
  title: string;
  cwd: string;
  shell: ShellType;
  pinned: boolean;
  history: string[];
  scrollPosition: number;
  createdAt: number;
  lastActiveAt: number;
  connectionKind: TerminalConnectionKind;
  status: TerminalSessionStatus;
  exitCode?: number;
  /** Bump to force xterm remount on restart */
  generation: number;
}

export interface SplitPane {
  id: string;
  type: "leaf" | "split";
  sessionId?: string;
  direction?: "horizontal" | "vertical";
  first?: SplitPane;
  second?: SplitPane;
  /** Percentage size of first child (0–100) */
  firstSize?: number;
}

export interface ClosedSessionRecord {
  id: string;
  title: string;
  cwd: string;
  shell: ShellType;
  closedAt: number;
}

export interface TerminalSearchState {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  regex: boolean;
}

export interface ShellState {
  cwd: string;
  shell: ShellType;
}

export interface ShellResult {
  output: string;
  newState: ShellState;
  clear?: boolean;
  exitSession?: boolean;
}

export type ProblemSeverity = "error" | "warning" | "info";

export interface ProblemItem {
  id: string;
  severity: ProblemSeverity;
  message: string;
  file: string;
  line: number;
  column: number;
  source: string;
}

export interface OutputChannel {
  id: string;
  name: string;
  lines: string[];
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  source: string;
  message: string;
}
