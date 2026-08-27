export type ThemeMode = "dark" | "light" | "system";

export type AccentId =
  | "amber"
  | "blue"
  | "emerald"
  | "violet"
  | "rose"
  | "cyan";

export type UiDensity = "comfortable" | "compact" | "default";

export interface AppearanceSettings {
  themeMode: ThemeMode;
  accent: AccentId;
  density: UiDensity;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cornerRadius: number;
  iconTheme: "default" | "minimal";
  transparency: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
}

/** Accents drawn only from DESIGN-vercel.md color list */
export const ACCENT_COLORS: Record<AccentId, string> = {
  amber: "#ab570a", /* warning-deep */
  blue: "#0070f3", /* link */
  emerald: "#50e3c2", /* cyan */
  violet: "#7928ca",
  rose: "#ff0080", /* pink */
  cyan: "#50e3c2",
};

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  themeMode: "light",
  accent: "blue",
  density: "default",
  fontFamily: "Inter",
  fontSize: 13,
  lineHeight: 1.5,
  cornerRadius: 8,
  iconTheme: "default",
  transparency: false,
  reducedMotion: false,
  highContrast: false,
};

let themeTransitionTimer: number | undefined;
let applyingViewTransition = false;

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

export function resolveThemeMode(mode: ThemeMode): "dark" | "light" {
  if (mode === "system") {
    if (typeof window === "undefined") return "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return mode;
}

/** Apply theme tokens to documentElement — colors from DESIGN-vercel.md only. */
export function applyAppearance(settings: AppearanceSettings): void {
  const root = document.documentElement;
  const resolved = resolveThemeMode(settings.themeMode);
  const currentTheme = root.classList.contains("dark")
    ? "dark"
    : root.classList.contains("light")
      ? "light"
      : null;
  const shouldAnimateThemeChange =
    !settings.reducedMotion &&
    !applyingViewTransition &&
    currentTheme !== null &&
    currentTheme !== resolved;

  const transitionDocument = document as ViewTransitionDocument;
  if (shouldAnimateThemeChange && transitionDocument.startViewTransition) {
    try {
      transitionDocument.startViewTransition(() => {
        applyingViewTransition = true;
        try {
          applyAppearance(settings);
        } finally {
          applyingViewTransition = false;
        }
      });
      return;
    } catch {
      // Older webviews can expose the API without supporting a new transition.
      // Fall through to the CSS-based transition below.
    }
  }

  if (shouldAnimateThemeChange) {
    root.classList.add("theme-transition");
    // Ensure the transition rule is computed before the token values change.
    void root.offsetWidth;
  }

  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
  root.style.colorScheme = resolved;

  const accent = ACCENT_COLORS[settings.accent];
  root.style.setProperty("--lens-accent", accent);
  root.style.setProperty("--radius", `${settings.cornerRadius / 16}rem`);
  root.style.setProperty("--lens-font-size", `${settings.fontSize}px`);
  root.style.setProperty("--lens-line-height", String(settings.lineHeight));
  root.style.setProperty("--lens-font-family", settings.fontFamily);

  if (resolved === "dark") {
    root.style.setProperty("--primary", "0 0% 98%");
    root.style.setProperty("--primary-foreground", "0 0% 9%");
    root.style.setProperty("--ring", "212 100% 48%");
    /* CTA: elevated canvas on dark */
    root.style.setProperty("--accent-primary", "#fafafa");
    root.style.setProperty("--accent-primary-hover", "#ebebeb");
    root.style.setProperty("--accent-primary-active", "#a1a1a1");
    root.style.setProperty("--accent-primary-muted", `color-mix(in srgb, ${accent} 22%, #0a0a0a)`);
    root.style.setProperty("--border-focus", "#0070f3");
    root.style.setProperty("--focus-ring-color", "#0070f3");
    root.style.setProperty("--focus-ring-width", "2px");
    root.style.setProperty("--focus-ring-offset", "2px");
    root.style.setProperty("--cursor-focus", "#0070f3");
    root.style.setProperty("--link", "#0070f3");
    root.style.setProperty("--link-deep", "#0761d1");
    root.style.setProperty("--success", "#0070f3");
    root.style.setProperty("--warning", "#f5a623");
    root.style.setProperty("--error", "#ee0000");
    root.style.setProperty("--error-muted", "color-mix(in srgb, #ee0000 16%, #0a0a0a)");
    root.style.setProperty("--success-muted", "color-mix(in srgb, #0070f3 18%, #0a0a0a)");
    root.style.setProperty("--info", "#0070f3");
    root.style.setProperty("--gradient-accent", "#fafafa");
    root.style.setProperty("--gradient-accent-hover", "#ebebeb");
    root.style.setProperty(
      "--gradient-glow",
      `radial-gradient(circle, color-mix(in srgb, ${accent} 20%, transparent) 0%, transparent 70%)`,
    );
    root.style.setProperty("--bg-canvas", "#0a0a0a");
    root.style.setProperty("--bg-surface", "#171717");
    root.style.setProperty("--bg-surface-raised", "color-mix(in srgb, #171717 88%, #ffffff 12%)");
    root.style.setProperty("--bg-overlay", "color-mix(in srgb, #171717 78%, #ffffff 22%)");
    root.style.setProperty("--bg-hover", "color-mix(in srgb, #171717 86%, #ffffff 14%)");
    root.style.setProperty("--bg-active", "color-mix(in srgb, #171717 78%, #ffffff 22%)");
    root.style.setProperty("--bg-selected", `color-mix(in srgb, ${accent} 18%, #0a0a0a)`);
    root.style.setProperty("--border-subtle", "color-mix(in srgb, #ffffff 12%, #0a0a0a)");
    root.style.setProperty("--border-default", "color-mix(in srgb, #ffffff 20%, #0a0a0a)");
    root.style.setProperty("--border-strong", "#a1a1a1");
    root.style.setProperty("--text-primary", "#fafafa");
    root.style.setProperty("--text-secondary", "#a1a1a1");
    root.style.setProperty("--text-tertiary", "#8f8f8f");
    root.style.setProperty("--text-disabled", "#8f8f8f");
    root.style.setProperty("--text-on-accent", "#171717");
    root.style.setProperty("--cursor-title-bg", "#0a0a0a");
    root.style.setProperty("--cursor-title-fg", "#a1a1a1");
    root.style.setProperty("--cursor-scrollbar", "#8f8f8f");
    root.style.setProperty("--cursor-scrollbar-hover", "#a1a1a1");
    root.style.setProperty("--scrollbar-size", "10px");
    root.style.setProperty("--background", "0 0% 4%");
    root.style.setProperty("--foreground", "0 0% 98%");
    root.style.setProperty("--card", "0 0% 9%");
    root.style.setProperty("--card-foreground", "0 0% 98%");
    root.style.setProperty("--popover", "0 0% 9%");
    root.style.setProperty("--popover-foreground", "0 0% 98%");
    root.style.setProperty("--muted", "0 0% 15%");
    root.style.setProperty("--muted-foreground", "0 0% 56%");
    root.style.setProperty("--border", "0 0% 20%");
    root.style.setProperty("--input", "0 0% 15%");
    root.style.setProperty("--secondary", "0 0% 15%");
    root.style.setProperty("--secondary-foreground", "0 0% 98%");
    root.style.setProperty("--sidebar-background", "0 0% 6%");
    root.style.setProperty("--sidebar-foreground", "0 0% 56%");
    root.style.setProperty("--sidebar-primary", "0 0% 98%");
    root.style.setProperty("--sidebar-primary-foreground", "0 0% 9%");
    root.style.setProperty("--sidebar-accent", "0 0% 15%");
    root.style.setProperty("--sidebar-accent-foreground", "0 0% 98%");
    root.style.setProperty("--sidebar-border", "0 0% 20%");
    root.style.setProperty("--sidebar-ring", "212 100% 48%");
  } else {
    root.style.setProperty("--primary", "0 0% 9%");
    root.style.setProperty("--primary-foreground", "0 0% 100%");
    root.style.setProperty("--ring", "212 100% 48%");
    /* Primary CTA = ink; user accent only tints muted / selected / glow */
    root.style.setProperty("--accent-primary", "#171717");
    root.style.setProperty(
      "--accent-primary-hover",
      "color-mix(in srgb, #171717 88%, #ffffff 12%)",
    );
    root.style.setProperty("--accent-primary-active", "#0a0a0a");
    root.style.setProperty("--accent-primary-muted", "#d3e5ff");
    root.style.setProperty("--focus-ring-color", "#0070f3");
    root.style.setProperty("--focus-ring-width", "2px");
    root.style.setProperty("--focus-ring-offset", "2px");
    root.style.setProperty("--border-focus", "#0070f3");
    root.style.setProperty("--cursor-focus", "#0070f3");
    root.style.setProperty("--link", "#0070f3");
    root.style.setProperty("--link-deep", "#0761d1");
    root.style.setProperty("--success", "#0070f3");
    root.style.setProperty("--warning", "#f5a623");
    root.style.setProperty("--error", "#ee0000");
    root.style.setProperty("--error-muted", "color-mix(in srgb, #ee0000 12%, #ffffff)");
    root.style.setProperty("--success-muted", "#d3e5ff");
    root.style.setProperty("--info", "#0070f3");
    root.style.setProperty("--gradient-accent", "#171717");
    root.style.setProperty("--gradient-accent-hover", "color-mix(in srgb, #171717 88%, #ffffff 12%)");
    root.style.setProperty(
      "--gradient-glow",
      `radial-gradient(circle, color-mix(in srgb, ${accent} 18%, transparent) 0%, transparent 70%)`,
    );
    root.style.setProperty("--bg-canvas", "#fafafa");
    root.style.setProperty("--bg-surface", "#ffffff");
    root.style.setProperty("--bg-surface-raised", "#fafafa");
    root.style.setProperty("--bg-overlay", "#ffffff");
    root.style.setProperty("--bg-hover", "#f2f2f2");
    root.style.setProperty("--bg-active", "#ebebeb");
    root.style.setProperty("--bg-selected", "#ebebeb");
    root.style.setProperty("--border-subtle", "#ebebeb");
    root.style.setProperty("--border-default", "#ebebeb");
    root.style.setProperty("--border-strong", "#a1a1a1");
    root.style.setProperty("--text-primary", "#171717");
    root.style.setProperty("--text-secondary", "#4d4d4d");
    root.style.setProperty("--text-tertiary", "#8f8f8f");
    root.style.setProperty("--text-disabled", "#a1a1a1");
    root.style.setProperty("--text-on-accent", "#ffffff");
    root.style.setProperty("--cursor-title-bg", "#fafafa");
    root.style.setProperty("--cursor-title-fg", "#4d4d4d");
    root.style.setProperty("--cursor-scrollbar", "#a1a1a1");
    root.style.setProperty("--cursor-scrollbar-hover", "#8f8f8f");
    root.style.setProperty("--scrollbar-size", "10px");
    root.style.setProperty("--background", "0 0% 98%");
    root.style.setProperty("--foreground", "0 0% 9%");
    root.style.setProperty("--card", "0 0% 100%");
    root.style.setProperty("--card-foreground", "0 0% 9%");
    root.style.setProperty("--popover", "0 0% 100%");
    root.style.setProperty("--popover-foreground", "0 0% 9%");
    root.style.setProperty("--muted", "0 0% 95%");
    root.style.setProperty("--muted-foreground", "0 0% 56%");
    root.style.setProperty("--border", "0 0% 92%");
    root.style.setProperty("--input", "0 0% 100%");
    root.style.setProperty("--secondary", "0 0% 95%");
    root.style.setProperty("--secondary-foreground", "0 0% 9%");
    root.style.setProperty("--sidebar-background", "0 0% 100%");
    root.style.setProperty("--sidebar-foreground", "0 0% 30%");
    root.style.setProperty("--sidebar-primary-foreground", "0 0% 100%");
    root.style.setProperty("--sidebar-accent", "0 0% 95%");
    root.style.setProperty("--sidebar-accent-foreground", "0 0% 9%");
    root.style.setProperty("--sidebar-border", "0 0% 92%");
    root.style.setProperty("--sidebar-ring", "212 100% 48%");
  }

  root.classList.toggle("high-contrast", settings.highContrast);
  root.classList.toggle("reduced-motion", settings.reducedMotion);
  root.dataset.density = settings.density;
  root.dataset.iconTheme = settings.iconTheme;
  root.dataset.transparency = settings.transparency ? "on" : "off";

  if (shouldAnimateThemeChange) {
    if (themeTransitionTimer !== undefined) {
      window.clearTimeout(themeTransitionTimer);
    }
    themeTransitionTimer = window.setTimeout(() => {
      root.classList.remove("theme-transition");
      themeTransitionTimer = undefined;
    }, 220);
  }
}
