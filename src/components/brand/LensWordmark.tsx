import { cn } from "@/lib/utils";
import lensLogo from "@/assets/lens-logo.png";

interface LensWordmarkProps {
  /** titlebar ≈ 13–14px; welcome ≈ 24–28px */
  size?: "titlebar" | "welcome";
  className?: string;
  showMark?: boolean;
}

/**
 * Brand wordmark — Space Grotesk only here, never on body UI.
 */
export function LensWordmark({
  size = "titlebar",
  className,
  showMark = true,
}: LensWordmarkProps) {
  const welcome = size === "welcome";
  return (
    <span
      className={cn(
        "inline-flex items-center font-[family-name:var(--font-display)] font-semibold text-[var(--text-primary)]",
        welcome
          ? "gap-2.5 text-[26px] tracking-[-0.39px] leading-[1.25]"
          : "gap-1.5 text-[13px] font-semibold leading-[1.4] tracking-normal",
        className,
      )}
    >
      {showMark && (
        <img
          src={lensLogo}
          alt=""
          className={cn(
            "shrink-0 rounded-[var(--radius-md)] object-cover",
            welcome ? "h-10 w-10" : "h-[18px] w-[18px]",
          )}
          aria-hidden
        />
      )}
      <span className="leading-none">
        Lens
      </span>
    </span>
  );
}

export default LensWordmark;
