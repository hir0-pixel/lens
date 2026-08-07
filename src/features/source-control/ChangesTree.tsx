import { memo } from "react";
import {
  Check,
  Diff,
  FileCode2,
  FileJson,
  FileMinus,
  FilePlus,
  FileText,
  FileWarning,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useGitStore } from "@/stores/gitStore";
import type { GitChange, GitFileStatus } from "./types";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

const STATUS_LABEL: Record<GitFileStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  ignored: "I",
  conflict: "C",
};

const STATUS_COLOR: Record<GitFileStatus, string> = {
  modified: "text-amber-400",
  added: "text-emerald-400",
  deleted: "text-red-400",
  renamed: "text-sky-400",
  untracked: "text-zinc-400",
  ignored: "text-zinc-600",
  conflict: "text-red-400",
};

function FileIcon({ change }: { change: GitChange }) {
  if (change.status === "conflict") return <FileWarning className="h-3.5 w-3.5 text-red-400" />;
  if (change.status === "added" || change.status === "untracked")
    return <FilePlus className="h-3.5 w-3.5 text-emerald-400" />;
  if (change.status === "deleted") return <FileMinus className="h-3.5 w-3.5 text-red-400" />;
  if (change.path.endsWith(".json")) return <FileJson className="h-3.5 w-3.5 text-lime-400" />;
  if (change.path.endsWith(".md") || change.path.endsWith(".css"))
    return <FileText className="h-3.5 w-3.5 text-zinc-400" />;
  return <FileCode2 className="h-3.5 w-3.5 text-sky-400" />;
}

