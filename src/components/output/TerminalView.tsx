import { useEffect } from "react";
import { useTerminalStore } from "@/stores/terminalStore";
import { TerminalSession } from "@/components/terminal/TerminalSession";

interface TerminalViewProps {
  /** Working directory for new sessions (active repo path). */
  cwd?: string;
  projectName?: string;
}

/** Interactive xterm shell for Output tab / Agents side dock. */
export default function TerminalView({
  cwd,
  projectName,
}: TerminalViewProps) {
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const createSession = useTerminalStore((s) => s.createSession);
  const setDefaultCwd = useTerminalStore((s) => s.setDefaultCwd);
  const sessions = useTerminalStore((s) => s.sessions);
  const active = sessions.find((s) => s.id === activeSessionId);

  useEffect(() => {
    if (cwd) setDefaultCwd(cwd);
  }, [cwd, setDefaultCwd]);

  useEffect(() => {
    if (!activeSessionId) {
      createSession(cwd ? { cwd } : undefined);
    }
  }, [activeSessionId, createSession, cwd]);

  if (!activeSessionId || !active) {
    return null;
  }

  const name =
    projectName ??
    active.cwd.split(/[/\\]/).filter(Boolean).pop() ??
    "shell";

  return (
    <TerminalSession
      sessionId={activeSessionId}
      isActive
      projectName={name}
    />
  );
}
