import { TerminalSearch } from "./TerminalSearch";
import { TerminalSplitView } from "./TerminalSplitView";
import { TerminalStatus } from "./TerminalStatus";
import { TerminalTabs } from "./TerminalTabs";
import { TerminalToolbar } from "./TerminalToolbar";

interface TerminalPanelProps {
  projectName?: string;
  onOpenSettings?: () => void;
}

export function TerminalPanel({ projectName, onOpenSettings }: TerminalPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TerminalToolbar onOpenSettings={onOpenSettings} />
      <TerminalTabs />
      <TerminalSearch />
      <div className="min-h-0 flex-1">
        <TerminalSplitView projectName={projectName} />
      </div>
      <TerminalStatus />
    </div>
  );
}
