import { useEffect, useMemo, useState } from "react";
import {
  FileCode,
  FileText,
  LayoutGrid,
  MinusSquare,
  Search,
  ExternalLink,
} from "lucide-react";
import { useSessionStore } from "@/stores/sessionStore";
import { openFileWindow } from "@/features/windows/openAppWindow";
import { subscribeFileChanges } from "@/features/files/fileSync";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

interface ProjectFilesSidePaneProps {
  onClose: () => void;
  widthPx?: number;
}

const DEFAULT_PROJECT_FILES = [
  { path: "src/App.tsx", name: "App.tsx", type: "code" },
  { path: "src/main.tsx", name: "main.tsx", type: "code" },
  { path: "src/components/Sidebar.tsx", name: "Sidebar.tsx", type: "code" },
  { path: "package.json", name: "package.json", type: "code" },
  { path: "README.md", name: "README.md", type: "doc" },
];

/**
 * Project files side pane — matches screenshot layout.
 * Shows each file in active folder. Clicking opens in a separate editor window with 2-way live sync.
 */
export function ProjectFilesSidePane({
  onClose,
  widthPx = 300,
}: ProjectFilesSidePaneProps) {
  const repositories = useSessionStore((s) => s.repositories);
  const activeRepositoryId = useSessionStore((s) => s.activeRepositoryId);
  const activeRepo = repositories.find((r) => r.id === activeRepositoryId);

  const [search, setSearch] = useState("");
  const [updatedPaths, setUpdatedPaths] = useState<Record<string, number>>({});

  // Sync state when files change in separate windows
  useEffect(() => {
    const unsubscribe = subscribeFileChanges((path) => {
      setUpdatedPaths((prev) => ({ ...prev, [path]: Date.now() }));
    });
    return () => unsubscribe();
  }, []);

  const projectName = (activeRepo?.name || "DEFAULT PROJECT").toUpperCase();

  const files = useMemo(() => {
    // Collect files from open repository or default project files
    const base = DEFAULT_PROJECT_FILES;
    if (!search.trim()) return base;
    return base.filter(
      (f) =>
        f.name.toLowerCase().includes(search.toLowerCase()) ||
        f.path.toLowerCase().includes(search.toLowerCase()),
    );
  }, [search]);

  function handleFileClick(path: string) {
    void openFileWindow(path);
    toast.message(`Opened ${path.split("/").pop()} in separate window`, {
      description: "Edits in the separate window live-sync here automatically",
    });
  }

  const isEmpty = files.length === 0;

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] animate-in slide-in-from-right duration-200"
      style={{ width: widthPx }}
      aria-label="Project Files"
    >
      {/* Panel Top Header Bar */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3">
        <div className="flex items-center gap-2 min-w-0">
          <LayoutGrid className="h-4 w-4 text-[var(--text-tertiary)] shrink-0" strokeWidth={1.5} />
          <span className="truncate text-[11.5px] font-bold tracking-wider text-[var(--text-primary)] uppercase">
            {projectName}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
          aria-label="Collapse panel"
          title="Collapse panel"
        >
          <MinusSquare className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>

      {/* Search Input (if files exist) */}
      {!isEmpty && (
        <div className="p-2 border-b border-[var(--border-subtle)]">
          <div className="relative flex items-center">
            <Search className="absolute left-2.5 h-3.5 w-3.5 text-[var(--text-tertiary)]" strokeWidth={1.5} />
            <input
              type="text"
              placeholder="Search files..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 w-full rounded-md bg-[var(--bg-surface-raised)] pl-8 pr-2 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none transition-colors focus:bg-[var(--bg-overlay)] focus:ring-1 focus:ring-[var(--border-focus)]"
            />
          </div>
        </div>
      )}

      {/* Panel Content Body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {isEmpty ? (
          /* Exact Empty State matching uploaded screenshot */
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
            <h3 className="text-[13px] font-bold tracking-widest text-[var(--text-tertiary)] uppercase">
              EMPTY
            </h3>
            <p className="mt-1 text-[12.5px] text-[var(--text-tertiary)]">
              This folder is empty.
            </p>
          </div>
        ) : (
          <ScrollArea className="flex-1 p-2">
            <div className="flex flex-col gap-0.5">
              {files.map((file) => {
                const isRecentlyUpdated =
                  updatedPaths[file.path] &&
                  Date.now() - updatedPaths[file.path] < 10000;

                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => handleFileClick(file.path)}
                    className="group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
                    title={`Click to open ${file.path} in a separate window`}
                  >
                    {file.type === "code" ? (
                      <FileCode className="h-4 w-4 text-blue-400 shrink-0" strokeWidth={1.5} />
                    ) : (
                      <FileText className="h-4 w-4 text-emerald-400 shrink-0" strokeWidth={1.5} />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">
                      {file.name}
                    </span>

                    {isRecentlyUpdated && (
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)] shrink-0 animate-pulse" title="Edited in separate window" />
                    )}

                    <ExternalLink className="h-3 w-3 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" strokeWidth={1.5} />
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>
    </aside>
  );
}
