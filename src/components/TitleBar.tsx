import { SquareArrowOutUpRight, SquareTerminal } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MenuBar } from "@/features/menu-bar/MenuBar";
import { WindowControls } from "@/features/shell/WindowControls";
import { TitleBarOverflowMenu } from "@/features/shell/TitleBarOverflowMenu";
import { WorkspaceLauncher } from "@/features/shell/WorkspaceLauncher";
import { MENU_BAR } from "@/features/menu-bar/menuRegistry";
import { openAgentsWindow } from "@/features/windows/openAppWindow";
import { LensWordmark } from "@/components/brand/LensWordmark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TitleBarProps {
  projectName?: string;
  onOpenSettings?: () => void;
  /** agents = Agents OS window; ide = separate IDE OS window */
  variant?: "agents" | "ide";
  onAgentsWindow?: () => void;
  onIdeWindow?: () => void;
  onOpenTerminal?: () => void;
  sidePaneOpen?: boolean;
  onToggleSidePane?: () => void;
}

const AGENT_MENUS = MENU_BAR.filter((m) =>
  ["file", "edit", "view", "help"].includes(m.id),
);

/**
 * Minimal title bar. IDE button opens a separate OS window.
 */
export default function TitleBar({
  projectName = "",
  onOpenSettings,
  variant = "agents",
  onAgentsWindow,
  onOpenTerminal,
  sidePaneOpen = false,
  onToggleSidePane,
}: TitleBarProps) {
  const isAgents = variant === "agents";

  return (
    <header
      data-tauri-drag-region
      className="cursor-titlebar titlebar-drag relative z-sticky flex h-8 shrink-0 select-none items-stretch bg-background"
      role="banner"
      onDoubleClick={() => {
        void (async () => {
          try {
            const w = getCurrentWindow();
            if (await w.isMaximized()) await w.unmaximize();
            else await w.maximize();
          } catch {
            /* browser */
          }
        })();
      }}
    >
      <div className="titlebar-no-drag relative z-[1] flex items-center gap-2 pl-2">
        <LensWordmark size="titlebar" />
        <MenuBar menus={isAgents ? AGENT_MENUS : MENU_BAR} />
      </div>

      {!isAgents && projectName && (
        <div
          data-tauri-drag-region
          className="pointer-events-none absolute left-1/2 top-0 flex h-full max-w-[40%] -translate-x-1/2 items-center px-4"
        >
          <span className="truncate text-[12px] text-[var(--text-tertiary)]">
            {projectName}
          </span>
        </div>
      )}

      <div className="titlebar-no-drag relative z-[1] ml-auto flex items-stretch">
        {isAgents ? (
          <WorkspaceLauncher />
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mx-1 h-full text-[12px]"
            aria-label="Agents Window"
            title="Switch to Agents Window"
            onClick={() => {
              if (onAgentsWindow) onAgentsWindow();
              else void openAgentsWindow();
            }}
          >
            Agents Window
            <SquareArrowOutUpRight className="h-3 w-3" strokeWidth={1.5} />
          </Button>
        )}

        <button
          type="button"
          aria-label="Open terminal"
          title="Terminal"
          className="flex h-full w-8 items-center justify-center text-[#c8c8c8] hover:bg-white/[0.08] hover:text-white"
          onClick={() => {
            if (onOpenTerminal) {
              onOpenTerminal();
              return;
            }
            window.dispatchEvent(
              new CustomEvent(
                isAgents ? "lens:open-terminal" : "lens:toggle-panel",
              ),
            );
          }}
        >
          <SquareTerminal className="h-4 w-4" strokeWidth={1.6} />
        </button>
        {isAgents && (
          <button
            type="button"
            aria-label="Toggle side pane"
            title="Side pane"
            className={cn(
              "flex h-full w-8 items-center justify-center hover:bg-white/[0.08] hover:text-white",
              sidePaneOpen ? "text-white" : "text-[#c8c8c8]",
            )}
            onClick={() => {
              if (onToggleSidePane) onToggleSidePane();
              else window.dispatchEvent(new CustomEvent("lens:toggle-agents-dock"));
            }}
          >
            <SidePaneGlyph active={sidePaneOpen} />
          </button>
        )}
        <TitleBarOverflowMenu />

        {!isAgents && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-full rounded-none px-3 text-[12px]"
            onClick={onOpenSettings}
            aria-label="Open Settings"
          >
            Settings
          </Button>
        )}
        <WindowControls />
      </div>
    </header>
  );
}

function SidePaneGlyph({ active }: { active: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={active ? "text-white" : "text-[#c8c8c8]"}
      aria-hidden
    >
      <rect
        x="1.5"
        y="1.5"
        width="13"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M5.5 2v12" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10.2 8.7 8.5 8l1.7-.7"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
