import {
  Copy,
  MoreHorizontal,
  Pin,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "@/components/icons/tabler";
import { cn } from "@/lib/utils";
import { useTerminalStore } from "@/stores/terminalStore";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Cursor terminal session tabs — 28px toolbar strip under panel title.
 */
export function TerminalTabs() {
  const sessions = useTerminalStore((s) => s.sessions);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const setActiveSession = useTerminalStore((s) => s.setActiveSession);
  const createSession = useTerminalStore((s) => s.createSession);
  const closeSession = useTerminalStore((s) => s.closeSession);
  const duplicateSession = useTerminalStore((s) => s.duplicateSession);
  const renameSession = useTerminalStore((s) => s.renameSession);
  const pinSession = useTerminalStore((s) => s.pinSession);
  const killSession = useTerminalStore((s) => s.killSession);
  const restartSession = useTerminalStore((s) => s.restartSession);

  const sorted = [...sessions].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.lastActiveAt - a.lastActiveAt;
  });

  return (
    <div
      className="flex h-[28px] shrink-0 items-stretch gap-0 overflow-x-auto border-b border-[var(--cursor-border)] bg-[var(--cursor-panel-bg)]"
      role="tablist"
      aria-label="Terminal sessions"
    >
      {sorted.map((session) => {
        const active = session.id === activeSessionId;
        return (
          <ContextMenu key={session.id}>
            <ContextMenuTrigger asChild>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveSession(session.id)}
                className={cn(
                  "group relative flex h-full max-w-[160px] shrink-0 items-center gap-1.5 px-2 type-code transition-colors duration-[var(--cursor-dur-fast)]",
                  active
                    ? "bg-[var(--cursor-editor-bg)] text-[var(--cursor-fg)] after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:bg-[var(--cursor-focus)]"
                    : "text-[var(--cursor-fg-muted)] hover:bg-[var(--cursor-list-hover)] hover:text-[var(--cursor-fg)]",
                  session.status === "killed" && "opacity-60",
                )}
              >
                {session.pinned && (
                  <Pin
                    className="h-3 w-3 shrink-0 text-[var(--cursor-focus)]"
                    aria-hidden
                  />
                )}
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    session.status === "running"
                      ? "bg-[#0070f3]"
                      : "bg-[var(--cursor-fg-muted)]",
                  )}
                />
                <span className="truncate">{session.title}</span>
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeSession(session.id);
                  }}
                  className="ml-0.5 flex h-4 w-4 items-center justify-center opacity-0 hover:bg-[var(--cursor-list-hover)] group-hover:opacity-100"
                  aria-label="Kill Terminal"
                >
                  <X className="h-3 w-3" />
                </span>
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent className="rounded-none border-[var(--cursor-border)] bg-[var(--cursor-menu-bg,#171717)] type-caption">
              <ContextMenuItem
                onClick={() => {
                  const next = window.prompt("Rename terminal", session.title);
                  if (next?.trim()) renameSession(session.id, next.trim());
                }}
              >
                Rename…
              </ContextMenuItem>
              <ContextMenuItem onClick={() => pinSession(session.id)}>
                {session.pinned ? "Unpin" : "Pin"}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => duplicateSession(session.id)}>
                <Copy className="mr-2 h-3.5 w-3.5" /> Split Terminal
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => restartSession(session.id)}>
                <RotateCcw className="mr-2 h-3.5 w-3.5" /> Restart
              </ContextMenuItem>
              <ContextMenuItem onClick={() => killSession(session.id)}>
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Kill
              </ContextMenuItem>
              <ContextMenuItem onClick={() => closeSession(session.id)}>
                <X className="mr-2 h-3.5 w-3.5" /> Close
              </ContextMenuItem>
              <ContextMenuItem>
                <MoreHorizontal className="mr-2 h-3.5 w-3.5" /> Select Default Profile
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="New Terminal"
            onClick={() => createSession()}
            className="flex h-full w-7 items-center justify-center text-[var(--cursor-fg-muted)] transition-colors duration-[var(--cursor-dur-fast)] hover:bg-[var(--cursor-list-hover)] hover:text-[var(--cursor-fg)]"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </TooltipTrigger>
        <TooltipContent className="rounded-none type-caption">
          New Terminal
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
