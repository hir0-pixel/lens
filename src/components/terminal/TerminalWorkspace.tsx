import { useEffect } from "react";
import { TerminalPanel } from "./TerminalPanel";
import { useTerminalStore } from "@/stores/terminalStore";

interface TerminalWorkspaceProps {
  projectName?: string;
  projectPath?: string;
  onOpenSettings?: () => void;
}

export function TerminalWorkspace({
  projectName,
  projectPath,
  onOpenSettings,
}: TerminalWorkspaceProps) {
  const setDefaultCwd = useTerminalStore((s) => s.setDefaultCwd);
  const sessions = useTerminalStore((s) => s.sessions);
  const createSession = useTerminalStore((s) => s.createSession);

  useEffect(() => {
    if (projectPath) setDefaultCwd(projectPath);
  }, [projectPath, setDefaultCwd]);

  useEffect(() => {
    if (sessions.length === 0) createSession();
  }, [sessions.length, createSession]);

  return (
    <TerminalPanel projectName={projectName} onOpenSettings={onOpenSettings} />
  );
}

export default TerminalWorkspace;
