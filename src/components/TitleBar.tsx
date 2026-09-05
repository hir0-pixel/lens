import { useState } from "react";
import { AnimatedIcon, ArrowLeft, ArrowRight, Check, Columns2, Database, PanelLeft, PanelRight, Plus, Search, SquareArrowOutUpRight, SquareTerminal, X } from "@/components/icons/tabler";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MenuBar } from "@/features/menu-bar/MenuBar";
import { TitleBarOverflowMenu } from "@/features/shell/TitleBarOverflowMenu";
import { WindowControls } from "@/features/shell/WindowControls";
import { WorkspaceLauncher } from "@/features/shell/WorkspaceLauncher";
import { LensWordmark } from "@/components/brand/LensWordmark";
import { MENU_BAR } from "@/features/menu-bar/menuRegistry";
import { openAgentsWindow } from "@/features/windows/openAppWindow";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
}

const AGENT_MENUS = MENU_BAR.filter((m) =>
  ["file", "edit", "view", "help"].includes(m.id),
);

/**
 * Minimal title bar. IDE button opens a separate OS window.
 */
export default function TitleBar({
  variant = "agents",
  onAgentsWindow: _onAgentsWindow,
  onOpenTerminal: _onOpenTerminal,
  onToggleSidePane: _onToggleSidePane,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
}: TitleBarProps) {
  const isAgents = variant === "agents";

  return (
    <>
      <div
        data-tauri-drag-region
        className="lens-window-caption titlebar-drag flex h-8 shrink-0 items-stretch select-none bg-[var(--bg-surface)]"
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
      <div className="pointer-events-none relative top-px flex items-center gap-3 px-1.5">
          <LensWordmark size="titlebar" showMark={false} />
        <div className="pointer-events-auto titlebar-no-drag flex h-full items-stretch">
          <MenuBar menus={isAgents ? AGENT_MENUS : MENU_BAR} />
        </div>
        {isAgents && (
          <div className="pointer-events-auto titlebar-no-drag flex h-full items-stretch pl-1">
            <button type="button" aria-label="Toggle sidebar" title="Toggle sidebar" onClick={_onToggleSidePane} className="group flex w-7 items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
              <AnimatedIcon icon={PanelLeft} className="h-3.5 w-3.5" strokeWidth={1.6} />
            </button>
            <button type="button" aria-label="Undo" title="Undo" disabled={!canGoBack} onClick={onGoBack} className="group flex w-7 items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:hover:bg-transparent">
              <AnimatedIcon icon={ArrowLeft} interaction="nudge" className="h-3.5 w-3.5" strokeWidth={1.6} />
            </button>
            <button type="button" aria-label="Redo" title="Redo" disabled={!canGoForward} onClick={onGoForward} className="group flex w-7 items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:hover:bg-transparent">
              <AnimatedIcon icon={ArrowRight} interaction="nudge" className="h-3.5 w-3.5" strokeWidth={1.6} />
            </button>
          </div>
        )}
        </div>
        <div className="titlebar-no-drag relative top-px ml-auto flex items-stretch">
          <WindowControls />
        </div>
      </div>
    </>
  );
}

const SERVERS_TABS = ["Servers", "MCP", "LSP", "Plugins"] as const;
const TAB_COUNTS: Record<string, number | undefined> = { Servers: 1, MCP: 1, Plugins: 1 };

