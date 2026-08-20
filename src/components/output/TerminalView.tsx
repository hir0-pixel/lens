import { useEffect, useRef } from "react";
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
  const updateSession = useTerminalStore((s) => s.updateSession);
  const restartSession = useTerminalStore((s) => s.restartSession);
  const sessions = useTerminalStore((s) => s.sessions);
  const active = sessions.find((s) => s.id === activeSessionId);
  const appliedProjectCwd = useRef<string | null>(null);

  useEffect(() => {
    if (!cwd) return;

    setDefaultCwd(cwd);

    // Earlier releases persisted a mock finance-dashboard session. Migrate it
    // once to the active project folder instead of displaying a fake prompt.
    if (
      activeSessionId &&
      (active?.cwd === "~" || active?.cwd === "~/dev/finance-dashboard") &&
      appliedProjectCwd.current !== cwd
    ) {
      appliedProjectCwd.current = cwd;
      updateSession(activeSessionId, { cwd });
      restartSession(activeSessionId);
    }
  }, [active?.cwd, activeSessionId, cwd, restartSession, setDefaultCwd, updateSession]);

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
