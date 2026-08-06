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
  md: "text-zinc-400",
};

export default function FileEdits({ edits }: { edits: FileEdit[] }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-surface-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-white/5"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-zinc-500 transition-transform",
            open && "rotate-90",
          )}
        />
        <GitCompareArrows className="h-3.5 w-3.5 text-accent" />
        <span className="text-[12px] font-medium text-zinc-300">
          Files changed
        </span>
        <span className="ml-auto text-[11px] text-zinc-500">
          {edits.length} files
        </span>
      </button>
      {open && (
        <div className="border-t border-white/10">
          {edits.map((edit) => (
            <button
              key={edit.path}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/5"
            >
              <span
                className={cn(
                  "font-mono text-[11px]",
                  LANG_COLORS[edit.language] ?? "text-zinc-400",
                )}
              >
                {edit.language}
              </span>
              <div className="min-w-0">
                <div className="truncate font-mono text-[12px] text-zinc-200">
                  {edit.path}
                </div>
                <div className="truncate text-[11px] text-zinc-500">
                  {edit.summary}
                </div>
              </div>
              <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[11px]">
                <span className="text-emerald-400">+{edit.additions}</span>
                <span className="text-red-400">−{edit.deletions}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