function ServersPopover() {
  const [activeTab, setActiveTab] = useState<string>("Servers");
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <>
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Servers"
          title="Servers"
          className="group relative -top-px flex h-6 w-9 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <AnimatedIcon icon={Database} className="h-[17px] w-[17px] group-hover:-translate-y-px" strokeWidth={1.5} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={4}
        className="w-[340px] rounded-xl border border-[var(--border-default)] bg-[var(--bg-overlay)] p-0 text-[var(--text-primary)]"
      >
        <div className="flex border-b border-[var(--border-subtle)]">
          {SERVERS_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={cn(
                "px-3 py-2 type-caption transition-colors",
                activeTab === tab
                  ? "border-b border-[var(--accent-primary)] text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]",
              )}
              onClick={() => setActiveTab(tab)}
            >
              {TAB_COUNTS[tab] != null ? `${TAB_COUNTS[tab]} ${tab}` : tab}
            </button>
          ))}
        </div>

        <div className="px-3 py-2">
          {activeTab === "Servers" && (
            <div className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[var(--success)]" />
                <span className="type-caption text-[var(--text-primary)] font-medium">Local Server</span>
                <span className="type-caption text-[var(--text-tertiary)]">vlocal</span>
              </div>
              <Check className="h-4 w-4 text-[var(--text-tertiary)]" strokeWidth={1.8} />
            </div>
          )}
          {activeTab === "MCP" && (
            <McpEntry />
          )}
          {activeTab === "LSP" && (
            <p className="py-3 text-center type-caption text-[var(--text-secondary)]">LSPs auto-detected from file types</p>
          )}
          {activeTab === "Plugins" && (
            <div className="flex items-center gap-2 py-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--success)]" />
              <span className="truncate type-caption text-[var(--text-primary)]">
                file:///C:/Users/PMYLS/.config/opencode/plu...
              </span>
            </div>
          )}
        </div>

        {activeTab === "Servers" && (
          <div className="border-t border-[var(--border-subtle)] px-3 py-2">
            <button
              type="button"
              className="rounded-lg bg-[var(--bg-hover)] px-3 py-1.5 type-caption text-[var(--text-primary)] hover:bg-[var(--bg-active)]"
              onClick={() => setManageOpen(true)}
            >
              Manage servers
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>

    <ManageServersDialog open={manageOpen} onOpenChange={setManageOpen} />
    </>
  );
}

function ManageServersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "add">("list");

  const close = () => { onOpenChange(false); setView("list"); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); else onOpenChange(v); }}>
      <DialogContent className="max-w-[460px] gap-0 rounded-xl border border-[var(--border-default)] bg-[var(--bg-overlay)] p-0 text-[var(--text-primary)] [&>button]:hidden">
        {view === "list" ? (
          <>
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h2 className="type-title-sm text-[var(--text-primary)]">Servers</h2>
              <button type="button" className="rounded-md p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" onClick={close}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mx-5 mb-3 flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-3 py-1.5">
              <Search className="h-4 w-4 text-[var(--text-tertiary)]" />
              <input
                type="text"
                placeholder="Search servers"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 bg-transparent type-caption text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none"
              />
            </div>

            <div className="px-5 pb-3">
              <div className="flex items-center justify-between rounded-lg px-1 py-2">
                <div className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--success)]" />
                  <span className="type-nav text-[var(--text-primary)]">Local Server</span>
                  <span className="type-caption text-[var(--text-tertiary)]">vlocal</span>
                </div>
                <Check className="h-4 w-4 text-[var(--text-tertiary)]" strokeWidth={1.8} />
              </div>
            </div>

            <div className="border-t border-[var(--border-subtle)] px-5 py-3">
              <button
                type="button"
                className="flex items-center gap-1.5 type-caption text-[var(--text-primary)] hover:text-[var(--text-secondary)]"
                onClick={() => setView("add")}
              >
                <Plus className="h-4 w-4" />
                Add server
              </button>
            </div>
          </>
        ) : (
          <AddServerView onBack={() => setView("list")} onClose={close} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddServerView({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const fieldClass =
    "w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-3 py-2 type-caption text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--border-focus)]";

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 px-5 pt-5 pb-4">
        <button type="button" className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="type-title-sm text-[var(--text-primary)]">Add server</h2>
        <button type="button" className="ml-auto rounded-md p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-4 px-5 pb-5">
        <label className="flex flex-col gap-1.5">
          <span className="type-caption text-[var(--text-secondary)]">Server address</span>
          <input type="text" placeholder="http://localhost:4096" value={address} onChange={(e) => setAddress(e.target.value)} className={fieldClass} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="type-caption text-[var(--text-secondary)]">Server name (optional)</span>
          <input type="text" placeholder="Localhost" value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} />
        </label>

        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="type-caption text-[var(--text-secondary)]">Username (optional)</span>
            <input type="text" placeholder="opencode" value={username} onChange={(e) => setUsername(e.target.value)} className={fieldClass} />
          </label>
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="type-caption text-[var(--text-secondary)]">Password (optional)</span>
            <input type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} className={fieldClass} />
          </label>
        </div>
      </div>

      <div className="border-t border-[var(--border-subtle)] px-5 py-3">
        <button
          type="button"
          className="rounded-lg bg-[var(--accent-primary)] px-4 py-1.5 type-caption font-medium text-[var(--text-on-accent)] hover:bg-[var(--accent-primary-hover)]"
        >
          Add server
        </button>
      </div>
    </div>
  );
}

