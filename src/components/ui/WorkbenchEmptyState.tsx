import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  shortcut?: string;
  /** First action defaults secondary; last defaults primary when multiple */
  variant?: "primary" | "secondary" | "ghost";
}

interface WorkbenchEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actions?: EmptyStateAction[];
  shortcuts?: { keys: string; label: string }[];
  className?: string;
  compact?: boolean;
  tone?: "neutral" | "error";
}

/**
 * Empty / placeholder state — entrance motion + button hierarchy (§7).
 */
export function WorkbenchEmptyState({
  icon: Icon,
  title,
  description,
  actions = [],
  shortcuts = [],
  className,
  compact,
  tone = "neutral",
}: WorkbenchEmptyStateProps) {
  return (
    <div
      className={cn(
        "lens-empty-enter flex flex-col",
        compact
          ? "items-start px-5 py-4 text-left"
          : "items-center justify-center px-6 py-8 text-center",
        className,
      )}
      role="status"
    >
      <div
        className={cn(
          "lens-empty-icon flex items-center justify-center rounded-2xl",
          compact ? "mb-3 h-10 w-10" : "mb-4 h-16 w-16",
          tone === "error"
            ? "bg-[var(--error-muted)] text-[var(--error)]"
            : "bg-[var(--bg-hover)] text-[var(--text-tertiary)]",
        )}
        aria-hidden
      >
        <Icon
          className={compact ? "h-5 w-5" : "h-7 w-7"}
          strokeWidth={1.5}
        />
      </div>

      <h3
        className={cn(
          "font-semibold text-[var(--text-primary)]",
          compact ? "text-[13px]" : "text-[16px] leading-6",
        )}
      >
        {title}
      </h3>
      <p
        className={cn(
          "mt-3 max-w-[400px] text-[13px] leading-6 text-[var(--text-secondary)]",
          compact && "mt-1 max-w-[280px] text-left",
        )}
      >
        {description}
      </p>

      {actions.length > 0 && (
        <div
          className={cn(
            "mt-6 flex flex-wrap items-center gap-3",
            compact && "mt-4 justify-start",
          )}
        >
          {actions.map((a, i) => {
            const tier =
              a.variant ??
              (actions.length > 1 && i === actions.length - 1
                ? "primary"
                : "secondary");
            return (
              <button
                key={a.label}
                type="button"
                onClick={a.onClick}
                className={cn(
                  tier === "primary" && "btn-primary",
                  tier === "secondary" && "btn-secondary",
                  tier === "ghost" && "btn-ghost",
                )}
              >
                {a.label}
                {a.shortcut && (
                  <kbd className="ml-1 font-mono text-[11px] opacity-70">
                    {a.shortcut}
                  </kbd>
                )}
              </button>
            );
          })}
        </div>
      )}

      {shortcuts.length > 0 && (
        <div className="mt-6 w-full max-w-[280px] space-y-1">
          {shortcuts.map((s) => (
            <div
              key={s.keys}
              className="flex items-center justify-between gap-3 text-[12px]"
            >
              <span className="text-[var(--text-tertiary)]">{s.label}</span>
              <kbd className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
