import type {
  CommitTemplate,
  GitBranch,
  GitChange,
  GitCommit,
  GitFileDiff,
  GitRepository,
  MergeConflict,
} from "./types";

export const MOCK_REPOS: GitRepository[] = [
  {
    id: "repo-1",
    name: "finance-dashboard",
    path: "~/dev/finance-dashboard",
    provider: "github",
    remoteUrl: "https://github.com/lens/finance-dashboard",
    defaultBranch: "main",
  },
  {
    id: "repo-2",
    name: "chrome-buddy-extension",
    path: "~/dev/chrome-buddy",
    provider: "github",
    remoteUrl: "https://github.com/lens/chrome-buddy",
    defaultBranch: "main",
  },
];

export const MOCK_BRANCHES: GitBranch[] = [
  {
    name: "main",
    current: true,
    remote: "origin/main",
    upstream: "origin/main",
    ahead: 2,
    behind: 1,
    favorite: true,
    lastCommitAt: "2 hours ago",
  },
  {
    name: "feat/source-control",
    current: false,
    remote: "origin/feat/source-control",
    upstream: "origin/feat/source-control",
    ahead: 0,
    behind: 0,
    favorite: true,
    lastCommitAt: "yesterday",
  },
  {
    name: "feat/dark-mode",
    current: false,
    remote: "origin/feat/dark-mode",
    ahead: 3,
    behind: 0,
    lastCommitAt: "3 days ago",
  },
  {
    name: "fix/sidebar-resize",
    current: false,
    ahead: 0,
    behind: 0,
    lastCommitAt: "1 week ago",
  },
  {
    name: "chore/deps",
    current: false,
    remote: "origin/chore/deps",
    ahead: 0,
    behind: 2,
    lastCommitAt: "2 weeks ago",
  },
];

export const MOCK_CHANGES: GitChange[] = [
  {
    id: "c1",
    path: "src/components/shell/BottomPanel.tsx",
    status: "modified",
    staged: true,
    additions: 48,
    deletions: 12,
    language: "tsx",
  },
  {
    id: "c2",
    path: "src/stores/terminalStore.ts",
    status: "added",
    staged: true,
    additions: 210,
    deletions: 0,
    language: "ts",
  },
  {
    id: "c3",
    path: "src/features/source-control/SourceControlPanel.tsx",
    status: "added",
    staged: false,
    additions: 180,
    deletions: 0,
    language: "tsx",
  },
  {
    id: "c4",
    path: "src/components/shell/PrimarySidebar.tsx",
    status: "modified",
    staged: false,
    additions: 14,
    deletions: 6,
    language: "tsx",
  },
  {
    id: "c5",
    path: "src/index.css",
    status: "modified",
    staged: false,
    additions: 3,
    deletions: 3,
    language: "css",
  },
  {
    id: "c6",
    path: "docs/old-notes.md",
    status: "deleted",
    staged: false,
    additions: 0,
    deletions: 42,
    language: "md",
  },
  {
    id: "c7",
    path: "src/lib/utils.ts",
    status: "renamed",
    staged: false,
    additions: 2,
    deletions: 2,
    originalPath: "src/utils/cn.ts",
    language: "ts",
  },
  {
    id: "c8",
    path: ".env.local.example",
    status: "untracked",
    staged: false,
    additions: 8,
    deletions: 0,
    language: "plaintext",
  },
  {
    id: "c9",
    path: "src/components/shell/StatusBar.tsx",
    status: "conflict",
    staged: false,
    additions: 20,
    deletions: 15,
    language: "tsx",
  },
];

export const MOCK_DIFFS: Record<string, GitFileDiff> = {
  "src/components/shell/PrimarySidebar.tsx": {
    path: "src/components/shell/PrimarySidebar.tsx",
    language: "tsx",
    status: "modified",
    additions: 14,
    deletions: 6,
    hunks: [
      {
        header: "@@ -17,12 +17,20 @@ export default function PrimarySidebar()",
        lines: [
          { type: "context", content: "  const activityView = useLayoutStore((s) => s.activityView);", oldLineNumber: 17, newLineNumber: 17 },
          { type: "context", content: "  const meta = VIEW_META[activityView];", oldLineNumber: 18, newLineNumber: 18 },
          { type: "delete", content: "  return (", oldLineNumber: 19 },
          { type: "add", content: "  if (activityView === \"git\") {", newLineNumber: 19 },
          { type: "add", content: "    return <SourceControlPanel />;", newLineNumber: 20 },
          { type: "add", content: "  }", newLineNumber: 21 },
          { type: "add", content: "", newLineNumber: 22 },
          { type: "add", content: "  return (", newLineNumber: 23 },
          { type: "context", content: "    <div className=\"flex h-full flex-col bg-surface-1\">", oldLineNumber: 20, newLineNumber: 24 },
        ],
      },
    ],
  },
  "src/index.css": {
    path: "src/index.css",
    language: "css",
    status: "modified",
    additions: 3,
    deletions: 3,
    hunks: [
      {
        header: "@@ -14,3 +14,3 @@",
        lines: [
          { type: "delete", content: "  --primary: 220 90% 56%;", oldLineNumber: 14 },
          { type: "add", content: "  --primary: 36 97% 57%;", newLineNumber: 14 },
          { type: "context", content: "  --primary-foreground: 240 5% 5%;", oldLineNumber: 15, newLineNumber: 15 },
        ],
      },
    ],
  },
  "src/features/source-control/SourceControlPanel.tsx": {
    path: "src/features/source-control/SourceControlPanel.tsx",
    language: "tsx",
    status: "added",
    additions: 12,
    deletions: 0,
    hunks: [
      {
        header: "@@ -0,0 +1,12 @@",
        lines: [
          { type: "add", content: "export function SourceControlPanel() {", newLineNumber: 1 },
          { type: "add", content: "  return (", newLineNumber: 2 },
          { type: "add", content: "    <div className=\"flex h-full flex-col\">", newLineNumber: 3 },
          { type: "add", content: "      {/* SCM UI */}", newLineNumber: 4 },
          { type: "add", content: "    </div>", newLineNumber: 5 },
          { type: "add", content: "  );", newLineNumber: 6 },
          { type: "add", content: "}", newLineNumber: 7 },
        ],
      },
    ],
  },
};

