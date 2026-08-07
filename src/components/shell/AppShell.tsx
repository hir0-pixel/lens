import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceNavRail } from "@/components/workspace/WorkspaceNavRail";
import { WorkspaceNavigator } from "@/components/workspace/WorkspaceNavigator";
import { ToolsWorkspace } from "@/components/workspace/ToolsWorkspace";
import BottomPanel from "@/components/shell/BottomPanel";
import StatusBar from "@/components/shell/StatusBar";
import { PanelSash } from "@/components/shell/PanelSash";
import { useLayoutStore } from "@/stores/layoutStore";
import type { Model, Project } from "@/lib/types";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { cn } from "@/lib/utils";

interface AppShellProps {
  agentWorkspace: ReactNode;
  project: Project;
  projects?: Project[];
  model: Model;
  credits: number;
  onOpenSettings?: () => void;
  onProjectChange?: (project: Project) => void;
  onNewAgent?: () => void;
}

const NAV_RAIL_W = 48;

/**
 * Minimal agent-first shell. Nav / tools / utility open on demand only.
 */
export default function AppShell({
  agentWorkspace,
  project,
  projects,
  model,
  credits,
  onOpenSettings,
  onProjectChange,
  onNewAgent,
}: AppShellProps) {
  useKeyboardShortcuts();

  const navOpen = useLayoutStore((s) => s.navOpen);
  const toolsOpen = useLayoutStore((s) => s.toolsOpen);
  const bottomPanelOpen = useLayoutStore((s) => s.bottomPanelOpen);
  const bottomPanelSlim = useLayoutStore((s) => s.bottomPanelSlim);
  const navWidthPx = useLayoutStore((s) => s.navWidthPx);
  const toolsWidthPx = useLayoutStore((s) => s.toolsWidthPx);
  const bottomPanelHeightPx = useLayoutStore((s) => s.bottomPanelHeightPx);
  const setNavWidthPx = useLayoutStore((s) => s.setNavWidthPx);
  const setToolsWidthPx = useLayoutStore((s) => s.setToolsWidthPx);
  const setBottomPanelHeightPx = useLayoutStore((s) => s.setBottomPanelHeightPx);
  const toggleTools = useLayoutStore((s) => s.toggleTools);
  const closeTools = useLayoutStore((s) => s.closeTools);
  const closeNav = useLayoutStore((s) => s.closeNav);
  const openExplorer = useLayoutStore((s) => s.openExplorer);
  const toggleBottomPanelDefaultHeight = useLayoutStore(
    (s) => s.toggleBottomPanelDefaultHeight,
  );
  const setNavView = useLayoutStore((s) => s.setNavView);

  const gridRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [compact, setCompact] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    function onResize() {
      setNarrow(window.innerWidth < 1024);
      setCompact(window.innerWidth < 768);
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const showNav = navOpen && !compact;
  const showRail = showNav;
  const showDockedTools = toolsOpen && !narrow;
  const showToolsDrawer = toolsOpen && narrow;

  const railW = showRail ? NAV_RAIL_W : 0;
  const navW = showNav ? navWidthPx : 0;
  const toolsW = showDockedTools ? toolsWidthPx : 0;
  const bottomH = bottomPanelOpen
    ? bottomPanelSlim
      ? 28
      : bottomPanelHeightPx
    : 0;

  const onNavResize = useCallback(
    (clientX: number) => {
      setNavWidthPx(clientX - (showRail ? NAV_RAIL_W : 0));
    },
    [setNavWidthPx, showRail],
  );

  const onToolsResize = useCallback(
    (clientX: number) => {
      const grid = gridRef.current?.getBoundingClientRect();
      const right = grid?.right ?? window.innerWidth;
      setToolsWidthPx(right - clientX);
    },
    [setToolsWidthPx],
  );

  const onBottomResize = useCallback(
    (clientY: number) => {
      const grid = gridRef.current?.getBoundingClientRect();
      const bottom = grid?.bottom ?? window.innerHeight;
      setBottomPanelHeightPx(bottom - clientY);
    },
    [setBottomPanelHeightPx],
  );

  const gridStyle = {
    ["--nav-rail-w" as string]: `${railW}px`,
    ["--nav-w" as string]: `${navW}px`,
    ["--tools-w" as string]: `${toolsW}px`,
    ["--sidebar-w" as string]: `${navW}px`,
    ["--ai-panel-w" as string]: `${toolsW}px`,
    ["--bottom-panel-h" as string]: `${bottomH}px`,
  } as CSSProperties;

  return (
    <TooltipProvider delayDuration={500}>
      <div className="flex min-h-0 flex-1 flex-col bg-[var(--bg-canvas)]">
        <div
          ref={gridRef}
          className={cn(
            "workbench-grid relative min-h-0 flex-1",
            dragging && "workbench-grid-dragging",
          )}
          style={gridStyle}
        >
          {showRail ? (
            <div className="workbench-nav-rail min-h-0 overflow-hidden">
              <WorkspaceNavRail
                onOpenSettings={onOpenSettings}
                onNewAgent={onNewAgent}
              />
            </div>
          ) : (
            <div className="workbench-nav-rail" aria-hidden />
          )}

          {showNav ? (
            <div className="workbench-nav relative min-h-0 min-w-0 overflow-hidden border-r border-[var(--border-subtle)]">
              <div className="absolute right-1 top-1 z-10">
                <button
                  type="button"
                  className="btn-ghost h-6 w-6"
                  aria-label="Close explorer"
                  title="Close"
                  onClick={closeNav}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </div>
              <WorkspaceNavigator
                projects={projects}
                activeProjectId={project.id}
                onProjectSelect={onProjectChange}
                onNewAgent={onNewAgent}
              />
              <PanelSash
                axis="horizontal"
                aria-label="Resize navigator"
                className="absolute inset-y-0 -right-0.5 z-20"
                onDragStart={() => setDragging(true)}
                onDragEnd={() => setDragging(false)}
                onResizeTo={onNavResize}
              />
            </div>
          ) : (
            <div className="workbench-nav-spacer" aria-hidden />
          )}

          <div
            className={cn(
              "workbench-agent min-h-0 min-w-0 overflow-hidden",
              showDockedTools && "border-r border-[var(--border-subtle)]",
            )}
          >
            {agentWorkspace}
          </div>

          {showDockedTools ? (
            <div className="workbench-tools relative min-h-0 min-w-0 overflow-hidden">
              <PanelSash
                axis="horizontal"
                aria-label="Resize tools panel"
                className="absolute inset-y-0 -left-0.5 z-20"
                onDragStart={() => setDragging(true)}
                onDragEnd={() => setDragging(false)}
                onResizeTo={onToolsResize}
              />
              <div className="flex h-full min-w-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                <ToolsWorkspace />
              </div>
            </div>
          ) : (
            <div className="workbench-tools-spacer" aria-hidden />
          )}

          {bottomPanelOpen ? (
            <div className="workbench-bottom relative min-h-0 min-w-0 overflow-hidden">
              {!bottomPanelSlim && (
                <PanelSash
                  axis="vertical"
                  aria-label="Resize utility panel"
                  className="absolute inset-x-0 -top-0.5 z-20"
                  onDragStart={() => setDragging(true)}
                  onDragEnd={() => setDragging(false)}
                  onDoubleClick={toggleBottomPanelDefaultHeight}
                  onResizeTo={onBottomResize}
                />
              )}
              <div className="h-full overflow-hidden border-t border-[var(--border-subtle)]">
                <BottomPanel />
              </div>
            </div>
          ) : (
            <div className="workbench-bottom-spacer" aria-hidden />
          )}

          {showToolsDrawer && (
            <>
              <button
                type="button"
                aria-label="Close tools"
                className="absolute inset-0 z-[30] bg-[hsl(0_0%_0%/0.45)]"
                onClick={closeTools}
              />
              <aside className="absolute inset-y-0 right-0 z-[35] flex w-[min(100%,480px)] flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)]">
                <ToolsWorkspace />
              </aside>
            </>
          )}
        </div>

        {compact && (
          <nav
            className="flex h-10 shrink-0 items-center justify-around border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            aria-label="Mobile views"
          >
            <button
              type="button"
              className="px-3 py-2 text-[11px] text-[var(--text-secondary)]"
              onClick={() => openExplorer()}
            >
              Files
            </button>
            <button
              type="button"
              className="px-3 py-2 text-[11px] text-[var(--text-secondary)]"
              onClick={() => setNavView("agents")}
            >
              Agents
            </button>
            <button
              type="button"
              className="px-3 py-2 text-[11px] text-[var(--text-secondary)]"
              onClick={toggleTools}
            >
              Tools
            </button>
          </nav>
        )}

        <StatusBar project={project} model={model} credits={credits} />
      </div>
    </TooltipProvider>
  );
}
