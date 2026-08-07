import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { useEditorChromeStore } from "@/stores/editorChromeStore";

const FILES: Record<string, { lang: string; content: string }> = {
  "src/App.tsx": {
    lang: "typescript",
    content: `import { SavingsGoals } from "./components/SavingsGoals";
import { CashFlowChart } from "./components/CashFlowChart";
import { Sidebar } from "./components/Sidebar";

export default function App() {
  return (
    <div className="grid h-screen grid-cols-[240px_1fr] bg-zinc-950 text-zinc-50">
      <Sidebar />
      <main className="overflow-y-auto p-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">Finance Dashboard</h1>
          <p className="text-zinc-400">Personal money overview</p>
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
    content: `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);`,
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
    <aside className="border-r border-white/10 p-4">
      <h2 className="mb-4 text-sm font-semibold text-amber-400">Finance</h2>
      <nav className="space-y-1">
        {NAV.map((item) => (
          <a
            key={item.label}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-300 hover:bg-white/5"
          >
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
  { label: "Trip to Japan", current: 72, total: 6_000, color: "#34D399" },
  { label: "New Laptop", current: 35, total: 2_500, color: "#60A5FA" },
];

export function SavingsGoals() {
  return (
    <section className="mt-6 rounded-lg border border-white/10 bg-white/5 p-5">
      <h2 className="mb-3 text-base font-semibold">Savings Goals</h2>
      <div className="space-y-4">
        {GOALS.map((goal) => (
          <div key={goal.label}>
            <div className="mb-1 flex justify-between text-sm">
              <span>{goal.label}</span>
              <span className="text-zinc-400">
                \${goal.current * 100} / \${goal.total.toLocaleString()}
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/10">
              <div
                className="h-full rounded-full"
                style={{
                  width: \`\${goal.current}%\`,
                  backgroundColor: goal.color,
                }}
              />
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
    content: `export function CashFlowChart() {
  const data = [40, 65, 45, 80, 55, 90];
  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-5">
      <h2 className="mb-4 text-base font-semibold">Cash Flow</h2>
      <div className="flex h-32 items-end gap-3">
        {data.map((height, i) => (
          <div key={i} className="flex-1">
            <div
              className="max-w-10 rounded-t bg-[var(--accent-primary-muted)] transition-all hover:bg-[var(--accent-primary)]"
              style={{ height: \`\${height}%\` }}
            />
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
};

function languageForPath(path: string): string {
  if (path.endsWith(".tsx") || path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".md")) return "markdown";
  return "plaintext";
}

interface EditorViewProps {
  /** Absolute or workspace-relative path from editor tabs / explorer */
  path?: string;
}

/**
 * Monaco editor surface only — tabs/explorer live in the workbench shell.
 */
export default function EditorView({ path = "src/App.tsx" }: EditorViewProps) {
  const known = FILES[path];
  const baseline = known?.content ?? `// ${path}\n`;
  const [value, setValue] = useState(baseline);
  const markDirty = useEditorChromeStore((s) => s.markDirty);
  const setCursor = useEditorChromeStore((s) => s.setCursor);
  const setActivePath = useEditorChromeStore((s) => s.setActivePath);
  const baselineRef = useRef(baseline);

  useEffect(() => {
    const next = FILES[path]?.content ?? `// ${path}\n`;
    baselineRef.current = next;
    setValue(next);
    markDirty(path, false);
    setActivePath(path);
  }, [path, markDirty, setActivePath]);

  return (
    <div className="h-full min-h-0 bg-[var(--ds-editor)]">
      <Editor
        height="100%"
        path={path}
        language={known?.lang ?? languageForPath(path)}
        value={value}
        onChange={(v) => {
          const next = v ?? "";
          setValue(next);
          markDirty(path, next !== baselineRef.current);
        }}
        onMount={(editor, monaco) => {
          editor.onDidChangeCursorPosition((e) => {
            setCursor(e.position.lineNumber, e.position.column);
          });
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
            void editor.getAction("actions.find")?.run();
          });
        }}
        theme="vs-dark"
        loading={
          <div className="flex h-full items-center justify-center bg-[var(--ds-editor)] text-[12px] text-[var(--ds-fg-muted)]">
            Loading editor…
          </div>
        }
        options={{
          fontSize: 13,
          fontFamily: "var(--ds-font-mono)",
          fontLigatures: true,
          minimap: { enabled: true, maxColumn: 80 },
          find: { addExtraSpaceOnTop: false, autoFindInSelection: "never" },
          scrollBeyondLastLine: false,
          padding: { top: 8 },
          renderLineHighlight: "line",
          lineNumbers: "on",
          lineNumbersMinChars: 3,
          guides: { indentation: true, bracketPairs: true },
          bracketPairColorization: { enabled: true },
          matchBrackets: "always",
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          smoothScrolling: true,
          scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
            useShadows: false,
          },
          overviewRulerBorder: false,
          hideCursorInOverviewRuler: true,
        }}
      />
    </div>
  );
}
