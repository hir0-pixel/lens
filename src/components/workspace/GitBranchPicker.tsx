import { useMemo, useState } from "react";
import { Check, GitBranch, GitGraph, Plus, Search } from "@/components/icons/tabler";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useGitStore } from "@/stores/gitStore";

interface GitBranchPickerProps {
  onClose: () => void;
}

export function GitBranchPicker({ onClose }: GitBranchPickerProps) {
  const branches = useGitStore((s) => s.branches);
  const changes = useGitStore((s) => s.changes);
  const checkoutBranch = useGitStore((s) => s.checkoutBranch);
  const createBranch = useGitStore((s) => s.createBranch);
  const setShowHistory = useGitStore((s) => s.setShowHistory);
  const [query, setQuery] = useState("");
  const fileCount = changes.length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, query]);

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <Search className="h-3.5 w-3.5 text-[var(--text-tertiary)]" strokeWidth={1.75} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search branches"
          className="h-6 w-full bg-transparent type-caption text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
          autoFocus
        />
      </div>
      <div className="px-3 pb-1 pt-2 type-caption font-medium text-[var(--text-tertiary)]">
        Branches
      </div>
      <ul className="max-h-56 overflow-y-auto pb-1">
        {filtered.map((b) => (
          <li key={b.name}>
            <button
              type="button"
              onClick={() => {
                void checkoutBranch(b.name);
                onClose();
              }}
              className={cn(
                "flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[var(--bg-hover)]",
                b.current && "bg-[var(--bg-active)]",
              )}
            >
              <GitBranch
                className="mt-0.5 h-3.5 w-3.5 text-[var(--text-tertiary)]"
                strokeWidth={1.6}
              />
              <span className="min-w-0 flex-1">
                <span className="block type-caption font-medium text-[var(--text-primary)]">
                  {b.name}
                </span>
                {b.current && (
                  <span className="type-caption text-[var(--text-tertiary)]">
                    Uncommitted changes: {fileCount} files
                  </span>
                )}
              </span>
              {b.current && (
                <Check
                  className="mt-0.5 h-3.5 w-3.5 text-[var(--text-secondary)]"
                  strokeWidth={2}
                />
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-[var(--border-subtle)] py-1">
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 px-3 type-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          onClick={() => {
            const name = window.prompt("New branch name");
            if (name?.trim()) {
              void createBranch(name.trim());
              onClose();
            }
          }}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          Create and switch to new branch…
        </button>
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 px-3 type-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          onClick={() => {
            setShowHistory(true);
            onClose();
            toast.message("Git Graph", {
              description: "History opens in the Review pane.",
            });
            window.dispatchEvent(
              new CustomEvent("lens:open-agents-tab", {
                detail: { kind: "review" },
              }),
            );
          }}
        >
          <GitGraph className="h-3.5 w-3.5" strokeWidth={1.6} />
          Git Graph
        </button>
      </div>
    </div>
  );
}
