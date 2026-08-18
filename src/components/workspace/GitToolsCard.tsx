import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  CloudUpload,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  Maximize2,
  MoreHorizontal,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useGitStore } from "@/stores/gitStore";
import { GitBranchPicker } from "./GitBranchPicker";

function openReview() {
  window.dispatchEvent(
    new CustomEvent("lens:open-agents-tab", {
      detail: { kind: "review" },
    }),
  );
}

export function GitToolsCard() {
  const changes = useGitStore((s) => s.changes);
  const branches = useGitStore((s) => s.branches);
  const current = branches.find((b) => b.current);
  const commit = useGitStore((s) => s.commit);
  const push = useGitStore((s) => s.push);
  const stageAll = useGitStore((s) => s.stageAll);
  const commitMessage = useGitStore((s) => s.commitMessage);
  const setCommitMessage = useGitStore((s) => s.setCommitMessage);
  const operation = useGitStore((s) => s.operation);

  const [expanded, setExpanded] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [includeUnstaged, setIncludeUnstaged] = useState(true);

  const additions = changes.reduce((n, c) => n + c.additions, 0);
  const deletions = changes.reduce((n, c) => n + c.deletions, 0);
  const fileCount = changes.length;
  const canPush = (current?.ahead ?? 0) > 0;

  function collapse() {
    setExpanded(false);
    setBranchOpen(false);
    setCommitOpen(false);
  }

  async function generateMessage() {
    const top = changes[0]?.path.split("/").pop() ?? "files";
    setCommitMessage(
      `Update ${top} and ${Math.max(0, fileCount - 1)} other file${fileCount === 1 ? "" : "s"}`,
    );
  }

  async function runCommit(andPush: boolean) {
    if (includeUnstaged) stageAll();
    if (!commitMessage.trim()) await generateMessage();
    const ok = await commit();
    if (ok && andPush) await push();
    if (ok) {
      setCommitOpen(false);
      collapse();
    }
  }

  useEffect(() => {
    if (!commitOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void runCommit(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commitOpen, commitMessage, includeUnstaged]);

  if (!expanded) {
    return (
      <button
        type="button"
        aria-expanded={false}
        aria-label="Expand changes"
        onClick={() => setExpanded(true)}
        className="inline-flex h-8 items-center gap-2 rounded-full border border-white/[0.1] bg-[#1c1c1c] px-3.5 text-[13.5px] text-[#c8c8c8] hover:bg-[#252525]"
      >
        <FileDiff className="h-4 w-4 text-[#9a9a9a]" strokeWidth={1.6} />
        <span>Changes</span>
        <span className="tabular-nums text-[#3fb950]">+{additions}</span>
        <span className="tabular-nums text-[#f85149]">-{deletions}</span>
        <ChevronDown className="h-3.5 w-3.5 text-[#6a6a6a]" strokeWidth={2} />
      </button>
    );
  }

  return (
    <div className="w-[280px] overflow-hidden rounded-xl border border-white/[0.08] bg-[#1a1a1a] shadow-[0_8px_28px_rgba(0,0,0,0.35)]">
      <div className="flex h-8 items-center px-3">
        <span className="text-[12px] text-[#8a8a8a]">Git tools</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded text-[#6a6a6a] hover:bg-white/[0.06] hover:text-[#c8c8c8]"
            aria-label="Git tools menu"
          >
            <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded text-[#6a6a6a] hover:bg-white/[0.06] hover:text-[#c8c8c8]"
            aria-label="Open review pane"
            onClick={() => {
              collapse();
              openReview();
            }}
          >
            <Maximize2 className="h-3 w-3" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="flex h-8 w-full items-center gap-1 px-3 text-[13px] text-[#e6e6e6]">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-white"
          onClick={() => {
            collapse();
            openReview();
          }}
        >
          <FileDiff className="h-3.5 w-3.5 text-[#9a9a9a]" strokeWidth={1.6} />
          <span>Changes</span>
          <span className="ml-auto tabular-nums text-[#3fb950]">+{additions}</span>
          <span className="tabular-nums text-[#f85149]">-{deletions}</span>
        </button>
        <button
          type="button"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[#6a6a6a] hover:bg-white/[0.06] hover:text-[#c8c8c8]"
          aria-label="Collapse changes"
          aria-expanded={true}
          onClick={collapse}
        >
          <ChevronUp className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      <Popover open={branchOpen} onOpenChange={setBranchOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-8 w-full items-center gap-2 px-3 text-left text-[13px] text-[#e6e6e6] hover:bg-white/[0.04]"
          >
            <GitBranch className="h-3.5 w-3.5 text-[#9a9a9a]" strokeWidth={1.6} />
            <span className="min-w-0 flex-1 truncate">
              {current?.name ?? "main"}
            </span>
            <ChevronDown className="h-3 w-3 text-[#6a6a6a]" strokeWidth={2} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          className="w-[280px] rounded-xl border-white/[0.1] bg-[#1c1c1c] p-0"
        >
          <GitBranchPicker onClose={() => setBranchOpen(false)} />
        </PopoverContent>
      </Popover>

      <Popover open={commitOpen} onOpenChange={setCommitOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-8 w-full items-center gap-2 rounded-b-xl px-3 text-left text-[13px] text-[#c8c8c8] hover:bg-white/[0.04]"
          >
            <GitCommitHorizontal
              className="h-3.5 w-3.5 text-[#9a9a9a]"
              strokeWidth={1.6}
            />
            Commit or push
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="bottom"
          className="w-[360px] rounded-xl border-white/[0.1] bg-[#1c1c1c] p-0"
        >
          <div className="flex items-center gap-2 px-3 py-2.5">
            <GitBranch className="h-3.5 w-3.5 text-[#9a9a9a]" strokeWidth={1.6} />
            <span className="text-[13px] text-[#e6e6e6]">
              {current?.name ?? "main"}
            </span>
            <ChevronDown className="h-3 w-3 text-[#6a6a6a]" />
            <span className="ml-auto tabular-nums text-[12.5px] text-[#3fb950]">
              +{additions.toLocaleString()}
            </span>
            <span className="tabular-nums text-[12.5px] text-[#f85149]">
              -{deletions.toLocaleString()}
            </span>
          </div>
          <div className="relative px-3">
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              rows={3}
              placeholder="Commit message (leave empty to generate)"
              className="w-full resize-none rounded-lg bg-[#141414] px-3 py-2.5 pr-8 text-[13px] text-[#e6e6e6] placeholder:text-[#6a6a6a] focus:outline-none"
            />
            <button
              type="button"
              className="absolute right-5 top-2.5 text-[#8a8a8a] hover:text-[#e8e8e8]"
              aria-label="Generate commit message"
              onClick={() => void generateMessage()}
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.6} />
            </button>
          </div>
          <label className="mt-2 flex items-center gap-2 px-3 py-2 text-[13px] text-[#c8c8c8]">
            <Checkbox
              checked={includeUnstaged}
              onCheckedChange={(v) => setIncludeUnstaged(v === true)}
              className="h-3.5 w-3.5 border-white/30"
            />
            Include unstaged changes
            <span className="ml-auto text-[12px] text-[#7a7a7a]">
              {fileCount} files
            </span>
          </label>
          <div className="border-t border-white/[0.08] py-1">
            <button
              type="button"
              disabled={operation === "committing"}
              onClick={() => void runCommit(false)}
              className="flex h-8 w-full items-center gap-2 bg-white/[0.05] px-3 text-[13px] text-[#e8e8e8] hover:bg-white/[0.08]"
            >
              <GitCommitHorizontal className="h-3.5 w-3.5" strokeWidth={1.6} />
              Commit
              <span className="ml-auto text-[11px] text-[#7a7a7a]">Ctrl+↵</span>
            </button>
            <button
              type="button"
              disabled={operation === "committing" || operation === "pushing"}
              onClick={() => void runCommit(true)}
              className="flex h-8 w-full items-center gap-2 px-3 text-[13px] text-[#d4d4d4] hover:bg-white/[0.04]"
            >
              <CloudUpload className="h-3.5 w-3.5" strokeWidth={1.6} />
              Commit and push
            </button>
            <button
              type="button"
              disabled={!canPush || operation === "pushing"}
              onClick={() => void push()}
              className={cn(
                "flex h-8 w-full items-center gap-2 px-3 text-[13px] hover:bg-white/[0.04]",
                canPush ? "text-[#d4d4d4]" : "text-[#6a6a6a]",
              )}
            >
              <CloudUpload className="h-3.5 w-3.5" strokeWidth={1.6} />
              Push
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
