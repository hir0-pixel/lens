import {
  BookOpen,
  Brain,
  FolderGit2,
  History,
  LayoutTemplate,
  MessageSquarePlus,
  Search,
  Settings,
  Sparkles,
  FolderKanban,
  Layers,
  Workflow,
  FileText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { type NavView, useLayoutStore } from "@/stores/layoutStore";
import { useCommandStore } from "@/features/command-palette/commandStore";
import { cn } from "@/lib/utils";

const TOP_ITEMS: {
  id: NavView;
  icon: LucideIcon;
  label: string;
  shortcut?: string;
}[] = [
  { id: "agents", icon: Sparkles, label: "Agents", shortcut: "Ctrl+Shift+A" },
  { id: "search", icon: Search, label: "Search", shortcut: "Ctrl+Shift+F" },
  { id: "automations", icon: Workflow, label: "Automations" },
  { id: "knowledge", icon: BookOpen, label: "Knowledge" },
  { id: "projects", icon: FolderKanban, label: "Projects" },
  { id: "workspaces", icon: Layers, label: "Workspaces" },
  { id: "repositories", icon: FolderGit2, label: "Repositories" },
  { id: "history", icon: History, label: "History" },
  { id: "memory", icon: Brain, label: "Memory" },
  { id: "prompts", icon: FileText, label: "Prompts" },
  { id: "templates", icon: LayoutTemplate, label: "Templates" },
];

interface WorkspaceNavRailProps {
  onOpenSettings?: () => void;
  onNewAgent?: () => void;
}

/**
 * 48px agent workspace navigator rail — not a VS Code activity bar.
 */
export function WorkspaceNavRail({
  onOpenSettings,
  onNewAgent,
}: WorkspaceNavRailProps) {
  const navView = useLayoutStore((s) => s.navView);
  const navOpen = useLayoutStore((s) => s.navOpen);
  const setNavView = useLayoutStore((s) => s.setNavView);
  const toggleTools = useLayoutStore((s) => s.toggleTools);
  const toolsOpen = useLayoutStore((s) => s.toolsOpen);

  return (
    <TooltipProvider delayDuration={400}>
      <aside
        className="cursor-activity-bar flex shrink-0 flex-col"
        aria-label="Workspace navigator"
      >
        <NavAction
          label="New Agent"
          shortcut="Ctrl+N"
          onClick={() => {
            setNavView("agents");
            onNewAgent?.();
            window.dispatchEvent(new CustomEvent("lens:new-agent"));
          }}
        >
          <MessageSquarePlus size={18} strokeWidth={1.75} />
        </NavAction>

        <div className="mx-2 my-1 h-px bg-[var(--border-subtle)]" />

        {TOP_ITEMS.map(({ id, icon: Icon, label, shortcut }) => (
          <NavAction
            key={id}
            label={label}
            shortcut={shortcut}
            pressed={navOpen && navView === id}
            onClick={() => {
              setNavView(id);
              if (id === "search") useCommandStore.getState().openSearch();
            }}
          >
            <Icon size={18} strokeWidth={1.75} className="shrink-0" />
          </NavAction>
        ))}

        <div className="mt-auto flex flex-col">
          <NavAction
            label="Toggle Tools"
            shortcut="Ctrl+L"
            pressed={toolsOpen}
            onClick={toggleTools}
          >
            <Layers size={18} strokeWidth={1.75} />
          </NavAction>
          <NavAction
            label="Settings"
            onClick={() => {
              setNavView("settings");
              onOpenSettings?.();
            }}
          >
            <Settings size={18} strokeWidth={1.75} />
          </NavAction>
        </div>
      </aside>
    </TooltipProvider>
  );
}

function NavAction({
  children,
  label,
  shortcut,
  pressed,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  shortcut?: string;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={cn(
            "relative flex h-12 w-12 items-center justify-center text-[var(--text-tertiary)]",
            "transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)]",
            "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
            "focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]",
            pressed && "text-[var(--text-primary)]",
          )}
        >
          {pressed && (
            <span
              className="absolute bottom-2 left-0 top-2 w-0.5 rounded-r bg-[var(--accent-primary)]"
              aria-hidden
            />
          )}
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-[12px]">
        {label}
        {shortcut ? ` · ${shortcut}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

export default WorkspaceNavRail;
