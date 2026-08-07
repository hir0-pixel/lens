import { ArrowLeft, ArrowRight, SquareArrowOutUpRight } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MenuBar } from "@/features/menu-bar/MenuBar";
import { WindowControls } from "@/features/shell/WindowControls";
import { MENU_BAR } from "@/features/menu-bar/menuRegistry";
import { useSessionStore } from "@/stores/sessionStore";
import { openIdeWindow, openAgentsWindow } from "@/features/windows/openAppWindow";
import { OrchidsWordmark } from "@/components/brand/OrchidsWordmark";
import { cn } from "@/lib/utils";

interface TitleBarProps {
  projectName?: string;
  onOpenSettings?: () => void;
  /** agents = Agents OS window; ide = separate IDE OS window */
  variant?: "agents" | "ide";
  onAgentsWindow?: () => void;
  onIdeWindow?: () => void;
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
  onIdeWindow,
}: TitleBarProps) {
  const isAgents = variant === "agents";
  const historyIndex = useSessionStore((s) => s.historyIndex);
  const historyLen = useSessionStore((s) => s.historyStack.length);
  const goBack = useSessionStore((s) => s.goBack);
  const goForward = useSessionStore((s) => s.goForward);
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex >= 0 && historyIndex < historyLen - 1;

  return (
    <header
      data-tauri-drag-region
      className="cursor-titlebar titlebar-drag relative z-sticky flex h-8 shrink-0 select-none items-stretch bg-[#0a0a0a]"
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
        <OrchidsWordmark size="titlebar" />
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
        <button
          type="button"
          className={cn(
            "flex h-full items-center px-1.5",
            canGoBack
              ? "text-[#8a8a8a] hover:text-[#d4d4d4]"
              : "cursor-not-allowed text-[#444]",
          )}
          aria-label="Back"
          disabled={!canGoBack}
          onClick={() => goBack()}
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          className={cn(
            "flex h-full items-center px-1.5",
            canGoForward
              ? "text-[#8a8a8a] hover:text-[#d4d4d4]"
              : "cursor-not-allowed text-[#444]",
          )}
          aria-label="Forward"
          disabled={!canGoForward}
          onClick={() => goForward()}
        >
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>

        {isAgents ? (
          <button
            type="button"
            className="mx-1 flex h-full items-center gap-1.5 rounded-md px-2.5 text-[12px] text-[#e8e8e8] hover:bg-white/[0.08]"
            aria-label="Open IDE"
            title="Open IDE in a new window"
            onClick={() => {
              if (onIdeWindow) onIdeWindow();
              else void openIdeWindow();
            }}
          >
            IDE
            <SquareArrowOutUpRight className="h-3 w-3" strokeWidth={1.5} />
          </button>
        ) : (
          <button
            type="button"
            className="mx-1 flex h-full items-center gap-1.5 rounded-md bg-[#1a3a5c] px-2.5 text-[12px] text-[#8ec8ff] hover:bg-[#214a70]"
            aria-label="Agents Window"
            title="Switch to Agents Window"
            onClick={() => {
              if (onAgentsWindow) onAgentsWindow();
              else void openAgentsWindow();
            }}
          >
            Agents Window
            <SquareArrowOutUpRight className="h-3 w-3" strokeWidth={1.5} />
          </button>
        )}

        {!isAgents && (
          <button
            type="button"
            className="btn-ghost h-full rounded-none px-3 text-[12px]"
            onClick={onOpenSettings}
            aria-label="Open Settings"
          >
            Settings
          </button>
        )}
        <WindowControls />
      </div>
    </header>
  );
}