export const MOCK_COMMITS: GitCommit[] = [
  {
    id: "cm1",
    hash: "a8f3c2e19b4d7e6f1a2b3c4d5e6f7890",
    shortHash: "a8f3c2e",
    message: "feat: add terminal workspace with JetBrains-inspired UX",
    description: "Multi-session tabs, split panes, mock shell, and bottom panel maximize.",
    author: "Maryam",
    email: "maryam@lens.app",
    avatarColor: "#FCAA26",
    timestamp: "2026-08-06T10:22:00Z",
    relativeTime: "2 hours ago",
    filesChanged: 18,
    additions: 1240,
    deletions: 86,
    refs: ["HEAD", "main"],
  },
  {
    id: "cm2",
    hash: "b1e92d4c8a7f3e2b1c0d9e8f7a6b5c4d",
    shortHash: "b1e92d4",
    message: "feat: command palette, quick open, and global search",
    author: "Maryam",
    email: "maryam@lens.app",
    avatarColor: "#FCAA26",
    timestamp: "2026-08-06T08:10:00Z",
    relativeTime: "4 hours ago",
    filesChanged: 14,
    additions: 980,
    deletions: 42,
  },
  {
    id: "cm3",
    hash: "c4d7e8f90123456789abcdef01234567",
    shortHash: "c4d7e8f",
    message: "feat: Cursor-style AI panel with streaming and diffs",
    author: "Alex Chen",
    email: "alex@lens.app",
    avatarColor: "#60A5FA",
    timestamp: "2026-08-05T16:40:00Z",
    relativeTime: "yesterday",
    filesChanged: 22,
    additions: 2100,
    deletions: 310,
  },
  {
    id: "cm4",
    hash: "d9e0f1a2b3c4d5e6f7890123456789ab",
    shortHash: "d9e0f1a",
    message: "chore: initialize IDE shell and design tokens",
    author: "Alex Chen",
    email: "alex@lens.app",
    avatarColor: "#60A5FA",
    timestamp: "2026-08-04T12:00:00Z",
    relativeTime: "2 days ago",
    filesChanged: 30,
    additions: 3400,
    deletions: 0,
  },
  {
    id: "cm5",
    hash: "e1f2a3b4c5d6e7f8091a2b3c4d5e6f70",
    shortHash: "e1f2a3b",
    message: "Initial commit: Lens desktop Tauri + React IDE",
    author: "Maryam",
    email: "maryam@lens.app",
    avatarColor: "#FCAA26",
    timestamp: "2026-08-01T09:00:00Z",
    relativeTime: "5 days ago",
    filesChanged: 45,
    additions: 5200,
    deletions: 0,
    refs: ["origin/main"],
  },
];

export const MOCK_CONFLICTS: MergeConflict[] = [
  {
    id: "cf1",
    path: "src/components/shell/StatusBar.tsx",
    currentLabel: "HEAD (main)",
    incomingLabel: "feat/source-control",
    currentContent: `  <button type="button" className="flex items-center gap-1">
    <GitBranch className="h-3 w-3" />
    <span>{project.branch}</span>
  </button>`,
    incomingContent: `  <button type="button" onClick={openGit} className="flex items-center gap-1">
    <GitBranch className="h-3 w-3" />
    <span>{branch}</span>
    {ahead > 0 && <span>↑{ahead}</span>}
    {behind > 0 && <span>↓{behind}</span>}
  </button>`,
    resolved: null,
  },
];

export const COMMIT_TEMPLATES: CommitTemplate[] = [
  { id: "t1", label: "feat", message: "feat: ", description: "A new feature" },
  { id: "t2", label: "fix", message: "fix: ", description: "A bug fix" },
  { id: "t3", label: "chore", message: "chore: ", description: "Maintenance" },
  { id: "t4", label: "docs", message: "docs: ", description: "Documentation" },
  { id: "t5", label: "refactor", message: "refactor: ", description: "Code change that neither fixes a bug nor adds a feature" },
];

export const RECENT_MESSAGES = [
  "feat: add terminal workspace with JetBrains-inspired UX",
  "feat: command palette, quick open, and global search",
  "fix: resolve panel resize edge case",
];
