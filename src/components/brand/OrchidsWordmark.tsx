import { cn } from "@/lib/utils";

interface OrchidsWordmarkProps {
  /** titlebar ≈ 13–14px; welcome ≈ 24–28px */
  size?: "titlebar" | "welcome";
  className?: string;
  showMark?: boolean;
}

/**
 * Brand wordmark — Space Grotesk only here, never on body UI.
 */
export function OrchidsWordmark({
  size = "titlebar",
  className,
  showMark = true,
}: OrchidsWordmarkProps) {
  const welcome = size === "welcome";
  return (
    <span
      className={cn(
        "inline-flex items-center font-[family-name:var(--font-display)] font-semibold text-[var(--text-primary)]",
        welcome
          ? "gap-2.5 text-[26px] tracking-[-0.02em]"
          : "gap-1.5 text-[13px] tracking-[-0.01em]",
        className,
      )}
    >
      {showMark && (
        <span
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary)] font-bold text-[var(--text-on-accent)]",
            welcome ? "h-10 w-10 text-[15px]" : "h-[18px] w-[18px] text-[10px]",
          )}
          aria-hidden
        >
          O
        </span>
      )}
      <span className={cn(welcome ? "leading-none" : "leading-none")}>
        Orchids
      </span>
    </span>
  );
}

export default OrchidsWordmark;
