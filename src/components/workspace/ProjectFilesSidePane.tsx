import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  LayoutGrid,
  Loader2,
  RefreshCw,
  Search,
} from "@/components/icons/tabler";
import { useSessionStore } from "@/stores/sessionStore";
import { openFileWindow } from "@/features/windows/openAppWindow";
import { isTauri } from "@/features/projects/platform";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

interface ProjectFilesSidePaneProps {
  widthPx?: number;
  closing?: boolean;
  onExited?: () => void;
}

interface ProjectTreeEntry {
  name: string;
  path: string;
  isDir: boolean;
  children: ProjectTreeEntry[];
}

function isCodeFile(name: string): boolean {
  return /\.(?:[cm]?[jt]sx?|json|css|html?|rs|py|go|java|php|rb|sh|sql|ya?ml)$/i.test(name);
}

function treeMatches(entry: ProjectTreeEntry, query: string): boolean {
  if (!query) return true;
  if (entry.name.toLowerCase().includes(query)) return true;
  return entry.children.some((child) => treeMatches(child, query));
}

function TreeRow({
  entry,
  depth,
  query,
  expandedPaths,
  onToggle,
  onOpenFile,
}: {
  entry: ProjectTreeEntry;
  depth: number;
  query: string;
  expandedPaths: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const isExpanded = expandedPaths.has(entry.path) || Boolean(query);
  const hasChildren = entry.isDir && entry.children.length > 0;

  if (!treeMatches(entry, query)) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => (entry.isDir ? onToggle(entry.path) : onOpenFile(entry.path))}
        className="group flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)] hover:bg-[var(--bg-hover)]"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        title={entry.isDir ? entry.path : `Open ${entry.path}`}
      >
        {entry.isDir ? (
          hasChildren ? (
            isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" strokeWidth={1.5} />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" strokeWidth={1.5} />
            )
          ) : (
            <span className="h-3.5 w-3.5 shrink-0" />
          )
        ) : (
          <span className="h-3.5 w-3.5 shrink-0" />
        )}

        {entry.isDir ? (
          isExpanded ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" strokeWidth={1.5} />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" strokeWidth={1.5} />
          )
        ) : isCodeFile(entry.name) ? (
          <FileCode className="h-4 w-4 shrink-0 text-blue-400" strokeWidth={1.5} />
        ) : (
          <FileText className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" strokeWidth={1.5} />
        )}

        <span className="min-w-0 flex-1 truncate type-caption text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">
          {entry.name}
        </span>
      </button>

      {entry.isDir && isExpanded && entry.children.map((child) => (
        <TreeRow
          key={child.path}
          entry={child}
          depth={depth + 1}
          query={query}
          expandedPaths={expandedPaths}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  );
}

/**
 * Project files side pane backed by the active repository's native filesystem.
 * The selected project folder is always rendered as the visible tree root.
 */
export function ProjectFilesSidePane({
  widthPx = 420,
  closing = false,
  onExited,
}: ProjectFilesSidePaneProps) {
  const repositories = useSessionStore((state) => state.repositories);
  const activeRepositoryId = useSessionStore((state) => state.activeRepositoryId);
  const activeRepo = repositories.find((repo) => repo.id === activeRepositoryId);
  const [search, setSearch] = useState("");
  const [tree, setTree] = useState<ProjectTreeEntry | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const loadTree = useCallback(async () => {
    if (!activeRepo?.path) {
      setTree(null);
      setError("Choose a project to browse its files.");
      return;
    }

    if (!isTauri()) {
      setTree(null);
      setError("Project files are available in the Lens desktop app.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const nextTree = await invoke<ProjectTreeEntry>("project_file_tree", {
        root: activeRepo.path,
      });
      setTree(nextTree);
      setExpandedPaths(new Set([nextTree.path]));
    } catch (cause) {
      setTree(null);
      setError(cause instanceof Error ? cause.message : "Unable to read project files.");
    } finally {
      setLoading(false);
    }
  }, [activeRepo?.path]);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  const query = search.trim().toLowerCase();
  const hasVisibleFiles = useMemo(() => Boolean(tree && treeMatches(tree, query)), [tree, query]);

  function toggleDirectory(path: string) {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function openFile(path: string) {
    void openFileWindow(path);
    toast.message(`Opened ${path.split(/[\\/]/).pop()} in separate window`);
  }

  const projectName = activeRepo?.name ?? "PROJECT FILES";

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col overflow-hidden border-l border-[var(--border-default)] bg-[var(--bg-surface)] transition-[width,opacity] duration-[var(--duration-base)] ease-[var(--ease-standard)]"
      style={{ width: entered && !closing ? widthPx : 0, opacity: entered && !closing ? 1 : 0 }}
      onTransitionEnd={(event) => {
        if (closing && event.propertyName === "width") onExited?.();
      }}
      aria-label="Project Files"
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] pl-3 pr-1">
        <div className="flex min-w-0 items-center gap-2">
          <LayoutGrid className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" strokeWidth={1.5} />
          <span className="truncate type-caption-uppercase font-medium text-[var(--text-primary)]">
            {projectName}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void loadTree()}
          disabled={loading}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50"
          title="Refresh project files"
          aria-label="Refresh project files"
        >
          <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} strokeWidth={1.5} />
        </button>
      </div>

      <div className="border-b border-[var(--border-subtle)] p-2">
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 h-3.5 w-3.5 text-[var(--text-tertiary)]" strokeWidth={1.5} />
          <input
            type="text"
            placeholder="Search files..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-7 w-full rounded-md bg-[var(--bg-surface-raised)] pl-8 pr-2 type-caption text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)] focus:bg-[var(--bg-overlay)] focus:outline focus:outline-1 focus:outline-[var(--border-focus)]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 type-caption text-[var(--text-tertiary)]">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
            Reading project files…
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center px-6 text-center type-caption text-[var(--text-tertiary)]">
            {error}
          </div>
        ) : tree && hasVisibleFiles ? (
          <ScrollArea className="h-full p-2">
            <TreeRow
              entry={tree}
              depth={0}
              query={query}
              expandedPaths={expandedPaths}
              onToggle={toggleDirectory}
              onOpenFile={openFile}
            />
          </ScrollArea>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center type-caption text-[var(--text-tertiary)]">
            No matching files.
          </div>
        )}
      </div>
    </aside>
  );
}
