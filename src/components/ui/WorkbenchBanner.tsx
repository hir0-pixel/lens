import { AlertCircle, AlertTriangle, Info, RefreshCw, X } from "@/components/icons/tabler";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type BannerTone = "error" | "warning" | "info";

interface WorkbenchBannerProps {
  tone?: BannerTone;
  title: string;
  description?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}

const TONE: Record<
  BannerTone,
  { icon: typeof AlertCircle; bar: string; bg: string; text: string }
> = {
  error: {
    icon: AlertCircle,
    bar: "bg-[var(--error)]",
    bg: "bg-[var(--error)]/10 border-[var(--error)]/20",
    text: "text-[var(--error)]",
  },
  warning: {
    icon: AlertTriangle,
    bar: "bg-[var(--warning)]",
    bg: "bg-[var(--warning)]/10 border-[var(--warning)]/20",
    text: "text-[var(--warning)]",
  },
  info: {
    icon: Info,
    bar: "bg-sky-400",
    bg: "bg-sky-500/10 border-sky-500/20",
    text: "text-sky-200",
  },
};

export function WorkbenchBanner({
  tone = "error",
  title,
  description,
  onRetry,
  onDismiss,
  className,
}: WorkbenchBannerProps) {
  const t = TONE[tone];
  const Icon = t.icon;
  return (
    <div
      role="alert"
      className={cn(
        "relative flex gap-3 overflow-hidden rounded-md border px-3 py-2.5",
        t.bg,
        className,
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-0.5", t.bar)} />
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", t.text)} />
      <div className="min-w-0 flex-1">
        <div className={cn("type-caption font-medium", t.text)}>{title}</div>
        {description && (
          <p className="mt-0.5 type-caption leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
        {onRetry && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onRetry}
            className="mt-1.5 h-6 gap-1 px-1.5 type-caption"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="h-5 w-5 shrink-0 rounded text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
