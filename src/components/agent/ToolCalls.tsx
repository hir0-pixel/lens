import { useState } from "react";
import {
  Check,
  ChevronRight,
  CircleDashed,
  FileCode2,
  Loader2,
  Terminal,
  X,
} from "@/components/icons/tabler";
import { cn } from "../../lib/utils";
import type { ToolCallRecord } from "../../lib/types";

const TOOL_ICONS: Record<string, React.ReactNode> = {
  create_project: <FileCode2 className="h-3.5 w-3.5" />,
  write_file: <FileCode2 className="h-3.5 w-3.5" />,
  edit_file: <FileCode2 className="h-3.5 w-3.5" />,
  run_command: <Terminal className="h-3.5 w-3.5" />,
};

export function ToolCallRecordRow({ call }: { call: ToolCallRecord }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <span className="text-[var(--text-tertiary)]">{TOOL_ICONS[call.name] ?? <CircleDashed className="h-3.5 w-3.5" />}</span>
      <span className="type-code text-[var(--text-secondary)]">{call.name}</span>
      <span className="truncate type-caption text-[var(--text-disabled)]">{call.detail}</span>
      <span className="ml-auto shrink-0">
        {call.status === "running" && (
          <Loader2 className="h-3 w-3 animate-spin text-accent" />
        )}
        {call.status === "done" && (
          <Check className="h-3 w-3 text-[var(--success)]" />
        )}
        {call.status === "error" && <X className="h-3 w-3 text-[var(--error)]" />}
      </span>
    </div>
  );
}

export function ToolCallsList({ calls }: { calls: ToolCallRecord[] }) {
  const [open, setOpen] = useState(true);
  const running = calls.some((c) => c.status === "running");
  const done = calls.filter((c) => c.status === "done").length;

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-surface-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)] hover:bg-[var(--bg-hover)]"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-[var(--text-tertiary)] transition-transform duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
            open && "rotate-90",
          )}
        />
        <span className="type-caption font-medium text-[var(--text-secondary)]">
          {running ? "Working…" : "Tool calls"}
        </span>
        <span className="ml-auto type-caption text-[var(--text-tertiary)]">
          {done}/{calls.length}
        </span>
        {running && (
          <span className="h-2 w-2 animate-pulse-dot rounded-full bg-accent" />
        )}
      </button>
      {open && (
        <div className="border-t border-[var(--border-subtle)] pb-1 pt-1">
          {calls.map((call) => (
            <ToolCallRecordRow key={call.id} call={call} />
          ))}
        </div>
      )}
    </div>
  );
}