function ChangeRow({
  change,
  onStage,
  onUnstage,
  onDiscard,
  onOpenDiff,
}: {
  change: GitChange;
  onStage?: () => void;
  onUnstage?: () => void;
  onDiscard?: () => void;
  onOpenDiff: () => void;
}) {
  const name = change.path.split("/").pop() ?? change.path;
  const dir = change.path.includes("/")
    ? change.path.slice(0, change.path.lastIndexOf("/"))
    : "";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="group flex h-7 items-center gap-1.5 px-2 text-[12px] hover:bg-white/[0.04]"
          role="treeitem"
        >
          <button
            type="button"
            onClick={onOpenDiff}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            <FileIcon change={change} />
            <span className="truncate text-zinc-200">{name}</span>
            {dir && (
              <span className="truncate font-mono text-[10px] text-zinc-600">{dir}</span>
            )}
          </button>
          <span
            className={cn(
              "font-mono text-[10px] font-semibold",
              STATUS_COLOR[change.status],
            )}
          >
            {STATUS_LABEL[change.status]}
          </span>
          <div className="flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {onStage && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={onStage}
                aria-label={`Stage ${name}`}
                title="Stage"
              >
                <Plus className="h-3 w-3" />
              </Button>
            )}
            {onUnstage && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={onUnstage}
                aria-label={`Unstage ${name}`}
                title="Unstage"
              >
                <Minus className="h-3 w-3" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={onOpenDiff}
              aria-label={`Open diff ${name}`}
            >
              <Diff className="h-3 w-3" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-5 w-5" aria-label="More">
                  <MoreHorizontal className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={onOpenDiff}>Open Changes</DropdownMenuItem>
                {onStage && <DropdownMenuItem onClick={onStage}>Stage Changes</DropdownMenuItem>}
                {onUnstage && (
                  <DropdownMenuItem onClick={onUnstage}>Unstage Changes</DropdownMenuItem>
                )}
                {onDiscard && (
                  <DropdownMenuItem onClick={onDiscard} className="text-red-400">
                    Discard Changes
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={onOpenDiff}>
          <Diff className="mr-2 h-3.5 w-3.5" />
          Open Changes
        </ContextMenuItem>
        {onStage && (
          <ContextMenuItem onClick={onStage}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            Stage Changes
          </ContextMenuItem>
        )}
        {onUnstage && (
          <ContextMenuItem onClick={onUnstage}>
            <Minus className="mr-2 h-3.5 w-3.5" />
            Unstage Changes
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        {onDiscard && (
          <ContextMenuItem onClick={onDiscard} className="text-red-400 focus:text-red-400">
            <RotateCcw className="mr-2 h-3.5 w-3.5" />
            Discard Changes
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function ChangeSection({
  title,
  count,
  actions,
  children,
  defaultOpen = true,
}: {
  title: string;
  count: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-1">
      <div className="flex h-7 items-center gap-1 px-1">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500 hover:bg-white/5 hover:text-zinc-300">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          <span className="truncate">{title}</span>
          <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px] font-normal">
            {count}
          </Badge>
        </CollapsibleTrigger>
        {actions}
      </div>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

function ChangesTreeComponent() {
  const stage = useGitStore((s) => s.stage);
  const unstage = useGitStore((s) => s.unstage);
  const stageAll = useGitStore((s) => s.stageAll);
  const unstageAll = useGitStore((s) => s.unstageAll);
  const discard = useGitStore((s) => s.discard);
  const selectDiff = useGitStore((s) => s.selectDiff);
  const setShowConflicts = useGitStore((s) => s.setShowConflicts);
  const staged = useGitStore((s) => s.getStaged());
  const unstaged = useGitStore((s) => s.getUnstaged());
  const conflicts = useGitStore((s) => s.getConflicts());
  const untracked = useGitStore((s) => s.getUntracked());

  return (
    <div className="py-1" role="tree" aria-label="Changes">
      <ChangeSection
        title="Merge Changes"
        count={conflicts.length}
        actions={
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[10px] text-red-400"
            onClick={() => setShowConflicts(true)}
          >
            Resolve
          </Button>
        }
      >
        {conflicts.map((c) => (
          <ChangeRow
            key={c.id}
            change={c}
            onOpenDiff={() => {
              setShowConflicts(true);
              selectDiff(c.path);
            }}
          />
        ))}
      </ChangeSection>

      <ChangeSection
        title="Staged Changes"
        count={staged.length}
        actions={
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={unstageAll}
            aria-label="Unstage all"
            title="Unstage All Changes"
          >
            <Minus className="h-3 w-3" />
          </Button>
        }
      >
        {staged.map((c) => (
          <ChangeRow
            key={c.id}
            change={c}
            onUnstage={() => unstage(c.id)}
            onOpenDiff={() => selectDiff(c.path)}
          />
        ))}
      </ChangeSection>

      <ChangeSection
        title="Changes"
        count={unstaged.length}
        actions={
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={stageAll}
            aria-label="Stage all"
            title="Stage All Changes"
          >
            <Plus className="h-3 w-3" />
          </Button>
        }
      >
        {unstaged.map((c) => (
          <ChangeRow
            key={c.id}
            change={c}
            onStage={() => stage(c.id)}
            onDiscard={() => discard(c.id)}
            onOpenDiff={() => selectDiff(c.path)}
          />
        ))}
      </ChangeSection>

      <ChangeSection title="Untracked" count={untracked.length}>
        {untracked.map((c) => (
          <ChangeRow
            key={c.id}
            change={c}
            onStage={() => stage(c.id)}
            onDiscard={() => discard(c.id)}
            onOpenDiff={() => selectDiff(c.path)}
          />
        ))}
      </ChangeSection>

      {staged.length === 0 &&
        unstaged.length === 0 &&
        conflicts.length === 0 &&
        untracked.length === 0 && (
          <div className="flex flex-col items-center px-4 py-8 text-center">
            <Check className="mb-2 h-6 w-6 text-emerald-500/60" />
            <p className="text-[12px] text-zinc-400">No changes</p>
            <p className="mt-1 text-[11px] text-zinc-600">
              Your working tree is clean
            </p>
          </div>
        )}
    </div>
  );
}

export const ChangesTree = memo(ChangesTreeComponent);
