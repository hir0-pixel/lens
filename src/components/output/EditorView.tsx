import { useState } from "react";
import Editor from "@monaco-editor/react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileJson,
  File as FileIcon,
  Folder as FolderIcon,
  FolderOpen,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "../../lib/utils";

interface FileNode {
  name: string;
  lang?: string;
  children?: FileNode[];
}

const FILE_TREE: FileNode[] = [
  {
    name: "src",
    children: [
      { name: "App.tsx", lang: "typescript" },
      { name: "main.tsx", lang: "typescript" },
      { name: "index.css", lang: "css" },
      {
        name: "components",
        children: [
          { name: "Sidebar.tsx", lang: "typescript" },
          { name: "SavingsGoals.tsx", lang: "typescript" },
          { name: "CashFlowChart.tsx", lang: "typescript" },
        ],
      },
    ],
  },
  { name: "package.json", lang: "json" },
  { name: "vite.config.ts", lang: "typescript" },
  { name: "tsconfig.json", lang: "json" },
];

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
            className="flex items-center gap-2 rounded-md px-3 py-2
                       text-sm text-zinc-300 hover:bg-white/5"
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
  { label: "Emergency Fund", current: 48, total: 10_000, color: "#FCAA26" },
  { label: "Trip to Japan", current: 72, total: 6_000, color: "#34D399" },
  { label: "New Laptop", current: 35, total: 2_500, color: "#60A5FA" },
];

export function SavingsGoals() {
  return (
    <section className="mt-6 rounded-lg border border-white/10 bg-white/5 p-5">
      <h2 className="mb-3 text-base font-semibold">Savings Goals</h2>
      <div className="space-y-4">
        {GOALS.map((goal) => (
          <div key={\${goal.label}}>
            <div className="mb-1 flex justify-between text-sm">
              <span>{\${goal.label}}</span>
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
              className="max-w-10 rounded-t bg-[#FCAA26]/25
                          transition-all hover:bg-[#FCAA26]/50"
              style={{ height: \`\${height}%\` }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}`,
  },
};

function TreeNode({
  node,
  depth,
  onOpen,
  activePath,
}: {
  node: FileNode;
  depth: number;
  onOpen: (path: string) => void;
  activePath: string;
}) {
  const [open, setOpen] = useState(true);

  const fullPath = node.children ? "" : `src/${node.name}`;

  if (node.children) {
    return (
      <div>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{ paddingLeft: depth * 14 }}
          className="flex w-full items-center gap-1.5 rounded py-1 pr-2 text-[12.5px] text-zinc-300 hover:bg-white/5"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
          )}
          {open ? (
            <FolderOpen className="h-3.5 w-3.5 text-accent" />
          ) : (
            <FolderIcon className="h-3.5 w-3.5 text-accent" />
          )}
          {node.name}
        </button>
        {open && (
          <div>
            {node.children.map((child) => (
              <TreeNode
                key={child.name}
                node={child}
                depth={depth + 1}
                onOpen={onOpen}
                activePath={activePath}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onOpen(fullPath)}
      style={{ paddingLeft: depth * 14 + 20 }}
      className={cn(
        "flex w-full items-center gap-1.5 rounded py-1 pr-2 text-[12.5px]",
        fullPath === activePath
          ? "bg-white/10 text-white"
          : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
      )}
    >
      <FileIcon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export default function EditorView() {
  const [activePath, setActivePath] = useState("src/App.tsx");
  const openFile = FILES[activePath] ?? FILES["src/App.tsx"];

  return (
    <div className="flex h-full bg-surface-0">
      {/* File tree */}
      <div className="w-56 shrink-0 overflow-y-auto border-r border-white/5 bg-surface-1 p-2">
        <div className="mb-1 flex items-center justify-between px-2 py-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Explorer
          </span>
          <MoreHorizontal className="h-3.5 w-3.5 text-zinc-500" />
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 text-[12px] text-zinc-400">
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          finance-dashboard
        </div>
        <div className="-ml-2 mt-1">
          {FILE_TREE.map((node) => (
            <TreeNode
              key={node.name}
              node={node}
              depth={0}
              onOpen={setActivePath}
              activePath={activePath}
            />
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Tab strip */}
        <div className="flex items-center border-b border-white/5 bg-surface-1">
          <div className="flex items-center gap-0.5 overflow-x-auto px-1 pt-1.5">
            {Object.keys(FILES).map((path) => {
              const name = path.split("/").pop()!;
              const active = path === activePath;
              const icon =
                name.endsWith(".json") ? (
                  <FileJson className="h-3 w-3 text-lime-400" />
                ) : (
                  <FileIcon className="h-3 w-3 text-sky-400" />
                );
              return (
                <button
                  key={path}
                  onClick={() => setActivePath(path)}
                  className={cn(
                    "flex min-w-0 items-center gap-1.5 rounded-t-md border-b-2 px-2.5 py-1.5 text-[12px] transition-colors",
                    active
                      ? "border-accent bg-surface-0 text-zinc-100"
                      : "border-transparent text-zinc-500 hover:text-zinc-300",
                  )}
                >
                  {icon}
                  <span className="truncate">{name}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1">
          <Editor
            height="100%"
            language={openFile.lang}
            value={openFile.content}
            theme="vs-dark"
            loading={<div className="h-full bg-surface-0" />}
            options={{
              fontSize: 13,
              fontFamily:
                "JetBrains Mono, Geist Mono, Menlo, Consolas, monospace",
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              padding: { top: 12 },
              renderLineHighlight: "none",
              lineNumbersMinChars: 3,
              scrollbar: {
                verticalScrollbarSize: 10,
                horizontalScrollbarSize: 10,
              },
            }}
          />
        </div>
      </div>
    </div>
  );
}