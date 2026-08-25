import { memo } from "react";
import type { SplitPane } from "@/components/terminal/types";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { useTerminalStore } from "@/stores/terminalStore";
import { TerminalSession } from "./TerminalSession";

interface TerminalSplitViewProps {
  pane: SplitPane;
  projectName?: string;
}

function SplitNode({ pane, projectName }: TerminalSplitViewProps) {
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const setActiveSession = useTerminalStore((s) => s.setActiveSession);
  const setFocusedPane = useTerminalStore((s) => s.setFocusedPane);

  if (pane.type === "leaf" && pane.sessionId) {
    const isActive = pane.sessionId === activeSessionId;
    return (
      <TerminalSession
        sessionId={pane.sessionId}
        projectName={projectName}
        isActive={isActive}
        onFocus={() => {
          setFocusedPane(pane.id);
          setActiveSession(pane.sessionId!);
        }}
        className={cn(isActive && "ring-1 ring-inset ring-accent/20")}
      />
    );
  }

  if (pane.type === "split" && pane.first && pane.second) {
    const direction = pane.direction === "vertical" ? "vertical" : "horizontal";
    return (
      <ResizablePanelGroup direction={direction} className="h-full">
        <ResizablePanel defaultSize={pane.firstSize ?? 50} minSize={20}>
          <SplitNode pane={pane.first} projectName={projectName} />
        </ResizablePanel>
        <ResizableHandle className={cn(
          direction === "vertical" ? "h-px bg-white/10 hover:bg-accent/40" : "w-px bg-white/10 hover:bg-accent/40",
        )} />
        <ResizablePanel defaultSize={100 - (pane.firstSize ?? 50)} minSize={20}>
          <SplitNode pane={pane.second} projectName={projectName} />
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  }

  return null;
}

function TerminalSplitViewComponent({ projectName }: { projectName?: string }) {
  const splitRoot = useTerminalStore((s) => s.splitRoot);

  if (!splitRoot) {
    return (
      <div className="flex h-full items-center justify-center type-caption text-zinc-600">
        No terminal sessions — click + to create one
      </div>
    );
  }

  return (
    <div className="h-full min-h-0">
      <SplitNode pane={splitRoot} projectName={projectName} />
    </div>
  );
}

export const TerminalSplitView = memo(TerminalSplitViewComponent);
