import { useCallback, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  FilePlus2,
  Globe,
  MessageSquare,
  Plus,
  Search,
  SquareTerminal,
  X,
} from "lucide-react";
import TerminalView from "@/components/output/TerminalView";
import BrowserView from "@/components/output/BrowserView";
import { useGitStore } from "@/stores/gitStore";
import { useSessionStore } from "@/stores/sessionStore";
import { cn } from "@/lib/utils";

export type AgentsDockKind =
  | "picker"
  | "terminal"
  | "browser"
  | "review"
  | "conversation"
  | null;

interface AgentsSideDockProps {
  kind: AgentsDockKind;
  onClose: () => void;
  onOpenTab?: (kind: Exclude<AgentsDockKind, null | "picker">) => void;
  initialWidthPx?: number;
}

const TAB_OPTIONS: {
  kind: Exclude<AgentsDockKind, null | "picker">;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}[] = [
  { kind: "conversation", label: "Side conversation", icon: MessageSquare },
  { kind: "review", label: "Review", icon: FilePlus2 },
  { kind: "terminal", label: "Terminal", icon: SquareTerminal },
  { kind: "browser", label: "Browser", icon: Globe },
];

function tabLabel(kind: AgentsDockKind) {
  if (kind === "terminal") return ">_ shell";
  if (kind === "browser") return "Browser";
  if (kind === "review") return "Review";
  if (kind === "conversation") return "Side conversation";
  return "Open tab";
}

/**
 * Right-side dock on the Agents window — picker, review, terminal, browser.
 */
