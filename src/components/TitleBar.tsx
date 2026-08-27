import { useState } from "react";
import { ArrowLeft, Check, Plus, Search, SquareArrowOutUpRight, SquareTerminal, X } from "lucide-react";
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
    <>
      <div
        data-tauri-drag-region
        className="lens-window-caption titlebar-drag flex h-8 shrink-0 items-stretch select-none"
      >
        <div className="pointer-events-none flex items-center px-1.5">
          <LensWordmark size="titlebar" />
        </div>
        <div className="titlebar-no-drag ml-auto flex items-stretch">
          <WindowControls />
        </div>
      </div>
    <header
      data-tauri-drag-region
      className="cursor-titlebar titlebar-drag relative z-sticky flex h-8 shrink-0 select-none items-stretch"
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
      <div className="titlebar-no-drag relative z-[1] flex items-center pl-2">
        <MenuBar menus={isAgents ? AGENT_MENUS : MENU_BAR} />
      </div>

      {!isAgents && projectName && (
        <div
          data-tauri-drag-region
          className="pointer-events-none absolute left-1/2 top-0 flex h-full max-w-[40%] -translate-x-1/2 items-center px-4"
        >
          <span className="truncate type-caption text-[var(--text-tertiary)]">
            {projectName}
          </span>
        </div>
      )}

      <div className="titlebar-no-drag relative z-[1] ml-auto flex items-stretch">
        {!sidePaneOpen && (
          <LayoutToolbar
            sidePaneOpen={sidePaneOpen}
            onToggleSidePane={onToggleSidePane}
            onOpenTerminal={onOpenTerminal}
            onAgentsWindow={onAgentsWindow}
            variant={variant}
          />
        )}

        {!isAgents && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-full rounded-none px-3 type-caption"
            onClick={onOpenSettings}
            aria-label="Open Settings"
          >
            Settings
          </Button>
        )}
      </div>
    </header>
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
          className="flex h-full w-8 items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="2" y="2" width="12" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
            <rect x="2" y="9" width="12" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="5" cy="4.5" r="0.9" fill="currentColor" />
            <circle cx="5" cy="11.5" r="0.9" fill="currentColor" />
          </svg>
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

function SidePaneGlyph({ active }: { active: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={active ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}
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

export interface LayoutToolbarProps {
  sidePaneOpen: boolean;
  onToggleSidePane?: () => void;
  onOpenTerminal?: () => void;
  onAgentsWindow?: () => void;
  variant?: "agents" | "ide";
  className?: string;
}

export function LayoutToolbar({
  sidePaneOpen,
  onToggleSidePane,
  onOpenTerminal,
  onAgentsWindow,
  variant = "agents",
  className,
}: LayoutToolbarProps) {
  const isAgents = variant === "agents";
  return (
    <div className={cn("flex items-stretch h-full", className)}>
      {isAgents ? (
        <>
          <WorkspaceLauncher />
          <ServersPopover />
          <button
            type="button"
            aria-label="Toggle layout"
            title="Toggle layout"
            className="flex h-full w-8 items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            onClick={() => {
              window.dispatchEvent(new CustomEvent("lens:open-agents-tab", { detail: { kind: "review" } }));
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <rect x="1.5" y="2" width="13" height="12" rx="1.8" stroke="currentColor" strokeWidth="1.3" />
              <path d="M8 2.5v11" stroke="currentColor" strokeWidth="1.3" />
            </svg>
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
        className="flex h-full w-8 items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
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
            "flex h-full w-8 items-center justify-center hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
            sidePaneOpen ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
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
    </div>
  );
}

