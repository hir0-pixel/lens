import { useState } from "react";
import { ChevronRight, GitCompareArrows } from "lucide-react";
import { cn } from "../../lib/utils";
import type { FileEdit } from "../../lib/types";

const LANG_COLORS: Record<string, string> = {
  tsx: "text-sky-400",
  ts: "text-sky-400",
  css: "text-pink-400",
  py: "text-yellow-300",
  js: "text-amber-300",
  json: "text-lime-400",
  md: "text-[var(--text-tertiary)]",
};

export default function FileEdits({ edits }: { edits: FileEdit[] }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-surface-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-[var(--text-tertiary)] transition-transform",
            open && "rotate-90",
          )}
        />
        <GitCompareArrows className="h-3.5 w-3.5 text-accent" />
        <span className="text-[12px] font-medium text-[var(--text-secondary)]">
          Files changed
        </span>
        <span className="ml-auto text-[11px] text-[var(--text-tertiary)]">
          {edits.length} files
        </span>
      </button>
      {open && (
        <div className="border-t border-[var(--border-subtle)]">
          {edits.map((edit) => (
            <button
              key={edit.path}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
            >
              <span
                className={cn(
                  "font-mono text-[11px]",
                  LANG_COLORS[edit.language] ?? "text-[var(--text-tertiary)]",
                )}
              >
                {edit.language}
              </span>
              <div className="min-w-0">
                <div className="truncate font-mono text-[12px] text-[var(--text-primary)]">
                  {edit.path}
                </div>
                <div className="truncate text-[11px] text-[var(--text-tertiary)]">
                  {edit.summary}
                </div>
              </div>
              <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[11px]">
                <span className="text-[var(--success)]">+{edit.additions}</span>
                <span className="text-[var(--error)]">−{edit.deletions}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
