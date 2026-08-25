import {
  AlertCircle,
  FileCode2,
  FolderOpen,
  GitBranch,
  Layers,
  MousePointer2,
  Terminal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContextChip, ContextChipKind } from "@/lib/types";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const CHIP_META: Record<
  ContextChipKind,
  { icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }
> = {
  workspace: { icon: Layers },
  file: { icon: FileCode2 },
  folder: { icon: FolderOpen },
  selection: { icon: MousePointer2 },
  terminal: { icon: Terminal },
  git: { icon: GitBranch },
  errors: { icon: AlertCircle },
  diagnostics: { icon: AlertCircle },
};

interface ContextChipsProps {
  chips: ContextChip[];
  onRemove?: (id: string) => void;
}

/**
 * Horizontally scrollable agent context scope chips.
 */
export function ContextChips({ chips, onRemove }: ContextChipsProps) {
  if (chips.length === 0) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex shrink-0 gap-2 overflow-x-auto border-b border-[var(--border-subtle)] px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Agent context"
      >
        {chips.map((chip) => {
          const Icon = CHIP_META[chip.kind].icon;
          return (
            <Tooltip key={chip.id}>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "group inline-flex h-7 max-w-[180px] shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)]",
                    "border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] pl-2 pr-1",
                    "type-caption text-[var(--text-secondary)] transition-colors duration-[var(--duration-instant)]",
                    "hover:border-[var(--border-default)] hover:text-[var(--text-primary)]",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--accent-primary)]" strokeWidth={1.5} />
                  <span className="truncate" title={chip.detail ?? chip.label}>
                    {chip.label}
                  </span>
                  {onRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(chip.id)}
                      className="rounded-[var(--radius-sm)] p-0.5 opacity-0 transition-opacity duration-[var(--duration-instant)] hover:bg-[var(--bg-hover)] group-hover:opacity-100"
                      aria-label={`Remove ${chip.label}`}
                    >
                      <X className="h-3 w-3 text-[var(--text-tertiary)]" />
                    </button>
                  )}
                </span>
              </TooltipTrigger>
              {chip.detail && (
                <TooltipContent side="bottom" className="type-caption">
                  {chip.detail}
                </TooltipContent>
              )}
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
