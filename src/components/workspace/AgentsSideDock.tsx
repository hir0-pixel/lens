import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FilePlus2,
  Folder,
  Globe,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  SquareTerminal,
} from "@/components/icons/tabler";
import TerminalView from "@/components/output/TerminalView";
import BrowserView from "@/components/output/BrowserView";
import { useSessionStore } from "@/stores/sessionStore";
import { isTauri } from "@/features/projects/platform";
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
  onOpenTab?: (kind: Exclude<AgentsDockKind, null | "picker">) => void;
  /** The repository scoped to the current chat, when one is selected. */
  repositoryPath?: string;
  initialWidthPx?: number;
  closing?: boolean;
  onExited?: () => void;
}

interface ProjectGitChange {
  id: string;
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict";
  additions: number;
  deletions: number;
}

// Keep the review readable without letting it consume the workspace on wide displays.
const MAX_RIGHT_DOCK_WIDTH = 768;

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
  onOpenTab,
  repositoryPath,
  initialWidthPx = 480,
  closing = false,
  onExited,
}: AgentsSideDockProps) {
  const [selectMode, setSelectMode] = useState(false);
  const [width, setWidth] = useState(initialWidthPx);
  const [entered, setEntered] = useState(false);
  const dragging = useRef(false);
  const repositories = useSessionStore((s) => s.repositories);
  const activeRepositoryId = useSessionStore((s) => s.activeRepositoryId);
  const activeRepo = repositories.find((r) => r.id === activeRepositoryId);
  const cwd = repositoryPath ?? activeRepo?.path;
  const [changes, setChanges] = useState<ProjectGitChange[]>([]);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitError, setGitError] = useState<string | null>(null);
  const [gitRevision, setGitRevision] = useState(0);

  useEffect(() => {
    if (kind !== "review") return;
    setWidth((current) =>
      Math.min(
        current < 680 ? Math.floor(window.innerWidth * 0.66) : current,
        MAX_RIGHT_DOCK_WIDTH,
      ),
    );
  }, [kind]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const loadGitChanges = useCallback(async (quiet = false) => {
    if (!cwd) {
      setChanges([]);
      setGitError("Choose a project to view Git changes.");
      return;
    }
    if (!isTauri()) {
      setChanges([]);
      setGitError("Git changes are available in the Lens desktop app.");
      return;
    }

    if (!quiet) setGitLoading(true);
    setGitError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<Omit<ProjectGitChange, "id">[]>("git_project_changes", { root: cwd });
      setChanges(result.map((change) => ({ ...change, id: change.path })));
      setGitRevision((revision) => revision + 1);
    } catch (cause) {
      setChanges([]);
      setGitError(cause instanceof Error ? cause.message : "Unable to read Git changes.");
    } finally {
      if (!quiet) setGitLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    if (kind !== "review") return;
    void loadGitChanges();
    const refresh = window.setInterval(() => void loadGitChanges(true), 2000);
    const refreshOnFocus = () => void loadGitChanges(true);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.clearInterval(refresh);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [kind, loadGitChanges]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!dragging.current) return;
    const next = Math.min(
      Math.max(window.innerWidth - e.clientX, 280),
      Math.min(Math.floor(window.innerWidth * 0.7), MAX_RIGHT_DOCK_WIDTH),
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
        "relative flex h-full shrink-0 flex-col overflow-hidden border-l border-[var(--border-default)] bg-[var(--bg-surface)]",
        "transition-[width,opacity] duration-[var(--duration-base)] ease-[var(--ease-standard)]",
      )}
      style={{ width: entered && !closing ? width : 0, opacity: entered && !closing ? 1 : 0 }}
      onTransitionEnd={(event) => {
        if (closing && event.propertyName === "width") onExited?.();
      }}
      aria-label={tabLabel(kind)}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        onPointerDown={startResize}
        className="absolute left-0 top-0 z-10 h-full w-1 -translate-x-1/2 cursor-col-resize hover:bg-[var(--accent-primary)]/40"
      />

      {/* Tab strip */}
      <div className="flex h-9 shrink-0 items-center border-b border-[var(--border-subtle)] pl-3 pr-0.5">
        <span className="inline-flex h-7 items-center rounded-md bg-[var(--bg-hover)] px-2.5 type-caption font-medium text-[var(--text-primary)]">
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
          <span className="ml-1 max-w-[200px] truncate type-code text-[var(--text-tertiary)]" title={cwd}>
            {cwd}
          </span>
        )}
        {kind !== "picker" && (
          <button
            type="button"
            className="ml-1 flex h-7 w-7 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="New tab"
            title="New tab"
            onClick={() => pick("review")}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {kind === "picker" ? (
          <div className="flex min-h-0 flex-1 flex-col px-8 pt-16">
            <h2 className="type-display-sm text-[var(--text-primary)]">
              Open tab
            </h2>
            <p className="mt-1.5 type-caption text-[var(--text-tertiary)]">
              Choose a tab to open in the side pane.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-3">
              {TAB_OPTIONS.map(({ kind: tab, label, icon: Icon }) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => pick(tab)}
                  className="flex h-[92px] flex-col items-start justify-center gap-3 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-5 text-left hover:bg-[var(--bg-hover)]"
                >
                  <Icon className="h-5 w-5 text-[var(--text-secondary)]" strokeWidth={1.5} />
                  <span className="type-body-sm text-[var(--text-primary)]">{label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {kind === "terminal" && <TerminalView cwd={cwd} />}
            {kind === "browser" && (
              <BrowserView
                selectMode={selectMode}
                onToggleSelectMode={() => setSelectMode((v) => !v)}
              />
            )}
            {kind === "review" && (
              <ReviewPanel
                changes={changes}
                loading={gitLoading}
                error={gitError}
                repositoryPath={cwd}
                revision={gitRevision}
                onRefresh={() => void loadGitChanges()}
              />
            )}
            {kind === "conversation" && (
              <div className="flex h-full flex-col items-center justify-center bg-[var(--bg-surface)] px-6 text-center">
                <MessageSquare className="mb-3 h-8 w-8 text-[var(--text-tertiary)]" strokeWidth={1.4} />
                <p className="type-body-sm text-[var(--text-secondary)]">Side conversation</p>
                <p className="mt-1 max-w-[240px] type-caption text-[var(--text-tertiary)]">
                  Start a parallel thread without leaving this chat.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function ReviewPanel({
  changes,
  loading,
  error,
  repositoryPath,
  revision,
  onRefresh,
}: {
  changes: ProjectGitChange[];
  loading: boolean;
  error: string | null;
  repositoryPath?: string;
  revision: number;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
    () => new Set(),
  );
  const totalAdd = changes.reduce((s, f) => s + f.additions, 0);
  const totalDel = changes.reduce((s, f) => s + f.deletions, 0);

  const filtered = filter
    ? changes.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase()))
    : changes;

  const sel = changes.find((f) => f.id === selectedFile);

  useEffect(() => {
    setSelectedFile((current) =>
      changes.some((change) => change.id === current) ? current : changes[0]?.id ?? null,
    );
  }, [changes]);

  useEffect(() => {
    if (changes.length === 0 || expandedDirectories.size > 0) return;
    const directories = new Set<string>();
    for (const change of changes) {
      const parts = change.path.split("/");
      for (let index = 1; index < parts.length; index += 1) {
        directories.add(parts.slice(0, index).join("/"));
      }
    }
    setExpandedDirectories(directories);
  }, [changes, expandedDirectories.size]);

  const toggleDirectory = (path: string) => {
    setExpandedDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const iconBtn = "rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";

  return (
    <div className="flex h-full flex-col bg-[var(--bg-surface)]">
      <div className="flex items-center gap-3 px-3 py-1.5">
        <button type="button" className="flex items-center gap-1 type-caption font-semibold text-[var(--text-primary)]">
          Git changes <ChevronDown className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        </button>
        {changes.length > 0 && (
          <span className="type-caption">
            <span className="text-[var(--success)]">+{totalAdd}</span>{" "}
            <span className="text-[var(--error)]">-{totalDel}</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" className={iconBtn} title="Refresh changes" aria-label="Refresh changes" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex flex-1 border-t border-[var(--border-subtle)]">
        <div className="flex min-w-[230px] max-w-[300px] flex-[0_0_38%] flex-col border-r border-[var(--border-subtle)]">
          <label className="m-2 flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-input)] px-2 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
            <input
              type="text"
              placeholder="Filter files"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className="min-w-0 flex-1 bg-transparent type-caption text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none"
            />
          </label>
          <div className="min-h-0 flex-1 overflow-auto pb-2">
            {loading ? <ReviewMessage>Reading Git changes…</ReviewMessage> : error ? <ReviewMessage>{error}</ReviewMessage> : changes.length === 0 ? <ReviewMessage>No uncommitted changes yet</ReviewMessage> : (
              <ChangedFileTree
                files={filtered}
                selectedFile={selectedFile}
                expandedDirectories={expandedDirectories}
                forceExpanded={filter.length > 0}
                onToggleDirectory={toggleDirectory}
                onSelectFile={setSelectedFile}
              />
            )}
          </div>
        </div>
        <DiffPreview repositoryPath={repositoryPath} file={sel} revision={revision} />
      </div>
    </div>
  );
}

function ReviewMessage({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center type-caption text-[var(--text-tertiary)]">{children}</p>;
}

function ChangedFileTree({ files, selectedFile, expandedDirectories, forceExpanded, onToggleDirectory, onSelectFile, prefix = "", depth = 0 }: {
  files: ProjectGitChange[];
  selectedFile: string | null;
  expandedDirectories: Set<string>;
  forceExpanded: boolean;
  onToggleDirectory: (path: string) => void;
  onSelectFile: (id: string) => void;
  prefix?: string;
  depth?: number;
}) {
  const directories = new Map<string, ProjectGitChange[]>();
  const directFiles: ProjectGitChange[] = [];
  for (const file of files) {
    const relativePath = prefix ? file.path.slice(prefix.length + 1) : file.path;
    const slash = relativePath.indexOf("/");
    if (slash === -1) directFiles.push(file);
    else {
      const name = relativePath.slice(0, slash);
      const path = prefix ? `${prefix}/${name}` : name;
      directories.set(path, [...(directories.get(path) ?? []), file]);
    }
  }

  return <div>
    {[...directories.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([path, children]) => {
      const name = path.split("/").pop() ?? path;
      const open = forceExpanded || expandedDirectories.has(path);
      return <div key={path}>
        <button type="button" onClick={() => onToggleDirectory(path)} className="flex h-6 w-full items-center gap-1 pr-2 text-left type-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" style={{ paddingLeft: 8 + depth * 14 }}>
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" strokeWidth={1.5} />
          <span className="truncate">{name}</span>
        </button>
        {open && <ChangedFileTree files={children} selectedFile={selectedFile} expandedDirectories={expandedDirectories} forceExpanded={forceExpanded} onToggleDirectory={onToggleDirectory} onSelectFile={onSelectFile} prefix={path} depth={depth + 1} />}
      </div>;
    })}
    {directFiles.sort((left, right) => left.path.localeCompare(right.path)).map((file) => <ChangedFileRow key={file.id} file={file} selected={file.id === selectedFile} depth={depth} onSelect={() => onSelectFile(file.id)} />)}
  </div>;
}

function ChangedFileRow({ file, selected, depth, onSelect }: { file: ProjectGitChange; selected: boolean; depth: number; onSelect: () => void }) {
  const label = file.path.split("/").pop() ?? file.path;
  const statusLabel = file.status === "modified" ? "M" : file.status === "added" ? "A" : file.status === "deleted" ? "D" : file.status === "renamed" ? "R" : file.status === "untracked" ? "U" : "!";
  return <button type="button" onClick={onSelect} className={cn("flex h-6 w-full items-center gap-1.5 pr-2 text-left type-caption hover:bg-[var(--bg-hover)]", selected && "bg-[var(--bg-active)]")} style={{ paddingLeft: 25 + depth * 14 }}>
    <FileCode className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" strokeWidth={1.5} />
    <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{label}</span>
    <span className={cn("type-code text-[10px]", file.status === "deleted" || file.status === "conflict" ? "text-[var(--error)]" : "text-[var(--success)]")} title={file.status}>{statusLabel}</span>
    {file.additions > 0 && <span className="type-code text-[10px] text-[var(--success)]">+{file.additions}</span>}
    {file.deletions > 0 && <span className="type-code text-[10px] text-[var(--error)]">-{file.deletions}</span>}
  </button>;
}

function DiffPreview({ repositoryPath, file, revision }: { repositoryPath?: string; file?: ProjectGitChange; revision: number }) {
  const [patch, setPatch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repositoryPath || !file || !isTauri()) {
      setPatch("");
      setError(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke<{ patch: string }>("git_project_diff", { root: repositoryPath, path: file.path }))
      .then((result) => { if (active) setPatch(result.patch); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load this diff."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [repositoryPath, file?.path, revision]);

  return <section className="min-w-0 flex-1 overflow-hidden bg-[var(--bg-canvas)]">
    {!file ? <ReviewMessage>Select a changed file to inspect its diff.</ReviewMessage> : <>
      <header className="flex h-9 items-center gap-2 border-b border-[var(--border-subtle)] px-3">
        <span className={cn("type-code text-[11px] font-semibold", file.status === "deleted" || file.status === "conflict" ? "text-[var(--error)]" : "text-[var(--success)]")}>{file.status === "modified" ? "M" : file.status === "added" ? "A" : file.status === "deleted" ? "D" : file.status === "renamed" ? "R" : file.status === "untracked" ? "U" : "!"}</span>
        <FileCode className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" strokeWidth={1.5} />
        <span className="truncate type-caption font-medium text-[var(--text-primary)]">{file.path.split("/").pop()}</span>
        <span className="truncate type-caption text-[var(--text-tertiary)]">{file.path.split("/").slice(0, -1).join("/")}</span>
        <span className="ml-auto shrink-0 type-code text-[11px]"><span className="text-[var(--success)]">+{file.additions}</span> <span className="text-[var(--error)]">-{file.deletions}</span></span>
      </header>
      <div className="h-[calc(100%-2.25rem)] overflow-auto">
        {loading ? <ReviewMessage>Loading diff…</ReviewMessage> : error ? <ReviewMessage>{error}</ReviewMessage> : patch ? <pre className="min-w-max py-2 type-code text-[12px] leading-5 text-[var(--text-secondary)]">{patch.split("\n").map((line, index) => <DiffLine key={`${index}-${line}`} line={line} />)}</pre> : <ReviewMessage>No textual diff is available for this file.</ReviewMessage>}
      </div>
    </>}
  </section>;
}

function DiffLine({ line }: { line: string }) {
  const kind = line.startsWith("+") && !line.startsWith("+++") ? "addition" : line.startsWith("-") && !line.startsWith("---") ? "deletion" : line.startsWith("@@") ? "hunk" : "normal";
  return <span className={cn("block min-h-5 px-3", kind === "addition" && "bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-[var(--success)]", kind === "deletion" && "bg-[color-mix(in_srgb,var(--error)_14%,transparent)] text-[var(--error)]", kind === "hunk" && "bg-[var(--bg-hover)] text-[var(--accent-primary)]")}>{line || " "}{"\n"}</span>;
}

export default AgentsSideDock;
