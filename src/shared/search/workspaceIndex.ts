export type WorkspaceFileKind = "file" | "folder";

export interface WorkspaceFile {
  id: string;
  path: string;
  name: string;
  language: string;
  kind: WorkspaceFileKind;
  content?: string;
  parent?: string;
}

export interface WorkspaceSymbol {
  id: string;
  name: string;
  kind: "function" | "class" | "interface" | "variable" | "component" | "type";
  file: string;
  line: number;
  detail?: string;
}

const FILE_CONTENTS: Record<string, { lang: string; content: string }> = {
  "src/App.tsx": {
    lang: "typescript",
    content: `import { SavingsGoals } from "./components/SavingsGoals";
import { CashFlowChart } from "./components/CashFlowChart";
import { Sidebar } from "./components/Sidebar";

export default function App() {
  return (
    <div className="grid h-screen grid-cols-[240px_1fr] bg-[var(--bg-base)] text-[var(--text-primary)]">
      <Sidebar />
      <main className="overflow-y-auto p-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">Finance Dashboard</h1>
          <p className="text-[var(--text-secondary)]">Personal money overview</p>
        </header>
        <CashFlowChart />
        <SavingsGoals />
      </main>
    </div>
  );
}`,
  },
  "src/main.tsx": {
    lang: "typescript",
    content: `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);`,
  },
  "src/index.css": {
    lang: "css",
    content: `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --accent: var(--accent-primary);
  --surface: var(--bg-base);
}`,
  },
  "src/components/Sidebar.tsx": {
    lang: "typescript",
    content: `import { Coins, Home, LineChart, Settings, Wallet } from "lucide-react";

const NAV = [
  { label: "Overview", icon: Home },
  { label: "Accounts", icon: Wallet },
  { label: "Budgets", icon: LineChart },
  { label: "Settings", icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="border-r border-[var(--border-default)] p-4">
      <h2 className="mb-4 text-sm font-semibold text-[var(--accent-primary)]">Finance</h2>
      <nav className="space-y-1">
        {NAV.map((item) => (
          <a key={item.label} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
            <item.icon className="h-4 w-4" />
            {item.label}
          </a>
        ))}
      </nav>
    </aside>
  );
}`,
  },
  "src/components/SavingsGoals.tsx": {
    lang: "typescript",
    content: `const GOALS = [
  { label: "Emergency Fund", current: 48, total: 10_000, color: "var(--accent-primary)" },
  { label: "Trip to Japan", current: 72, total: 6_000, color: "var(--success)" },
  { label: "New Laptop", current: 35, total: 2_500, color: "var(--info)" },
];

export function SavingsGoals() {
  return (
    <section className="mt-6 rounded-lg border border-[var(--border-default)] bg-[var(--bg-hover)] p-5">
      <h2 className="mb-3 text-base font-semibold">Savings Goals</h2>
      <div className="space-y-4">
        {GOALS.map((goal) => (
          <div key={goal.label}>
            <div className="mb-1 flex justify-between text-sm">
              <span>{goal.label}</span>
              <span className="text-[var(--text-secondary)]">
                \${goal.current * 100} / \${goal.total.toLocaleString()}
              </span>
            </div>
            <div className="h-2 rounded-full bg-[var(--bg-hover)]">
              <div className="h-full rounded-full" style={{ width: \`\${goal.current}%\`, background: goal.color }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}`,
  },
  "src/components/CashFlowChart.tsx": {
    lang: "typescript",
    content: `const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const VALUES = [4200, 3800, 5100, 4700, 5300, 4900];

export function CashFlowChart() {
  const max = Math.max(...VALUES);
  return (
    <section className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-hover)] p-5">
      <h2 className="mb-4 text-base font-semibold">Monthly Cash Flow</h2>
      <div className="flex h-40 items-end gap-3">
        {MONTHS.map((m, i) => (
          <div key={m} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-t bg-[var(--accent-primary)]/80"
              style={{ height: \`\${(VALUES[i] / max) * 100}%\` }}
            />
            <span className="text-xs text-[var(--text-primary)]0">{m}</span>
          </div>
        ))}
      </div>
    </section>
  );
}`,
  },
  "package.json": {
    lang: "json",
    content: `{
  "name": "finance-dashboard",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build"
  }
}`,
  },
  "vite.config.ts": {
    lang: "typescript",
    content: `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});`,
  },
  "tsconfig.json": {
    lang: "json",
    content: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "jsx": "react-jsx",
    "strict": true
  }
}`,
  },
  "src/stores/layoutStore.ts": {
    lang: "typescript",
    content: `import { create } from "zustand";

export const useLayoutStore = create(() => ({
  bottomPanelOpen: false,
  aiPanelOpen: true,
}));`,
  },
  "src/lib/types.ts": {
    lang: "typescript",
    content: `export type AgentMode = "agent" | "ask" | "edit";
export interface Project {
  id: string;
  name: string;
  path: string;
}`,
  },
  "README.md": {
    lang: "markdown",
    content: `# Finance Dashboard

Personal finance overview built with React + Vite + Tailwind.

## Getting started

\`\`\`bash
npm install
npm run dev
\`\`\`
`,
  },
};

const SYMBOLS: WorkspaceSymbol[] = [
  { id: "s1", name: "App", kind: "component", file: "src/App.tsx", line: 5, detail: "default export" },
  { id: "s2", name: "Sidebar", kind: "component", file: "src/components/Sidebar.tsx", line: 12, detail: "export function" },
  { id: "s3", name: "NAV", kind: "variable", file: "src/components/Sidebar.tsx", line: 3 },
  { id: "s4", name: "SavingsGoals", kind: "component", file: "src/components/SavingsGoals.tsx", line: 8 },
  { id: "s5", name: "GOALS", kind: "variable", file: "src/components/SavingsGoals.tsx", line: 1 },
  { id: "s6", name: "CashFlowChart", kind: "component", file: "src/components/CashFlowChart.tsx", line: 4 },
  { id: "s7", name: "MONTHS", kind: "variable", file: "src/components/CashFlowChart.tsx", line: 1 },
  { id: "s8", name: "VALUES", kind: "variable", file: "src/components/CashFlowChart.tsx", line: 2 },
  { id: "s9", name: "Project", kind: "interface", file: "src/lib/types.ts", line: 2 },
  { id: "s10", name: "AgentMode", kind: "type", file: "src/lib/types.ts", line: 1 },
  { id: "s11", name: "useLayoutStore", kind: "function", file: "src/stores/layoutStore.ts", line: 3 },
];

function pathToFile(path: string): WorkspaceFile {
  const name = path.split("/").pop() ?? path;
  const entry = FILE_CONTENTS[path];
  return {
    id: path,
    path,
    name,
    language: entry?.lang ?? "plaintext",
    kind: "file",
    content: entry?.content,
    parent: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : undefined,
  };
}

export function getWorkspaceFiles(): WorkspaceFile[] {
  return Object.keys(FILE_CONTENTS).map(pathToFile);
}

export function getFileContent(path: string): string | undefined {
  return FILE_CONTENTS[path]?.content;
}

export function getWorkspaceSymbols(): WorkspaceSymbol[] {
  return SYMBOLS;
}

export function getOpenFiles(): string[] {
  return ["src/App.tsx", "src/components/Sidebar.tsx"];
}

export function getRecentFiles(): string[] {
  return [
    "src/App.tsx",
    "src/components/CashFlowChart.tsx",
    "package.json",
    "src/index.css",
    "vite.config.ts",
  ];
}

export function getPinnedFiles(): string[] {
  return ["src/App.tsx", "package.json"];
}
