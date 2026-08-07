import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/stores/sessionStore";

/**
 * Multitask tab strip — switch / close parallel sessions.
 */
export function SessionTabStrip() {
  const activeSessionIds = useSessionStore((s) => s.activeSessionIds);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);
  const closeSessionTab = useSessionStore((s) => s.closeSessionTab);

  if (activeSessionIds.length < 2) return null;

  return (
    <div
      className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2"
      role="tablist"
      aria-label="Active sessions"
    >
      {activeSessionIds.map((id) => {
        const sess = sessions[id];
        if (!sess) return null;
        const active = id === currentSessionId;
        return (
          <div
            key={id}
            role="tab"
            aria-selected={active}
            className={cn(
              "group flex h-7 max-w-[180px] items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[12px]",
              active
                ? "bg-[var(--bg-selected)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
            )}
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left"
              onClick={() => setCurrentSession(id, true)}
            >
              {sess.title}
            </button>
            <button
              type="button"
              className="opacity-0 group-hover:opacity-100"
              aria-label={`Close ${sess.title}`}
              onClick={(e) => {
                e.stopPropagation();
                closeSessionTab(id);
              }}
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default SessionTabStrip;
