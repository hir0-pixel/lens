import type { LogEntry, OutputChannel, ProblemItem } from "./types";

export const MOCK_PROBLEMS: ProblemItem[] = [
  {
    id: "p1",
    severity: "error",
    message: "Property 'splitRoot' is possibly 'null'.",
    file: "src/components/terminal/TerminalSplitView.tsx",
    line: 42,
    column: 12,
    source: "typescript",
  },
  {
    id: "p2",
    severity: "error",
    message: "Type 'string | undefined' is not assignable to type 'string'.",
    file: "src/stores/terminalStore.ts",
    line: 118,
    column: 5,
    source: "typescript",
  },
  {
    id: "p3",
    severity: "warning",
    message: "'sessionId' is declared but its value is never read.",
    file: "src/components/terminal/TerminalSession.tsx",
    line: 88,
    column: 9,
    source: "typescript",
  },
  {
    id: "p4",
    severity: "info",
    message: "Consider extracting keyboard handler into a custom hook.",
    file: "src/components/terminal/hooks/useTerminalKeyboard.ts",
    line: 1,
    column: 1,
    source: "eslint",
  },
];

export const MOCK_OUTPUT_CHANNELS: OutputChannel[] = [
  {
    id: "lens",
    name: "Lens",
    lines: [
      "[info] Lens IDE started",
      "[info] Project: finance-dashboard",
      "[info] Terminal workspace initialized",
    ],
  },
  {
    id: "vite",
    name: "Vite",
    lines: [
      "  VITE v7.3.6  ready in 412 ms",
      "",
      "  ➜  Local:   http://localhost:5173/",
      "  ➜  Network: http://192.168.1.42:5173/",
    ],
  },
  {
    id: "git",
    name: "Git",
    lines: [
      "hint: You have divergent branches and need to specify how to reconcile them.",
      "hint: You can do so by running: git config pull.rebase false",
    ],
  },
];

export const MOCK_LOGS: LogEntry[] = [
  {
    id: "l1",
    timestamp: "15:42:01",
    level: "info",
    source: "terminal",
    message: "Session bash started in ~/dev/finance-dashboard",
  },
  {
    id: "l2",
    timestamp: "15:42:05",
    level: "debug",
    source: "xterm",
    message: "FitAddon resized to 120×28",
  },
  {
    id: "l3",
    timestamp: "15:43:12",
    level: "warn",
    source: "shell",
    message: "Mock shell active — PTY backend not connected",
  },
  {
    id: "l4",
    timestamp: "15:44:00",
    level: "info",
    source: "layout",
    message: "Bottom panel maximized",
  },
  {
    id: "l5",
    timestamp: "15:44:22",
    level: "error",
    source: "typescript",
    message: "2 errors in workspace",
  },
];
