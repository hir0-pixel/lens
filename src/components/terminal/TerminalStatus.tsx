import { FolderOpen, Terminal } from "lucide-react";
import { useTerminalStore } from "@/stores/terminalStore";

export function TerminalStatus() {
  const session = useTerminalStore((s) =>
    s.sessions.find((x) => x.id === s.activeSessionId),
  );

  if (!session) return null;

  return (
    <div
      className="flex h-6 shrink-0 items-center gap-3 border-t border-white/5 bg-surface-1 px-2.5 type-caption text-zinc-500"
      aria-live="polite"
    >
      <span className="flex items-center gap-1">
        <Terminal className="h-3 w-3 text-emerald-400" aria-hidden />
        <span className="text-zinc-400">{session.shell}</span>
      </span>
      <span className="flex min-w-0 items-center gap-1">
        <FolderOpen className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate font-mono">{session.cwd}</span>
      </span>
      <span className="ml-auto tabular-nums">
        {session.history.length} cmds · {session.connectionKind}
      </span>
    </div>
  );
}
