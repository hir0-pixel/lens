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

export const ACCENT_COLORS: Record<AccentId, string> = {
  amber: "#ab570a",
  blue: "#0070f3",
  emerald: "#29bc9b",
  violet: "#4c2889",
  rose: "#c50000",
  cyan: "#50e3c2",
};

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  themeMode: "light",
  accent: "violet",
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

export function resolveThemeMode(mode: ThemeMode): "dark" | "light" {
  if (mode === "system") {
    if (typeof window === "undefined") return "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return mode;
}

/** Apply theme tokens to documentElement. */
export function applyAppearance(settings: AppearanceSettings): void {
  const root = document.documentElement;
  const resolved = resolveThemeMode(settings.themeMode);
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
    root.style.setProperty("--primary", "0 0% 100%");
    root.style.setProperty("--primary-foreground", "0 0% 9%");
    root.style.setProperty("--ring", "163 72% 60%");
    root.style.setProperty("--accent-primary", accent);
    root.style.setProperty("--accent-primary-hover", "#29BC9B");
    root.style.setProperty("--accent-primary-active", "#29BC9B");
    root.style.setProperty("--accent-primary-muted", `color-mix(in srgb, ${accent} 18%, #171717)`);
    root.style.setProperty("--border-focus", accent);
    root.style.setProperty("--success", "#50E3C2");
    root.style.setProperty("--warning", "#F5A623");
    root.style.setProperty("--error", "#EE0000");
    root.style.setProperty("--error-muted", "color-mix(in srgb, #EE0000 12%, #171717)");
    root.style.setProperty("--success-muted", "color-mix(in srgb, #50E3C2 18%, #171717)");
    root.style.setProperty("--info", "#50E3C2");
    root.style.setProperty("--gradient-accent", "linear-gradient(135deg, #007cf0 0%, #00dfd8 50%, #ff0080 100%)");
    root.style.setProperty("--gradient-accent-hover", "linear-gradient(135deg, #007cf0 0%, #7928ca 50%, #ff0080 100%)");
    root.style.setProperty("--gradient-glow", "radial-gradient(circle, color-mix(in srgb, #50e3c2 20%, transparent) 0%, transparent 70%)");
    // Keep the Lens design-system tokens in sync with the shadcn tokens below.
    // Most workbench components consume these semantic variables rather than
    // --background/--foreground directly.
    root.style.setProperty("--bg-canvas", "#171717");
    root.style.setProperty("--bg-surface", "color-mix(in srgb, #171717 92%, #ffffff)");
    root.style.setProperty("--bg-surface-raised", "color-mix(in srgb, #171717 84%, #ffffff)");
    root.style.setProperty("--bg-overlay", "color-mix(in srgb, #171717 78%, #ffffff)");
    root.style.setProperty("--bg-hover", "color-mix(in srgb, #171717 88%, #ffffff)");
    root.style.setProperty("--bg-active", "color-mix(in srgb, #171717 80%, #ffffff)");
    root.style.setProperty("--bg-selected", "color-mix(in srgb, #0070F3 20%, #171717)");
    root.style.setProperty("--border-subtle", "color-mix(in srgb, #ffffff 14%, #171717)");
    root.style.setProperty("--border-default", "color-mix(in srgb, #ffffff 28%, #171717)");
    root.style.setProperty("--border-strong", "#a1a1a1");
    root.style.setProperty("--text-primary", "#ffffff");
    root.style.setProperty("--text-secondary", "#ebebeb");
    root.style.setProperty("--text-tertiary", "#a1a1a1");
    root.style.setProperty("--text-disabled", "#888888");
    root.style.setProperty("--text-on-accent", "#171717");
    root.style.setProperty("--cursor-scrollbar", "#a1a1a1");
    root.style.setProperty("--cursor-scrollbar-hover", "#a1a1a1");
    root.style.setProperty("--background", "0 0% 9%");
    root.style.setProperty("--foreground", "0 0% 100%");
    root.style.setProperty("--card", "0 0% 15%");
    root.style.setProperty("--card-foreground", "0 0% 100%");
    root.style.setProperty("--popover", "0 0% 22%");
    root.style.setProperty("--popover-foreground", "0 0% 100%");
    root.style.setProperty("--muted", "0 0% 15%");
    root.style.setProperty("--muted-foreground", "0 0% 63%");
    root.style.setProperty("--border", "0 0% 28%");
    root.style.setProperty("--input", "0 0% 15%");
    root.style.setProperty("--secondary", "0 0% 15%");
    root.style.setProperty("--secondary-foreground", "0 0% 100%");
    root.style.setProperty("--sidebar-background", "0 0% 12%");
    root.style.setProperty("--sidebar-foreground", "0 0% 63%");
    root.style.setProperty("--sidebar-primary", "0 0% 100%");
    root.style.setProperty("--sidebar-primary-foreground", "0 0% 9%");
    root.style.setProperty("--sidebar-accent", "0 0% 15%");
    root.style.setProperty("--sidebar-accent-foreground", "0 0% 100%");
    root.style.setProperty("--sidebar-border", "0 0% 28%");
    root.style.setProperty("--sidebar-ring", "163 72% 60%");
  } else {
    root.style.setProperty("--primary", "0 0% 9%");
    root.style.setProperty("--ring", "0 0% 9%");
    root.style.setProperty("--accent-primary", accent);
    root.style.setProperty("--accent-primary-hover", "#0070f3");
    root.style.setProperty("--accent-primary-active", "#0761d1");
    root.style.setProperty("--accent-primary-muted", "#ebebeb");
    root.style.setProperty("--border-focus", accent);
    root.style.setProperty("--success", "#0070f3");
    root.style.setProperty("--warning", "#f5a623");
    root.style.setProperty("--error", "#ee0000");
    root.style.setProperty("--error-muted", "color-mix(in srgb, #ee0000 12%, #ffffff)");
    root.style.setProperty("--success-muted", "color-mix(in srgb, #0070f3 12%, #ffffff)");
    root.style.setProperty("--info", "#0070f3");
    root.style.setProperty("--gradient-accent", "linear-gradient(135deg, #007cf0 0%, #00dfd8 50%, #ff0080 100%)");
    root.style.setProperty("--gradient-accent-hover", "linear-gradient(135deg, #007cf0 0%, #7928ca 50%, #ff0080 100%)");
    root.style.setProperty("--gradient-glow", "radial-gradient(circle, color-mix(in srgb, #0070f3 20%, transparent) 0%, transparent 70%)");
    root.style.setProperty("--bg-canvas", "#fafafa");
    root.style.setProperty("--bg-surface", "#ffffff");
    root.style.setProperty("--bg-surface-raised", "#ffffff");
    root.style.setProperty("--bg-overlay", "#ffffff");
    root.style.setProperty("--bg-hover", "#f5f5f5");
    root.style.setProperty("--bg-active", "#ebebeb");
    root.style.setProperty("--bg-selected", "#f5f5f5");
    root.style.setProperty("--border-subtle", "#ebebeb");
    root.style.setProperty("--border-default", "#a1a1a1");
    root.style.setProperty("--border-strong", "#a1a1a1");
    root.style.setProperty("--text-primary", "#171717");
    root.style.setProperty("--text-secondary", "#4d4d4d");
    root.style.setProperty("--text-tertiary", "#888888");
    root.style.setProperty("--text-disabled", "#a1a1a1");
    root.style.setProperty("--text-on-accent", "#ffffff");
    root.style.setProperty("--cursor-scrollbar", "#a1a1a1");
    root.style.setProperty("--cursor-scrollbar-hover", "#a1a1a1");
    root.style.setProperty("--background", "0 0% 98%");
    root.style.setProperty("--foreground", "0 0% 9%");
    root.style.setProperty("--card", "0 0% 100%");
    root.style.setProperty("--card-foreground", "0 0% 9%");
    root.style.setProperty("--popover", "0 0% 100%");
    root.style.setProperty("--popover-foreground", "0 0% 9%");
    root.style.setProperty("--muted", "0 0% 96%");
    root.style.setProperty("--muted-foreground", "0 0% 53%");
    root.style.setProperty("--border", "0 0% 96%");
    root.style.setProperty("--input", "0 0% 100%");
    root.style.setProperty("--secondary", "0 0% 96%");
    root.style.setProperty("--secondary-foreground", "0 0% 9%");
    root.style.setProperty("--sidebar-background", "0 0% 100%");
    root.style.setProperty("--sidebar-foreground", "0 0% 30%");
    root.style.setProperty("--sidebar-primary-foreground", "0 0% 100%");
    root.style.setProperty("--sidebar-accent", "0 0% 96%");
    root.style.setProperty("--sidebar-accent-foreground", "0 0% 9%");
    root.style.setProperty("--sidebar-border", "0 0% 92%");
  }

  root.classList.toggle("reduce-motion", settings.reducedMotion);
  root.classList.toggle("high-contrast", settings.highContrast);
  root.dataset.density = settings.density;
}
