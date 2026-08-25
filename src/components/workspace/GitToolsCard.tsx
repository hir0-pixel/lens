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
        className="inline-flex h-8 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] px-3.5 type-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
      >
        <FileDiff className="h-4 w-4 text-[var(--text-tertiary)]" strokeWidth={1.6} />
        <span>Changes</span>
        <span className="tabular-nums text-[var(--success)]">+{additions}</span>
        <span className="tabular-nums text-[var(--error)]">-{deletions}</span>
        <ChevronDown className="h-3.5 w-3.5 text-[var(--text-tertiary)]" strokeWidth={2} />
      </button>
    );
  }

  return (
    <div className="w-[280px] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-float-pop">
      <div className="flex h-8 items-center px-3">
        <span className="type-caption text-[var(--text-tertiary)]">Git tools</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="Git tools menu"
          >
            <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
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

      <div className="flex h-8 w-full items-center gap-1 px-3 type-caption text-[var(--text-primary)]">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-[var(--text-primary)]"
          onClick={() => {
            collapse();
            openReview();
          }}
        >
          <FileDiff className="h-3.5 w-3.5 text-[var(--text-tertiary)]" strokeWidth={1.6} />
          <span>Changes</span>
          <span className="ml-auto tabular-nums text-[var(--success)]">+{additions}</span>
          <span className="tabular-nums text-[var(--error)]">-{deletions}</span>
        </button>
        <button
          type="button"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
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
            className="flex h-8 w-full items-center gap-2 px-3 text-left type-caption text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <GitBranch className="h-3.5 w-3.5 text-[var(--text-tertiary)]" strokeWidth={1.6} />
            <span className="min-w-0 flex-1 truncate">
              {current?.name ?? "main"}
            </span>
            <ChevronDown className="h-3 w-3 text-[var(--text-tertiary)]" strokeWidth={2} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          className="w-[280px] rounded-xl border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-0"
        >
          <GitBranchPicker onClose={() => setBranchOpen(false)} />
        </PopoverContent>
      </Popover>

      <Popover open={commitOpen} onOpenChange={setCommitOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-8 w-full items-center gap-2 rounded-b-xl px-3 text-left type-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <GitCommitHorizontal
              className="h-3.5 w-3.5 text-[var(--text-tertiary)]"
              strokeWidth={1.6}
            />
            Commit or push
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="bottom"
          className="w-[360px] rounded-xl border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-0"
        >
          <div className="flex items-center gap-2 px-3 py-2.5">
            <GitBranch className="h-3.5 w-3.5 text-[var(--text-tertiary)]" strokeWidth={1.6} />
            <span className="type-caption text-[var(--text-primary)]">
              {current?.name ?? "main"}
            </span>
            <ChevronDown className="h-3 w-3 text-[var(--text-tertiary)]" />
            <span className="ml-auto tabular-nums type-caption text-[var(--success)]">
              +{additions.toLocaleString()}
            </span>
            <span className="tabular-nums type-caption text-[var(--error)]">
              -{deletions.toLocaleString()}
            </span>
          </div>
          <div className="relative px-3">
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              rows={3}
              placeholder="Commit message (leave empty to generate)"
              className="w-full resize-none rounded-lg bg-[var(--bg-surface-raised)] px-3 py-2.5 pr-8 type-caption text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
            />
            <button
              type="button"
              className="absolute right-5 top-2.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              aria-label="Generate commit message"
              onClick={() => void generateMessage()}
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.6} />
            </button>
          </div>
          <label className="mt-2 flex items-center gap-2 px-3 py-2 type-caption text-[var(--text-secondary)]">
            <Checkbox
              checked={includeUnstaged}
              onCheckedChange={(v) => setIncludeUnstaged(v === true)}
              className="h-3.5 w-3.5 border-white/30"
            />
            Include unstaged changes
            <span className="ml-auto type-caption text-[#888888]">
              {fileCount} files
            </span>
          </label>
          <div className="border-t border-white/[0.08] py-1">
            <button
              type="button"
              disabled={operation === "committing"}
              onClick={() => void runCommit(false)}
              className="flex h-8 w-full items-center gap-2 bg-[var(--bg-surface-raised)] px-3 type-caption text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              <GitCommitHorizontal className="h-3.5 w-3.5" strokeWidth={1.6} />
              Commit
              <span className="ml-auto type-caption text-[#888888]">Ctrl+↵</span>
            </button>
            <button
              type="button"
              disabled={operation === "committing" || operation === "pushing"}
              onClick={() => void runCommit(true)}
              className="flex h-8 w-full items-center gap-2 px-3 type-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              <CloudUpload className="h-3.5 w-3.5" strokeWidth={1.6} />
              Commit and push
            </button>
            <button
              type="button"
              disabled={!canPush || operation === "pushing"}
              onClick={() => void push()}
              className={cn(
                "flex h-8 w-full items-center gap-2 px-3 type-caption hover:bg-[var(--bg-hover)]",
                canPush ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]",
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