export function AgentsSideDock({
  kind,
  onClose,
  onOpenTab,
  initialWidthPx = 480,
}: AgentsSideDockProps) {
  const [selectMode, setSelectMode] = useState(false);
  const [width, setWidth] = useState(initialWidthPx);
  const dragging = useRef(false);
  const repositories = useSessionStore((s) => s.repositories);
  const activeRepositoryId = useSessionStore((s) => s.activeRepositoryId);
  const activeRepo = repositories.find((r) => r.id === activeRepositoryId);
  const cwd = activeRepo?.path;
  const changes = useGitStore((s) => s.changes);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!dragging.current) return;
    const next = Math.min(
      Math.max(window.innerWidth - e.clientX, 280),
      Math.floor(window.innerWidth * 0.7),
    );
    setWidth(next);
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove]);

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    dragging.current = true;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  if (!kind) return null;

  function pick(next: Exclude<AgentsDockKind, null | "picker">) {
    if (onOpenTab) onOpenTab(next);
    else
      window.dispatchEvent(
        new CustomEvent("lens:open-agents-tab", { detail: { kind: next } }),
      );
  }

  return (
    <aside
      className={cn(
        "relative flex h-full shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-surface)]",
        "animate-in slide-in-from-right duration-[var(--duration-slow)]",
      )}
      style={{ width }}
      aria-label={tabLabel(kind)}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        onPointerDown={startResize}
        className="absolute left-0 top-0 z-10 h-full w-1 -translate-x-1/2 cursor-col-resize hover:bg-[var(--accent-primary)]/40"
      />

      {kind === "picker" ? (
        <div className="flex min-h-0 flex-1 flex-col px-8 pt-16">
          <h2 className="text-[22px] font-medium tracking-tight text-[var(--text-primary)]">
            Open tab
          </h2>
          <p className="mt-1.5 text-[13.5px] text-[var(--text-tertiary)]">
            Choose a tab to open in the side pane.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-3">
            {TAB_OPTIONS.map(({ kind: tab, label, icon: Icon }) => (
              <button
                key={tab}
                type="button"
                onClick={() => pick(tab)}
                className="flex h-[92px] flex-col items-start justify-center gap-3 rounded-2xl bg-[var(--bg-surface-raised)] px-5 text-left hover:bg-[var(--bg-hover)]"
              >
                <Icon className="h-5 w-5 text-[var(--text-secondary)]" strokeWidth={1.5} />
                <span className="text-[14px] text-[var(--text-primary)]">{label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Tab strip */}
          <div className="flex h-9 shrink-0 items-center border-b border-[var(--border-subtle)] px-1">
            <span className="inline-flex h-7 items-center rounded-md bg-[var(--bg-hover)] px-2.5 text-[12px] font-medium text-[var(--text-primary)]">
              {kind === "review" ? (
                <>
                  <FilePlus2 className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
                  Files Changed {changes.length || ""}
                </>
              ) : (
                tabLabel(kind)
              )}
            </span>
            {kind === "terminal" && cwd && (
              <span className="ml-1 max-w-[200px] truncate font-mono text-[11px] text-[var(--text-tertiary)]" title={cwd}>
                {cwd}
              </span>
            )}
            <button
              type="button"
              className="ml-1 flex h-7 w-7 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              aria-label="New tab"
              title="New tab"
              onClick={() => pick("review")}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <button
              type="button"
              className="ml-auto flex h-7 w-7 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              aria-label="Close panel"
              title="Close"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {kind === "terminal" && <TerminalView cwd={cwd} />}
            {kind === "browser" && (
              <BrowserView
                selectMode={selectMode}
                onToggleSelectMode={() => setSelectMode((v) => !v)}
              />
            )}
            {kind === "review" && <ReviewPanel changes={changes} />}
            {kind === "conversation" && (
              <div className="flex h-full flex-col items-center justify-center bg-[var(--bg-surface)] px-6 text-center">
                <MessageSquare className="mb-3 h-8 w-8 text-[var(--text-tertiary)]" strokeWidth={1.4} />
                <p className="text-[14px] text-[var(--text-secondary)]">Side conversation</p>
                <p className="mt-1 max-w-[240px] text-[12.5px] text-[var(--text-tertiary)]">
                  Start a parallel thread without leaving this chat.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function ReviewPanel({ changes }: { changes: { id: string; path: string; additions: number; deletions: number }[] }) {
  const [filter, setFilter] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const totalAdd = changes.reduce((s, f) => s + f.additions, 0);
  const totalDel = changes.reduce((s, f) => s + f.deletions, 0);

  const filtered = filter
    ? changes.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase()))
    : changes;

  const groupByDir = (files: typeof changes) => {
    const dirs = new Map<string, typeof changes>();
    for (const f of files) {
      const parts = f.path.split("/");
      const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
      if (!dirs.has(dir)) dirs.set(dir, []);
      dirs.get(dir)!.push(f);
    }
    return dirs;
  };

  const groups = groupByDir(filtered);
  const sel = changes.find((f) => f.id === selectedFile);

  const iconBtn = "rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";

  return (
    <div className="flex h-full flex-col bg-[var(--bg-surface)]">
      {/* Git changes header */}
      <div className="flex items-center gap-3 px-3 py-1.5">
        <button type="button" className="flex items-center gap-1 text-[13px] font-semibold text-[var(--text-primary)]">
          Git changes <ChevronDown className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        </button>
        {changes.length > 0 && (
          <span className="text-[12px]">
            <span className="text-[var(--success)]">+{totalAdd}</span>{" "}
            <span className="text-[var(--error)]">-{totalDel}</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" className={iconBtn} title="Previous change">
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={iconBtn} title="Next change">
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          {/* Sort / filter */}
          <button type="button" className={iconBtn} title="Sort">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M4 4v8M4 12l-2-2M4 12l2-2M8 4h6M8 7h4M8 10h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {/* AI / sparkle */}
          <button type="button" className={iconBtn} title="AI review">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
              <path d="M12 2l.5 1.5L14 4l-1.5.5L12 6l-.5-1.5L10 4l1.5-.5z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
            </svg>
          </button>
          {/* Inline diff view */}
          <button type="button" className={iconBtn} title="Inline view">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M4 6h8M4 8.5h8M4 11h5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            </svg>
          </button>
          {/* Split diff view */}
          <button type="button" className={iconBtn} title="Split view">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M8 3v10" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Selected file header */}
      {sel && (
        <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] px-3 py-1.5">
          <SettingsGearIcon />
          <span className="text-[12px] font-medium text-[var(--text-primary)]">
            {sel.path.split("/").pop()}
          </span>
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {sel.path.split("/").slice(0, -1).join("/")}/
          </span>
          <span className="ml-auto text-[11px]">
            <span className="text-[var(--success)]">+{sel.additions}</span>{" "}
            <span className="text-[var(--error)]">-{sel.deletions}</span>
          </span>
        </div>
      )}

      {/* Filter input */}
      <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] px-3 py-1.5">
        <Search className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        <input
          type="text"
          placeholder="Filter files"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 bg-transparent text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none"
        />
      </div>

      {/* File tree / empty state */}
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--border-subtle)]">
        {changes.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-[14px] text-[var(--text-tertiary)]">No uncommitted changes yet</p>
          </div>
        ) : (
          <div className="py-0.5">
            {[...groups.entries()].map(([dir, files]) => (
              <div key={dir}>
                {dir && (
                  <button type="button" className="flex w-full items-center gap-1 px-2 py-1 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                    <ChevronDown className="h-3 w-3" />
                    <FolderIcon />
                    <span>{dir.split("/").filter(Boolean).join(" › ")}</span>
                  </button>
                )}
                {files.map((file) => {
                  const fname = file.path.split("/").pop() ?? file.path;
                  return (
                    <button
                      key={file.id}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 py-1 text-[12px] hover:bg-[var(--bg-hover)]",
                        dir ? "pl-7 pr-2" : "px-2",
                        selectedFile === file.id && "bg-[var(--bg-active)]",
                      )}
                      onClick={() => setSelectedFile(file.id === selectedFile ? null : file.id)}
                    >
                      <SettingsGearIcon />
                      <span className="min-w-0 flex-1 truncate text-left text-[var(--text-secondary)]">{fname}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsGearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[var(--text-tertiary)]" aria-hidden>
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[var(--text-tertiary)]" aria-hidden>
      <path d="M2 4a1 1 0 011-1h3l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export default AgentsSideDock;
