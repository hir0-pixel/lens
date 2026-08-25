import {
  ChevronUp,
  Maximize2,
  Minimize2,
  PanelBottomClose,
  X,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  type BottomPanelTab,
  useLayoutStore,
} from "@/stores/layoutStore";
import { TerminalWorkspace } from "@/components/terminal/TerminalWorkspace";
import { ProblemsPanel } from "@/components/terminal/ProblemsPanel";
import { OutputPanel } from "@/components/terminal/OutputPanel";
import { LogsPanel } from "@/components/terminal/LogsPanel";
import { DebugPanel } from "@/components/terminal/DebugPanel";
import { PortsPanel } from "@/components/terminal/PortsPanel";
import { useTerminalKeyboard } from "@/components/terminal/hooks/useTerminalKeyboard";
import { MOCK_PROBLEMS } from "@/components/terminal/mock-data";

const ERROR_COUNT = MOCK_PROBLEMS.filter((p) => p.severity === "error").length;
const WARN_COUNT = MOCK_PROBLEMS.filter((p) => p.severity === "warning").length;

const TABS: { id: BottomPanelTab; label: string; badge?: number }[] = [
  {
    id: "problems",
    label: "PROBLEMS",
    badge: ERROR_COUNT,
  },
  { id: "output", label: "OUTPUT" },
  { id: "debug", label: "DEBUG CONSOLE" },
  { id: "terminal", label: "TERMINAL" },
  { id: "ports", label: "PORTS" },
  { id: "logs", label: "LOGS" },
];

/**
 * Developer detail drawer — slim ~28px bar by default; expands on demand.
 */
export default function BottomPanel() {
  useTerminalKeyboard();

  const bottomPanelTab = useLayoutStore((s) => s.bottomPanelTab);
  const setBottomPanelTab = useLayoutStore((s) => s.setBottomPanelTab);
  const hideBottomPanel = useLayoutStore((s) => s.hideBottomPanel);
  const closeBottomPanel = useLayoutStore((s) => s.closeBottomPanel);
  const bottomPanelMaximized = useLayoutStore((s) => s.bottomPanelMaximized);
  const toggleBottomPanelMaximized = useLayoutStore(
    (s) => s.toggleBottomPanelMaximized,
  );
  const bottomPanelSlim = useLayoutStore((s) => s.bottomPanelSlim);
  const setBottomPanelSlim = useLayoutStore((s) => s.setBottomPanelSlim);

  function selectTab(tab: BottomPanelTab) {
    setBottomPanelTab(tab);
    if (bottomPanelSlim) setBottomPanelSlim(false);
  }

  return (
    <div
      className={cn(
        "cursor-panel flex h-full flex-col",
        bottomPanelSlim && "bg-[var(--bg-surface)]",
      )}
      data-terminal-workspace
      data-slim={bottomPanelSlim || undefined}
    >
      <Tabs
        value={bottomPanelTab}
        onValueChange={(v) => selectTab(v as BottomPanelTab)}
        className="flex h-full flex-col"
      >
        <div
          className={cn(
            "flex shrink-0 items-stretch border-b border-[var(--border-subtle)] pr-1",
            bottomPanelSlim
              ? "h-7 border-b-0 bg-[var(--bg-surface)]"
              : "cursor-panel-title",
          )}
        >
          <TabsList className="h-full gap-0 rounded-none bg-transparent p-0">
            {TABS.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className={cn(
                  "relative h-full rounded-none border-0 bg-transparent px-2 type-caption font-normal tracking-wide shadow-none",
                  "text-[var(--text-tertiary)] transition-colors duration-[var(--duration-instant)]",
                  "hover:text-[var(--text-secondary)]",
                  "data-[state=active]:bg-transparent data-[state=active]:text-[var(--text-secondary)] data-[state=active]:shadow-none",
                  !bottomPanelSlim &&
                    "px-2.5 type-caption data-[state=active]:text-[var(--text-primary)] data-[state=active]:after:absolute data-[state=active]:after:inset-x-2 data-[state=active]:after:bottom-0 data-[state=active]:after:h-0.5 data-[state=active]:after:bg-[var(--accent-primary)]",
                )}
              >
                {tab.label}
                {tab.badge != null && tab.badge > 0 && (
                  <span className="ml-1 rounded-full bg-[var(--error)] px-1 text-[9px] tabular-nums text-white">
                    {tab.badge}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {bottomPanelSlim && (ERROR_COUNT > 0 || WARN_COUNT > 0) && (
            <div className="ml-1 flex items-center gap-1.5 type-caption tabular-nums text-[var(--text-tertiary)]">
              {ERROR_COUNT > 0 && (
                <span className="text-[var(--error)]">{ERROR_COUNT}×</span>
              )}
              {WARN_COUNT > 0 && (
                <span className="text-[var(--warning)]">{WARN_COUNT}!</span>
              )}
            </div>
          )}

          <div className="ml-auto flex items-center">
            {bottomPanelSlim ? (
              <PanelIconBtn
                label="Expand panel"
                onClick={() => setBottomPanelSlim(false)}
              >
                <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.5} />
              </PanelIconBtn>
            ) : (
              <>
                <PanelIconBtn
                  label="Collapse to bar"
                  onClick={() => setBottomPanelSlim(true)}
                >
                  <PanelBottomClose className="h-4 w-4" strokeWidth={1.5} />
                </PanelIconBtn>
                <PanelIconBtn
                  label={
                    bottomPanelMaximized
                      ? "Restore Panel Size"
                      : "Maximize Panel Size"
                  }
                  onClick={toggleBottomPanelMaximized}
                >
                  {bottomPanelMaximized ? (
                    <Minimize2 className="h-4 w-4" strokeWidth={1.5} />
                  ) : (
                    <Maximize2 className="h-4 w-4" strokeWidth={1.5} />
                  )}
                </PanelIconBtn>
                <PanelIconBtn label="Close Panel" onClick={closeBottomPanel}>
                  <X className="h-4 w-4" strokeWidth={1.5} />
                </PanelIconBtn>
                <PanelIconBtn label="Hide Panel" onClick={hideBottomPanel}>
                  <PanelBottomClose className="h-4 w-4" strokeWidth={1.5} />
                </PanelIconBtn>
              </>
            )}
          </div>
        </div>

        {!bottomPanelSlim && (
          <>
            <TabsContent
              value="terminal"
              className="m-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
            >
              <TerminalWorkspace />
            </TabsContent>
            <TabsContent
              value="problems"
              className="m-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
            >
              <ProblemsPanel />
            </TabsContent>
            <TabsContent
              value="output"
              className="m-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
            >
              <OutputPanel />
            </TabsContent>
            <TabsContent
              value="logs"
              className="m-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
            >
              <LogsPanel />
            </TabsContent>
            <TabsContent
              value="debug"
              className="m-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
            >
              <DebugPanel />
            </TabsContent>
            <TabsContent
              value="ports"
              className="m-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
            >
              <PortsPanel />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}

function PanelIconBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className="flex h-[28px] w-[28px] items-center justify-center text-[var(--text-tertiary)] transition-colors duration-[var(--duration-instant)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent className="rounded-[var(--radius-sm)] border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] type-caption">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