function McpEntry() {
  const [on, setOn] = useState(true);
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full transition-colors", on ? "bg-[var(--success)]" : "bg-[var(--bg-active)]")} />
        <span className="type-caption text-[var(--text-primary)] font-medium">shadcn</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={cn(
          "relative h-5 w-9 rounded-full transition-colors",
          on ? "bg-[var(--accent-primary)]" : "bg-[var(--bg-active)]",
        )}
        onClick={() => setOn(!on)}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-[var(--bg-surface)] transition-transform duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
            on ? "left-[18px]" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}

export interface LayoutToolbarProps {
  sidePaneOpen: boolean;
  activeRightPane?: "review" | "project-files" | null;
  onToggleSidePane?: () => void;
  onToggleReview?: () => void;
  onToggleProjectFiles?: () => void;
  onOpenTerminal?: () => void;
  onAgentsWindow?: () => void;
  variant?: "agents" | "ide";
  className?: string;
}

export function LayoutToolbar({
  sidePaneOpen,
  activeRightPane,
  onToggleSidePane,
  onToggleReview,
  onToggleProjectFiles,
  onOpenTerminal,
  onAgentsWindow,
  variant = "agents",
  className,
}: LayoutToolbarProps) {
  const isAgents = variant === "agents";
  return (
    <div className={cn("flex h-full items-center", className)}>
      {isAgents ? (
        <>
          <WorkspaceLauncher />
          <ServersPopover />
          <button
            type="button"
            aria-label="Toggle layout"
            title="Toggle layout"
          className={cn(
            "group relative -top-px flex h-6 w-8 items-center justify-center rounded-md hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
            activeRightPane === "review" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
          )}
            onClick={() => {
              if (onToggleReview) {
                onToggleReview();
                return;
              }
              if (sidePaneOpen) {
                onToggleSidePane?.();
              } else {
                window.dispatchEvent(new CustomEvent("lens:open-agents-tab", { detail: { kind: "review" } }));
              }
            }}
          >
            <AnimatedIcon icon={Columns2} className="h-[17px] w-[17px] group-hover:-translate-y-px" strokeWidth={1.5} />
          </button>
        </>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mx-1 h-full type-caption"
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
          className="group relative -top-px flex h-6 w-8 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
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
          <AnimatedIcon icon={SquareTerminal} className="h-[17px] w-[17px] group-hover:-translate-y-px" strokeWidth={1.6} />
      </button>
      {isAgents && (
        <button
          type="button"
          aria-label="Toggle side pane"
          title="Side pane"
          className={cn(
            "group relative -top-px flex h-6 w-8 items-center justify-center rounded-md hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
            activeRightPane === "project-files" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
          )}
          onClick={() => {
            if (onToggleProjectFiles) {
              onToggleProjectFiles();
              return;
            }
            if (onToggleSidePane) onToggleSidePane();
            else window.dispatchEvent(new CustomEvent("lens:toggle-agents-dock"));
          }}
        >
          <AnimatedIcon icon={PanelRight} className="h-[17px] w-[17px] group-hover:-translate-y-px" strokeWidth={1.5} />
        </button>
      )}
      <TitleBarOverflowMenu />
    </div>
  );
}

