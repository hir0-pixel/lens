import { useMemo, useState } from "react";
import { Check, GitBranch, GitGraph, Plus, Search } from "lucide-react";
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
      <div className="flex items-center gap-2 border-b border-white/[0.08] px-3 py-2">
        <Search className="h-3.5 w-3.5 text-[#6a6a6a]" strokeWidth={1.75} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search branches"
          className="h-6 w-full bg-transparent text-[13px] text-[#e6e6e6] placeholder:text-[#6a6a6a] focus:outline-none"
          autoFocus
        />
      </div>
      <div className="px-3 pb-1 pt-2 text-[11px] font-medium text-[#8a8a8a]">
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
                "flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-white/[0.05]",
                b.current && "bg-white/[0.06]",
              )}
            >
              <GitBranch
                className="mt-0.5 h-3.5 w-3.5 text-[#9a9a9a]"
                strokeWidth={1.6}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-[#e8e8e8]">
                  {b.name}
                </span>
                {b.current && (
                  <span className="text-[11px] text-[#7a7a7a]">
                    Uncommitted changes: {fileCount} files
                  </span>
                )}
              </span>
              {b.current && (
                <Check
                  className="mt-0.5 h-3.5 w-3.5 text-[#c8c8c8]"
                  strokeWidth={2}
                />
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-white/[0.08] py-1">
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 px-3 text-[13px] text-[#d4d4d4] hover:bg-white/[0.04]"
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
          className="flex h-8 w-full items-center gap-2 px-3 text-[13px] text-[#d4d4d4] hover:bg-white/[0.04]"
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
