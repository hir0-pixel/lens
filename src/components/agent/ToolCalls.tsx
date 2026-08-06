import { useState } from "react";
import {
  Check,
  ChevronRight,
  CircleDashed,
  FileCode2,
  Loader2,
  Terminal,
  X,
} from "lucide-react";
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
      <span className="text-zinc-500">{TOOL_ICONS[call.name] ?? <CircleDashed className="h-3.5 w-3.5" />}</span>
      <span className="font-mono text-[11px] text-zinc-400">{call.name}</span>
      <span className="truncate text-[11px] text-zinc-600">{call.detail}</span>
      <span className="ml-auto shrink-0">
        {call.status === "running" && (
          <Loader2 className="h-3 w-3 animate-spin text-accent" />
        )}
        {call.status === "done" && (
          <Check className="h-3 w-3 text-emerald-400" />
        )}
        {call.status === "error" && <X className="h-3 w-3 text-red-400" />}
      </span>
    </div>
  );
}

export function ToolCallsList({ calls }: { calls: ToolCallRecord[] }) {
  const [open, setOpen] = useState(true);
  const running = calls.some((c) => c.status === "running");
  const done = calls.filter((c) => c.status === "done").length;

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
        <span className="text-[12px] font-medium text-zinc-300">
          {running ? "Working…" : "Tool calls"}
        </span>
        <span className="ml-auto text-[11px] text-zinc-500">
          {done}/{calls.length}
        </span>
        {running && (
          <span className="h-2 w-2 animate-pulse-dot rounded-full bg-accent" />
        )}
      </button>
      {open && (
        <div className="border-t border-white/10 pb-1 pt-1">
          {calls.map((call) => (
            <ToolCallRecordRow key={call.id} call={call} />
          ))}
        </div>
      )}
    </div>
  );
}
