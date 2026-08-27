import { History, Pin, RotateCcw } from "@/components/icons/tabler";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTerminalStore } from "@/stores/terminalStore";

export function SessionManager() {
  const sessions = useTerminalStore((s) => s.sessions);
  const closedSessions = useTerminalStore((s) => s.closedSessions);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const setActiveSession = useTerminalStore((s) => s.setActiveSession);
  const reopenSession = useTerminalStore((s) => s.reopenSession);
  const restartSession = useTerminalStore((s) => s.restartSession);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 type-caption font-normal text-zinc-500"
          aria-label="Session manager"
        >
          <History className="h-3 w-3" />
          {sessions.length}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0" side="bottom">
        <div className="border-b border-white/10 px-3 py-2 type-caption font-medium text-zinc-400">
          Active sessions
        </div>
        <ScrollArea className="max-h-48">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSession(s.id)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left type-caption hover:bg-white/5"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${s.status === "running" ? "bg-emerald-400" : "bg-zinc-600"}`}
              />
              <span className="min-w-0 flex-1 truncate text-zinc-300">{s.title}</span>
              {s.pinned && <Pin className="h-3 w-3 text-accent" />}
              {s.id === activeSessionId && (
                <span className="type-caption text-accent">active</span>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  restartSession(s.id);
                }}
                aria-label={`Restart ${s.title}`}
              >
                <RotateCcw className="h-3 w-3" />
              </Button>
            </button>
          ))}
        </ScrollArea>

        {closedSessions.length > 0 && (
          <>
            <div className="border-b border-t border-white/10 px-3 py-2 type-caption font-medium text-zinc-400">
              Session history
            </div>
            <ScrollArea className="max-h-32">
              {closedSessions.map((r) => (
                <button
                  key={r.id}
                  onClick={() => reopenSession(r.id)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left type-caption text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                >
                  <History className="h-3 w-3 shrink-0" />
                  <span className="truncate">{r.title}</span>
                  <span className="ml-auto shrink-0 type-caption text-zinc-600">{r.shell}</span>
                </button>
              ))}
            </ScrollArea>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
