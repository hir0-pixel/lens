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

/** User-selectable accents; the default follows the Refactr brand pair. */
export const ACCENT_COLORS: Record<AccentId, string> = {
  amber: "#ab570a", /* warning-deep */
  blue: "#3183d8", /* shared Lens/Codex accent */
  emerald: "#50e3c2", /* cyan */
  violet: "#7928ca",
  rose: "#ff0080", /* pink */
  cyan: "#50e3c2",
};

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  themeMode: "dark",
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

  const accent = settings.accent === "blue"
    ? "#3183d8"
    : ACCENT_COLORS[settings.accent];
  root.style.setProperty("--lens-accent", accent);
  root.style.setProperty("--radius", `${settings.cornerRadius / 16}rem`);
  root.style.setProperty("--lens-font-size", `${settings.fontSize}px`);
  root.style.setProperty("--lens-line-height", String(settings.lineHeight));
  root.style.setProperty("--lens-font-family", settings.fontFamily);

  if (resolved === "dark") {
    root.style.setProperty("--primary", "211 69% 52%");
    root.style.setProperty("--primary-foreground", "45 13% 8%");
    root.style.setProperty("--ring", "211 69% 52%");
    root.style.setProperty("--accent-primary", accent);
    root.style.setProperty("--accent-primary-hover", "#5a9be0");
    root.style.setProperty("--accent-primary-active", "#1d62aa");
    root.style.setProperty("--accent-primary-muted", `color-mix(in srgb, ${accent} 22%, #141312)`);
    root.style.setProperty("--border-focus", "#3183d8");
    root.style.setProperty("--focus-ring-color", "#3183d8");
    root.style.setProperty("--focus-ring-width", "2px");
    root.style.setProperty("--focus-ring-offset", "2px");
    root.style.setProperty("--cursor-focus", "#3183d8");
    root.style.setProperty("--link", "#b5cef5");
    root.style.setProperty("--link-deep", "#b5cef5");
    root.style.setProperty("--success", "#26d862");
    root.style.setProperty("--warning", "#f5a623");
    root.style.setProperty("--error", "#b91c1c");
    root.style.setProperty("--error-muted", "color-mix(in srgb, #b91c1c 16%, #141312)");
    root.style.setProperty("--success-muted", "color-mix(in srgb, #26d862 18%, #141312)");
    root.style.setProperty("--info", "#b5cef5");
    root.style.setProperty("--gradient-accent", accent);
    root.style.setProperty("--gradient-accent-hover", "#5a9be0");
    root.style.setProperty(
      "--gradient-glow",
      `radial-gradient(circle, color-mix(in srgb, ${accent} 20%, transparent) 0%, transparent 70%)`,
    );
    root.style.setProperty("--bg-canvas", "#141312");
    root.style.setProperty("--bg-surface", "#1f2121");
    root.style.setProperty("--bg-surface-raised", "#26251e");
    root.style.setProperty("--bg-overlay", "#26251e");
    root.style.setProperty("--bg-hover", "#26251e");
    root.style.setProperty("--bg-active", "#26251e");
    root.style.setProperty("--bg-selected", `color-mix(in srgb, ${accent} 18%, #141312)`);
    root.style.setProperty("--border-subtle", "#2a2f37");
    root.style.setProperty("--border-default", "#2a2f37");
    root.style.setProperty("--border-strong", "#818581");
    root.style.setProperty("--text-primary", "#fdfbfa");
    root.style.setProperty("--text-secondary", "#818581");
    root.style.setProperty("--text-tertiary", "#818581");
    root.style.setProperty("--text-disabled", "#818581");
    root.style.setProperty("--text-on-accent", "#141312");
    root.style.setProperty("--user-message-bg", "#26251e");
    root.style.setProperty("--user-message-fg", "#fdfbfa");
    root.style.setProperty("--cursor-title-bg", "#141312");
    root.style.setProperty("--cursor-title-fg", "#818581");
    root.style.setProperty("--cursor-scrollbar", "#818581");
    root.style.setProperty("--cursor-scrollbar-hover", "#9ba1a6");
    root.style.setProperty("--scrollbar-size", "10px");
    root.style.setProperty("--background", "45 13% 8%");
    root.style.setProperty("--foreground", "30 20% 99%");
    root.style.setProperty("--card", "200 3% 13%");
    root.style.setProperty("--card-foreground", "30 20% 99%");
    root.style.setProperty("--popover", "30 2% 15%");
    root.style.setProperty("--popover-foreground", "30 20% 99%");
    root.style.setProperty("--muted", "30 2% 15%");
    root.style.setProperty("--muted-foreground", "115 2% 51%");
    root.style.setProperty("--border", "220 14% 19%");
    root.style.setProperty("--input", "30 2% 15%");
    root.style.setProperty("--secondary", "30 2% 15%");
    root.style.setProperty("--secondary-foreground", "30 20% 99%");
    root.style.setProperty("--sidebar-background", "45 13% 8%");
    root.style.setProperty("--sidebar-foreground", "115 2% 51%");
    root.style.setProperty("--sidebar-primary", "30 20% 99%");
    root.style.setProperty("--sidebar-primary-foreground", "45 13% 8%");
    root.style.setProperty("--sidebar-accent", "30 2% 15%");
    root.style.setProperty("--sidebar-accent-foreground", "30 20% 99%");
    root.style.setProperty("--sidebar-border", "220 14% 19%");
    root.style.setProperty("--sidebar-ring", "211 69% 52%");
  } else {
    root.style.setProperty("--primary", "211 69% 52%");
    root.style.setProperty("--primary-foreground", "45 13% 8%");
    root.style.setProperty("--ring", "211 69% 52%");
    /* Lens CTA uses the selected accent. */
    root.style.setProperty("--accent-primary", accent);
    root.style.setProperty(
      "--accent-primary-hover",
      "#5a9be0",
    );
    root.style.setProperty("--accent-primary-active", "#1d62aa");
    root.style.setProperty("--accent-primary-muted", "color-mix(in srgb, #3183d8 12%, #f1f0ec)");
    root.style.setProperty("--focus-ring-color", "#3183d8");
    root.style.setProperty("--focus-ring-width", "2px");
    root.style.setProperty("--focus-ring-offset", "2px");
    root.style.setProperty("--border-focus", "#3183d8");
    root.style.setProperty("--cursor-focus", "#3183d8");
    root.style.setProperty("--link", "#001d3c");
    root.style.setProperty("--link-deep", "#001d3c");
    root.style.setProperty("--success", "#26d862");
    root.style.setProperty("--warning", "#d9923a");
    root.style.setProperty("--error", "#b91c1c");
    root.style.setProperty("--error-muted", "color-mix(in srgb, #b91c1c 12%, #f1f0ec)");
    root.style.setProperty("--success-muted", "color-mix(in srgb, #26d862 12%, #f1f0ec)");
    root.style.setProperty("--info", "#1a73e8");
    root.style.setProperty("--gradient-accent", accent);
    root.style.setProperty("--gradient-accent-hover", "#5a9be0");
    root.style.setProperty(
      "--gradient-glow",
      `radial-gradient(circle, color-mix(in srgb, ${accent} 18%, transparent) 0%, transparent 70%)`,
    );
    root.style.setProperty("--bg-canvas", "#f1f0ec");
    root.style.setProperty("--bg-surface", "#fcfcf9");
    root.style.setProperty("--bg-surface-raised", "#e6e5e0");
    root.style.setProperty("--bg-overlay", "#fcfcf9");
    root.style.setProperty("--bg-hover", "#f2f1ed");
    root.style.setProperty("--bg-active", "#e6e5e0");
    root.style.setProperty("--bg-selected", "color-mix(in srgb, #3183d8 10%, #f1f0ec)");
    root.style.setProperty("--border-subtle", "#d8d4cd");
    root.style.setProperty("--border-default", "#d8d4cd");
    root.style.setProperty("--border-strong", "#8e918f");
    root.style.setProperty("--text-primary", "#26251e");
    root.style.setProperty("--text-secondary", "#5f6368");
    root.style.setProperty("--text-tertiary", "#818581");
    root.style.setProperty("--text-disabled", "#818581");
    root.style.setProperty("--text-on-accent", "#141312");
    root.style.setProperty("--user-message-bg", "#e6e5e0");
    root.style.setProperty("--user-message-fg", "#26251e");
    root.style.setProperty("--cursor-title-bg", "#f1f0ec");
    root.style.setProperty("--cursor-title-fg", "#5f6368");
    root.style.setProperty("--cursor-scrollbar", "#8e918f");
    root.style.setProperty("--cursor-scrollbar-hover", "#5f6368");
    root.style.setProperty("--scrollbar-size", "10px");
    root.style.setProperty("--background", "45 16% 94%");
    root.style.setProperty("--foreground", "45 13% 13%");
    root.style.setProperty("--card", "60 20% 98%");
    root.style.setProperty("--card-foreground", "45 13% 13%");
    root.style.setProperty("--popover", "60 20% 98%");
    root.style.setProperty("--popover-foreground", "45 13% 13%");
    root.style.setProperty("--muted", "45 12% 94%");
    root.style.setProperty("--muted-foreground", "216 5% 39%");
    root.style.setProperty("--border", "39 16% 83%");
    root.style.setProperty("--input", "60 20% 98%");
    root.style.setProperty("--secondary", "45 12% 94%");
    root.style.setProperty("--secondary-foreground", "45 13% 13%");
    root.style.setProperty("--sidebar-background", "60 20% 98%");
    root.style.setProperty("--sidebar-foreground", "216 5% 39%");
    root.style.setProperty("--sidebar-primary", "211 69% 52%");
    root.style.setProperty("--sidebar-primary-foreground", "45 13% 8%");
    root.style.setProperty("--sidebar-accent", "45 12% 94%");
    root.style.setProperty("--sidebar-accent-foreground", "45 13% 13%");
    root.style.setProperty("--sidebar-border", "39 16% 83%");
    root.style.setProperty("--sidebar-ring", "211 69% 52%");
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
