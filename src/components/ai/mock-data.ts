import type {
  ContextChip,
  Conversation,
  DiffFileChange,
  MentionItem,
} from "../../lib/types";

export const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: "c1",
    title: "General chat",
    preview: "Ask about this codebase…",
    updatedAt: new Date(),
    pinned: true,
  },
  {
    id: "c2",
    title: "Codebase memory MCP access",
    preview: "Wire MCP tools for codebase memory",
    updatedAt: new Date(),
  },
  {
    id: "c3",
    title: "General chat",
    preview: "Quick questions",
    updatedAt: new Date(Date.now() - 86_400_000),
  },
  {
    id: "c4",
    title: "Terminal theme polish",
    preview: "Match JetBrains terminal colors in the bottom panel",
    updatedAt: new Date(Date.now() - 86_400_000 * 2),
  },
  {
    id: "c5",
    title: "Deploy pipeline setup",
    preview: "Add GitHub Actions workflow for preview deploys",
    updatedAt: new Date(Date.now() - 86_400_000 * 5),
  },
  {
    id: "c6",
    title: "Auth flow mock",
    preview: "Create a login page with OAuth buttons",
    updatedAt: new Date(Date.now() - 86_400_000 * 12),
  },
];

export const DEFAULT_CONTEXT_CHIPS: ContextChip[] = [
  { id: "ctx-ws", kind: "workspace", label: "finance-dashboard", detail: "~/dev/finance-dashboard" },
  { id: "ctx-git", kind: "git", label: "main", detail: "3 uncommitted changes" },
  { id: "ctx-file", kind: "file", label: "App.tsx", detail: "src/App.tsx" },
  { id: "ctx-folder", kind: "folder", label: "components/ai", detail: "12 files" },
  { id: "ctx-term", kind: "terminal", label: "bash", detail: "npm run dev" },
  { id: "ctx-err", kind: "errors", label: "2 errors", detail: "TypeScript" },
];

export const MENTION_ITEMS: MentionItem[] = [
  { id: "m1", kind: "file", label: "App.tsx", detail: "src/App.tsx" },
  { id: "m2", kind: "file", label: "AIPanel.tsx", detail: "src/components/ai/AIPanel.tsx" },
  { id: "m3", kind: "file", label: "types.ts", detail: "src/lib/types.ts" },
  { id: "m4", kind: "folder", label: "components/ai", detail: "src/components/ai/" },
  { id: "m5", kind: "folder", label: "components/shell", detail: "src/components/shell/" },
  { id: "m6", kind: "terminal", label: "Terminal 1", detail: "npm run dev" },
  { id: "m7", kind: "git", label: "Git diff", detail: "3 files changed" },
  { id: "m8", kind: "diagnostics", label: "Diagnostics", detail: "2 errors, 1 warning" },
  { id: "m9", kind: "codebase", label: "Codebase", detail: "Search entire workspace" },
  { id: "m10", kind: "session", label: "Finance dashboard scaffold", detail: "Past agent run" },
  { id: "m11", kind: "session", label: "Amber accent + savings goals", detail: "Past agent run" },
];

export const MOCK_AGENT_PLAN = [
  {
    id: "p1",
    label: "Scaffold SavingsGoals component",
    status: "done" as const,
  },
  {
    id: "p2",
    label: "Wire CashFlowChart to mock data",
    status: "in_progress" as const,
  },
  {
    id: "p3",
    label: "Add responsive layout",
    status: "pending" as const,
  },
];

export const SUGGESTED_PROMPTS = [
  { id: "s1", label: "Explain this codebase", prompt: "Explain the architecture of this project" },
  { id: "s2", label: "Fix TypeScript errors", prompt: "Fix all TypeScript errors in the workspace" },
  { id: "s3", label: "Add a new feature", prompt: "Add a dark mode toggle to the settings panel" },
  { id: "s4", label: "Write tests", prompt: "Write unit tests for the layout store" },
  { id: "s5", label: "Refactor component", prompt: "Refactor AIPanel into smaller components" },
  { id: "s6", label: "Generate docs", prompt: "Generate README documentation for this project" },
];

export const KEYBOARD_SHORTCUTS = [
  { keys: "Ctrl+I", action: "Focus composer" },
  { keys: "Ctrl+L", action: "Toggle tools pane" },
  { keys: "Ctrl+Shift+E", action: "Toggle explorer" },
  { keys: "Ctrl+`", action: "Toggle terminal" },
  { keys: "Ctrl+P", action: "Quick open file" },
  { keys: "Ctrl+Shift+P", action: "Command palette" },
];

export const MOCK_DIFF: DiffFileChange[] = [
  {
    path: "src/App.tsx",
    language: "tsx",
    additions: 42,
    deletions: 6,
    status: "pending",
    lines: [
      { type: "context", content: "import AIPanel from \"./components/ai/AIPanel\";", oldLineNumber: 1, newLineNumber: 1 },
      { type: "delete", content: "import AppShell from \"./components/shell/AppShell\";", oldLineNumber: 2 },
      { type: "add", content: "import AppShell from \"./components/shell/AppShell\";", newLineNumber: 2 },
      { type: "add", content: "import { AIPanel } from \"./components/ai/AIPanel\";", newLineNumber: 3 },
      { type: "context", content: "", oldLineNumber: 3, newLineNumber: 4 },
      { type: "modify", content: "  aiPanel={<AIPanel ... />}", oldLineNumber: 15, newLineNumber: 16 },
    ],
  },
  {
    path: "src/components/Sidebar.tsx",
    language: "tsx",
    additions: 88,
    deletions: 0,
    status: "pending",
    lines: [
      { type: "add", content: "export function Sidebar() {", newLineNumber: 1 },
      { type: "add", content: "  return (", newLineNumber: 2 },
      { type: "add", content: "    <nav className=\"flex flex-col gap-1\">", newLineNumber: 3 },
      { type: "add", content: "      {/* navigation items */}", newLineNumber: 4 },
      { type: "add", content: "    </nav>", newLineNumber: 5 },
      { type: "add", content: "  );", newLineNumber: 6 },
      { type: "add", content: "}", newLineNumber: 7 },
    ],
  },
  {
    path: "src/index.css",
    language: "css",
    additions: 3,
    deletions: 3,
    status: "pending",
    lines: [
      { type: "delete", content: "  --primary: 220 90% 56%;", oldLineNumber: 14 },
      { type: "add", content: "  --primary: 36 97% 57%;", newLineNumber: 14 },
      { type: "context", content: "  --primary-foreground: 240 5% 5%;", oldLineNumber: 15, newLineNumber: 15 },
    ],
  },
];
