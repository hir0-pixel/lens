import {
  Clock,
  Database,
  Eye,
  FileCode2,
  FolderTree,
  GitBranch,
  MoreHorizontal,
  Pencil,
  Plus,
  ScrollText,
  Sparkles,
  Terminal,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AIMode, Model } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ProviderDot } from "@/shared/design-system/ProviderDot";
import { type ToolsTabKind, useLayoutStore } from "@/stores/layoutStore";

const MODES: { id: AIMode; label: string; hint: string }[] = [
  { id: "agent", label: "Agent", hint: "Autonomous multi-file work" },
  { id: "ask", label: "Ask", hint: "Read-only Q&A" },
  { id: "edit", label: "Edit", hint: "Scoped single-file edits" },
];

const PANE_ITEMS: {
  id: ToolsTabKind;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "editor", label: "Editor", icon: FileCode2 },
  { id: "preview", label: "Preview", icon: Eye },
  { id: "browser", label: "Browser", icon: Eye },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "git", label: "Git", icon: GitBranch },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "tasks", label: "Tasks", icon: Sparkles },
  { id: "memory", label: "Memory", icon: Sparkles },
  { id: "database", label: "Database", icon: Database },
];

interface AIPanelHeaderProps {
  title: string;
  mode: AIMode;
  onModeChange: (mode: AIMode) => void;
  models: Model[];
  activeModel: Model;
  onModelChange: (model: Model) => void;
  onNewChat: () => void;
  onOpenHistory: () => void;
  onRenameTitle?: () => void;
  onDeleteChat?: () => void;
}

/**
 * Agent session chrome — title, history, on-demand pane menu, modes.
 */
export function AIPanelHeader({
  title,
  mode,
  onModeChange,
  models,
  activeModel,
  onModelChange,
  onNewChat,
  onOpenHistory,
  onRenameTitle,
  onDeleteChat,
}: AIPanelHeaderProps) {
  const openTools = useLayoutStore((s) => s.openTools);
  const openExplorer = useLayoutStore((s) => s.openExplorer);
  const openBottomPanel = useLayoutStore((s) => s.openBottomPanel);

  return (
    <TooltipProvider delayDuration={400}>
      <header className="sticky top-0 z-sticky shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="flex h-10 items-center gap-1 px-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onOpenHistory}
                className="btn-ghost h-7 w-7"
                aria-label="Session history"
              >
                <Clock className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </TooltipTrigger>
            <TooltipContent className="type-caption">Past sessions</TooltipContent>
          </Tooltip>

          <button
            type="button"
            onClick={onRenameTitle}
            title={title}
            className="min-w-0 flex-1 truncate rounded-[var(--radius-sm)] px-2 py-1 text-left type-body-sm font-semibold text-[var(--text-primary)] transition-colors duration-[var(--duration-instant)] hover:bg-[var(--bg-hover)]"
          >
            {title}
          </button>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="btn-ghost h-7 w-7"
                    aria-label="Add pane or new session"
                  >
                    <Plus className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent className="type-caption">
                New session · Open pane
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={onNewChat}>
                <Plus className="mr-2 h-3.5 w-3.5" />
                New session
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="type-caption-uppercase text-[var(--text-tertiary)]">
                Open pane
              </DropdownMenuLabel>
              {PANE_ITEMS.map(({ id, label, icon: Icon }) => (
                <DropdownMenuItem
                  key={id}
                  onClick={() => openTools(id)}
                >
                  <Icon className="mr-2 h-3.5 w-3.5" />
                  {label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => openExplorer()}>
                <FolderTree className="mr-2 h-3.5 w-3.5" />
                Explorer
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => openBottomPanel("terminal")}
              >
                <Terminal className="mr-2 h-3.5 w-3.5" />
                Bottom terminal
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="btn-ghost h-7 w-7" aria-label="More">
                <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={onRenameTitle}>
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Rename session
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDeleteChat}
                className="text-[var(--error)] focus:text-[var(--error)]"
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Delete session
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] px-2 py-2">
          <div
            className="grid flex-1 grid-cols-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-canvas)] p-0.5"
            role="tablist"
            aria-label="Agent mode"
          >
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                title={m.hint}
                onClick={() => onModeChange(m.id)}
                className={cn(
                  "rounded-[var(--radius-sm)] px-2 py-1.5 type-caption font-medium transition-[background-color,color] duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
                  "focus-visible:outline focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-[var(--focus-ring-offset)] focus-visible:outline-[var(--focus-ring-color)]",
                  mode === m.id
                    ? "bg-[var(--bg-surface-raised)] text-[var(--text-primary)]"
                    : "bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="btn-ghost h-8 max-w-[140px] gap-1.5 px-2 type-caption"
                title={`Model · ${MODES.find((m) => m.id === mode)?.hint}`}
              >
                <ProviderDot provider={activeModel.provider} />
                <span className="truncate">{activeModel.label}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {models.map((m) => (
                <DropdownMenuItem
                  key={m.id}
                  onClick={() => onModelChange(m)}
                  className={cn(m.id === activeModel.id && "bg-[var(--bg-hover)]")}
                >
                  <ProviderDot provider={m.provider} className="mr-2" />
                  {m.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </TooltipProvider>
  );
}
