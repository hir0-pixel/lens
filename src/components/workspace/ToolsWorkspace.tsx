import {
  Brain,
  Database,
  Eye,
  FileCode2,
  GitBranch,
  ScrollText,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import { useEffect } from "react";
import OutputTabs from "@/components/output/OutputTabs";
import { SourceControlPanel } from "@/features/source-control/SourceControlPanel";
import {
  type ToolsTabKind,
  useLayoutStore,
} from "@/stores/layoutStore";
import { cn } from "@/lib/utils";

const TOOL_META: Record<
  ToolsTabKind,
  {
    label: string;
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  }
> = {
  editor: { label: "Editor", icon: FileCode2 },
  browser: { label: "Browser", icon: Eye },
  preview: { label: "Preview", icon: Eye },
  terminal: { label: "Terminal", icon: Terminal },
  git: { label: "Git", icon: GitBranch },
  logs: { label: "Logs", icon: ScrollText },
  tasks: { label: "Tasks", icon: Sparkles },
  memory: { label: "Memory", icon: Brain },
  database: { label: "Database", icon: Database },
};

/**
 * Side tools pane — Editor / Terminal / Browser tabs (Cursor-style right dock).
 */
export function ToolsWorkspace() {
  const activeToolsTab = useLayoutStore((s) => s.activeToolsTab);
  const setActiveToolsTab = useLayoutStore((s) => s.setActiveToolsTab);
  const openTools = useLayoutStore((s) => s.openTools);
  const closeTools = useLayoutStore((s) => s.closeTools);

  useEffect(() => {
    function onOpenFile() {
      openTools("editor");
      setActiveToolsTab("editor");
    }
    function onFocusTerminal() {
      openTools("terminal");
      setActiveToolsTab("terminal");
    }
    window.addEventListener("lens:open-file", onOpenFile);
    window.addEventListener("lens:focus-terminal", onFocusTerminal);
    return () => {
      window.removeEventListener("lens:open-file", onOpenFile);
      window.removeEventListener("lens:focus-terminal", onFocusTerminal);
    };
  }, [openTools, setActiveToolsTab]);

  const showEditorSurface =
    activeToolsTab === "editor" ||
    activeToolsTab === "browser" ||
    activeToolsTab === "preview" ||
    activeToolsTab === "terminal" ||
    activeToolsTab === "tasks";

  const editorActive =
    activeToolsTab === "editor" ||
    activeToolsTab === "preview" ||
    activeToolsTab === "tasks";

  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--bg-canvas)] animate-cursor-fade">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1">
        <button
          type="button"
          onClick={() => setActiveToolsTab("editor")}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px]",
            editorActive
              ? "bg-[var(--bg-selected)] text-[var(--text-primary)]"
              : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]",
          )}
        >
          + Changes
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveToolsTab("terminal");
            window.dispatchEvent(new CustomEvent("lens:focus-terminal"));
          }}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md px-2 font-mono text-[12px]",
            activeToolsTab === "terminal"
              ? "bg-[var(--bg-selected)] text-[var(--text-primary)]"
              : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]",
          )}
        >
          &gt;_ powershell
        </button>
        <button
          type="button"
          onClick={() => setActiveToolsTab("browser")}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px]",
            activeToolsTab === "browser"
              ? "bg-[var(--bg-selected)] text-[var(--text-primary)]"
              : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]",
          )}
        >
          Browser
        </button>
        <span className="flex-1" />
        <button
          type="button"
          className="btn-ghost h-6 w-6"
          aria-label={`Close ${TOOL_META[activeToolsTab].label}`}
          title="Close pane"
          onClick={closeTools}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {showEditorSurface && <OutputTabs />}
        {activeToolsTab === "git" && <SourceControlPanel />}
        {activeToolsTab === "logs" && (
          <ToolStub title="Logs" body="Application and agent run logs." />
        )}
        {activeToolsTab === "memory" && (
          <ToolStub title="Memory" body="Session and long-term agent memory." />
        )}
        {activeToolsTab === "database" && (
          <ToolStub
            title="Database"
            body="Query runner and schema browser."
          />
        )}
      </div>
    </div>
  );
}

function ToolStub({ title, body }: { title: string; body: string }) {
  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center gap-2 px-6 text-center",
        "bg-[var(--bg-canvas)]",
      )}
    >
      <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">
        {title}
      </h3>
      <p className="max-w-xs text-[12px] leading-5 text-[var(--text-secondary)]">
        {body}
      </p>
      <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
        Coming soon — this pane isn’t connected yet.
      </p>
    </div>
  );
}

export default ToolsWorkspace;
