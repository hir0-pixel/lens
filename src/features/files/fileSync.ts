/**
 * Real-time two-way file content sync across windows (Tauri + Browser).
 * Uses BroadcastChannel + localStorage events.
 */

const SYNC_CHANNEL_NAME = "lens-file-sync";
const STORAGE_PREFIX = "lens-file-content:";

const DEFAULT_FILES: Record<string, string> = {
  "src/App.tsx": `import { SavingsGoals } from "./components/SavingsGoals";
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
  "src/main.tsx": `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);`,
  "src/components/Sidebar.tsx": `import { Home, LineChart, Settings, Wallet } from "@/components/icons/tabler";

export function Sidebar() {
  return (
    <aside className="p-4 border-r border-[var(--border-default)]">
      <h2 className="text-sm font-semibold text-[var(--accent-primary)] mb-4">Finance</h2>
    </aside>
  );
}`,
  "package.json": `{
  "name": "project",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build"
  }
}`,
  "README.md": `# Project

Welcome to the project repository. Built with React, Vite, and Tailwind CSS.
`,
};

export function getStoredFileContent(path: string): string {
  try {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}${path}`);
    if (saved !== null) return saved;
  } catch {
    /* ignore */
  }
  return DEFAULT_FILES[path] ?? `// File: ${path}\n// Created by Lens Agent\n`;
}

export function saveStoredFileContent(path: string, content: string): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${path}`, content);
  } catch {
    /* ignore */
  }

  // Broadcast to other windows
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const bc = new BroadcastChannel(SYNC_CHANNEL_NAME);
      bc.postMessage({ type: "file-change", path, content, timestamp: Date.now() });
      bc.close();
    }
  } catch {
    /* ignore */
  }
}

export function subscribeFileChanges(
  callback: (path: string, content: string) => void,
): () => void {
  let bc: BroadcastChannel | null = null;

  try {
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel(SYNC_CHANNEL_NAME);
      bc.onmessage = (event) => {
        if (event.data?.type === "file-change") {
          callback(event.data.path, event.data.content);
        }
      };
    }
  } catch {
    /* ignore */
  }

  const handleStorage = (e: StorageEvent) => {
    if (e.key && e.key.startsWith(STORAGE_PREFIX)) {
      const path = e.key.slice(STORAGE_PREFIX.length);
      const content = e.newValue ?? "";
      callback(path, content);
    }
  };

  window.addEventListener("storage", handleStorage);

  return () => {
    bc?.close();
    window.removeEventListener("storage", handleStorage);
  };
}
