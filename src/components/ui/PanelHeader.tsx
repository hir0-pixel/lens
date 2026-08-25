import { cn } from "@/lib/utils";
import { cx } from "@/shared/design-system";
import type { ReactNode } from "react";

interface PanelHeaderProps {
  title: string;
  actions?: ReactNode;
  className?: string;
  /** When false, skip uppercase tracking (e.g. AI panel) */
  uppercase?: boolean;
}

/** Standard workbench panel title row — Cursor h-9 rhythm */
export function PanelHeader({
  title,
  actions,
  className,
  uppercase = true,
}: PanelHeaderProps) {
  return (
    <div className={cn(cx.panelHeader, className)}>
      <span
        className={cn(
          uppercase
            ? cx.panelHeaderTitle
            : "truncate type-caption font-medium text-foreground/90",
        )}
      >
        {title}
      </span>
      {actions && (
        <div className="ml-auto flex items-center gap-0.5">{actions}</div>
      )}
    </div>
  );
}

interface PanelToolbarProps {
  children: ReactNode;
  className?: string;
}

export function PanelToolbar({ children, className }: PanelToolbarProps) {
  return <div className={cn(cx.toolbar, className)}>{children}</div>;
}
