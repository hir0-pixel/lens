import {
  Columns2,
  Copy,
  Eraser,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Rows2,
  Search,
  Settings2,
  Skull,
  ClipboardPaste,
  SquareStack,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTerminalStore } from "@/stores/terminalStore";
import { getActiveTerminal } from "@/components/terminal/utils/terminalRegistry";
import type { ShellType } from "@/components/terminal/types";
import { SessionManager } from "./SessionManager";

const SHELLS: { id: ShellType; label: string }[] = [
  { id: "powershell", label: "PowerShell" },
  { id: "bash", label: "bash" },
  { id: "zsh", label: "zsh" },
  { id: "cmd", label: "Command Prompt" },
];

interface TerminalToolbarProps {
  onOpenSettings?: () => void;
}

export function TerminalToolbar({ onOpenSettings }: TerminalToolbarProps) {
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const createSession = useTerminalStore((s) => s.createSession);
  const splitSession = useTerminalStore((s) => s.splitSession);
  const setSearch = useTerminalStore((s) => s.setSearch);
  const killSession = useTerminalStore((s) => s.killSession);
  const restartSession = useTerminalStore((s) => s.restartSession);
  const closedSessions = useTerminalStore((s) => s.closedSessions);
  const reopenSession = useTerminalStore((s) => s.reopenSession);
  const duplicateSession = useTerminalStore((s) => s.duplicateSession);
  const setShell = useTerminalStore((s) => s.setShell);

  const activeSession = useTerminalStore((s) =>
    s.sessions.find((x) => x.id === s.activeSessionId),
  );

  function withActive(fn: (sessionId: string) => void) {
    if (activeSessionId) fn(activeSessionId);
  }

  function runTerminalAction(action: (handle: NonNullable<ReturnType<typeof getActiveTerminal>>) => void) {
    const handle = getActiveTerminal(activeSessionId);
    if (handle) action(handle);
  }

  return (
    <div
      className="flex h-[28px] shrink-0 items-center gap-0 border-b border-[var(--cursor-border)] bg-[var(--cursor-panel-bg)] px-1"
      role="toolbar"
      aria-label="Terminal toolbar"
    >
      <ToolbarButton
        label="New Terminal"
        shortcut="Ctrl+Shift+`"
        onClick={() => createSession()}
      >
        <Plus className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarButton
        label="Split Right"
        onClick={() => withActive((id) => splitSession(id, "horizontal"))}
      >
        <Columns2 className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarButton
        label="Split Down"
        onClick={() => withActive((id) => splitSession(id, "vertical"))}
      >
        <Rows2 className="h-3.5 w-3.5" />
      </ToolbarButton>

      <div className="mx-1 h-4 w-px bg-white/10" aria-hidden />

      <ToolbarButton
        label="Search"
        shortcut="Ctrl+F"
        onClick={() => setSearch({ open: true })}
      >
        <Search className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarButton label="Clear" onClick={() => runTerminalAction((h) => h.clear())}>
        <Eraser className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarButton
        label="Kill"
        onClick={() => withActive((id) => killSession(id))}
      >
        <Skull className="h-3.5 w-3.5" />
      </ToolbarButton>

      <ToolbarButton
        label="Restart"
        onClick={() => withActive((id) => restartSession(id))}
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </ToolbarButton>

      <div className="mx-1 h-4 w-px bg-white/10" aria-hidden />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px] font-normal text-zinc-400"
          >
            {activeSession?.shell ?? "bash"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          {SHELLS.map((shell) => (
            <DropdownMenuItem
              key={shell.id}
              onClick={() => withActive((id) => setShell(id, shell.id))}
            >
              {shell.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <SessionManager />

      <div className="ml-auto flex items-center gap-0.5">
        <ToolbarButton label="Copy" onClick={() => runTerminalAction((h) => h.copy())}>
          <Copy className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Paste" onClick={() => runTerminalAction((h) => void h.paste())}>
          <ClipboardPaste className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Select All" onClick={() => runTerminalAction((h) => h.selectAll())}>
          <SquareStack className="h-3.5 w-3.5" />
        </ToolbarButton>

        <ToolbarButton label="Settings" onClick={() => onOpenSettings?.()}>
          <Settings2 className="h-3.5 w-3.5" />
        </ToolbarButton>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Overflow menu">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => withActive((id) => duplicateSession(id))}>
              Duplicate session
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Recent sessions</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {closedSessions.length === 0 ? (
                  <DropdownMenuItem disabled>No closed sessions</DropdownMenuItem>
                ) : (
                  closedSessions.map((r) => (
                    <DropdownMenuItem
                      key={r.id}
                      onClick={() => reopenSession(r.id)}
                    >
                      {r.title}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled className="text-zinc-500">
              SSH sessions (coming soon)
            </DropdownMenuItem>
            <DropdownMenuItem disabled className="text-zinc-500">
              Docker terminals (coming soon)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  shortcut,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-zinc-500 hover:text-zinc-200"
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut ? ` (${shortcut})` : ""}
      </TooltipContent>
    </Tooltip>
  );
}
