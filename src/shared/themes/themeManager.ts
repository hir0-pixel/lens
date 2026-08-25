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
  amber: "#f54e00",
  blue: "#f54e00",
  emerald: "#f54e00",
  violet: "#f54e00",
  rose: "#f54e00",
  cyan: "#f54e00",
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
    root.style.setProperty("--primary", "210 34% 63%");
    root.style.setProperty("--primary-foreground", "0 0% 8%");
    root.style.setProperty("--ring", "210 34% 65%");
    root.style.setProperty("--accent-primary", "#81A1C1");
    root.style.setProperty("--accent-primary-hover", "#87A6C4");
    root.style.setProperty("--accent-primary-active", "#6E8FAE");
    root.style.setProperty("--accent-primary-muted", "#202020");
    root.style.setProperty("--border-focus", "#87A6C4");
    root.style.setProperty("--success", "#3FA266");
    root.style.setProperty("--warning", "#F1B467");
    root.style.setProperty("--error", "#E34671");
    root.style.setProperty("--error-muted", "color-mix(in srgb, #E34671 12%, #181818)");
    root.style.setProperty("--success-muted", "color-mix(in srgb, #3FA266 12%, #181818)");
    root.style.setProperty("--info", "#87A6C4");
    root.style.setProperty("--gradient-accent", "linear-gradient(135deg, #81A1C1 0%, #81A1C1 50%, #81A1C1 100%)");
    root.style.setProperty("--gradient-accent-hover", "linear-gradient(135deg, #81A1C1 0%, #81A1C1 50%, #87A6C4 100%)");
    root.style.setProperty("--gradient-glow", "radial-gradient(circle, color-mix(in srgb, #81A1C1 22%, transparent) 0%, transparent 70%)");
    // Keep the Lens design-system tokens in sync with the shadcn tokens below.
    // Most workbench components consume these semantic variables rather than
    // --background/--foreground directly.
    root.style.setProperty("--bg-canvas", "#181818");
    root.style.setProperty("--bg-surface", "#141414");
    root.style.setProperty("--bg-surface-raised", "#181818");
    root.style.setProperty("--bg-overlay", "#1c1c1c");
    root.style.setProperty("--bg-hover", "#202020");
    root.style.setProperty("--bg-active", "#262626");
    root.style.setProperty("--bg-selected", "#1f1f1f");
    root.style.setProperty("--border-subtle", "#f0f0f013");
    root.style.setProperty("--border-default", "#f0f0f01f");
    root.style.setProperty("--border-strong", "#f0f0f033");
    root.style.setProperty("--text-primary", "#f0f0f0");
    root.style.setProperty("--text-secondary", "#f0f0f0bd");
    root.style.setProperty("--text-tertiary", "#f0f0f099");
    root.style.setProperty("--text-disabled", "#f0f0f070");
    root.style.setProperty("--text-on-accent", "#141414");
    root.style.setProperty("--cursor-scrollbar", "#f0f0f033");
    root.style.setProperty("--cursor-scrollbar-hover", "#f0f0f04d");
    root.style.setProperty("--background", "0 0% 9%");
    root.style.setProperty("--foreground", "0 0% 94%");
    root.style.setProperty("--card", "0 0% 9%");
    root.style.setProperty("--card-foreground", "0 0% 94%");
    root.style.setProperty("--popover", "0 0% 9%");
    root.style.setProperty("--popover-foreground", "0 0% 94%");
    root.style.setProperty("--muted", "0 0% 11%");
    root.style.setProperty("--muted-foreground", "0 0% 94% / 0.74");
    root.style.setProperty("--border", "0 0% 94% / 0.075");
    root.style.setProperty("--input", "0 0% 9%");
    root.style.setProperty("--secondary", "0 0% 11%");
    root.style.setProperty("--secondary-foreground", "0 0% 94%");
    root.style.setProperty("--sidebar-background", "0 0% 8%");
    root.style.setProperty("--sidebar-foreground", "0 0% 94% / 0.74");
    root.style.setProperty("--sidebar-primary", "210 34% 63%");
    root.style.setProperty("--sidebar-primary-foreground", "0 0% 8%");
    root.style.setProperty("--sidebar-accent", "0 0% 11%");
    root.style.setProperty("--sidebar-accent-foreground", "0 0% 94%");
    root.style.setProperty("--sidebar-border", "0 0% 94% / 0.075");
    root.style.setProperty("--sidebar-ring", "210 34% 65%");
  } else {
    root.style.setProperty("--primary", "19 100% 48%");
    root.style.setProperty("--ring", "19 100% 48%");
    root.style.setProperty("--accent-primary", "#f54e00");
    root.style.setProperty("--accent-primary-hover", "#f54e00");
    root.style.setProperty("--accent-primary-active", "#d04200");
    root.style.setProperty("--accent-primary-muted", "#e6e5e0");
    root.style.setProperty("--border-focus", "#f54e00");
    root.style.setProperty("--success", "#1f8a65");
    root.style.setProperty("--warning", "#c08532");
    root.style.setProperty("--error", "#cf2d56");
    root.style.setProperty("--error-muted", "color-mix(in srgb, #cf2d56 12%, #ffffff)");
    root.style.setProperty("--success-muted", "color-mix(in srgb, #1f8a65 12%, #ffffff)");
    root.style.setProperty("--info", "#9fbbe0");
    root.style.setProperty("--gradient-accent", "linear-gradient(135deg, #f54e00 0%, #f54e00 50%, #f54e00 100%)");
    root.style.setProperty("--gradient-accent-hover", "linear-gradient(135deg, #f54e00 0%, #f54e00 50%, #d04200 100%)");
    root.style.setProperty("--gradient-glow", "radial-gradient(circle, color-mix(in srgb, #f54e00 20%, transparent) 0%, transparent 70%)");
    root.style.setProperty("--bg-canvas", "#f7f7f4");
    root.style.setProperty("--bg-surface", "#fafaf7");
    root.style.setProperty("--bg-surface-raised", "#ffffff");
    root.style.setProperty("--bg-overlay", "#ffffff");
    root.style.setProperty("--bg-hover", "#e6e5e0");
    root.style.setProperty("--bg-active", "#cfcdc4");
    root.style.setProperty("--bg-selected", "#e6e5e0");
    root.style.setProperty("--border-subtle", "#efeee8");
    root.style.setProperty("--border-default", "#e6e5e0");
    root.style.setProperty("--border-strong", "#cfcdc4");
    root.style.setProperty("--text-primary", "#26251e");
    root.style.setProperty("--text-secondary", "#5a5852");
    root.style.setProperty("--text-tertiary", "#807d72");
    root.style.setProperty("--text-disabled", "#a09c92");
    root.style.setProperty("--text-on-accent", "#ffffff");
    root.style.setProperty("--cursor-scrollbar", "#cfcdc4");
    root.style.setProperty("--cursor-scrollbar-hover", "#a09c92");
    root.style.setProperty("--background", "60 16% 96%");
    root.style.setProperty("--foreground", "51 12% 13%");
    root.style.setProperty("--card", "0 0% 100%");
    root.style.setProperty("--card-foreground", "51 12% 13%");
    root.style.setProperty("--popover", "0 0% 100%");
    root.style.setProperty("--popover-foreground", "51 12% 13%");
    root.style.setProperty("--muted", "50 11% 89%");
    root.style.setProperty("--muted-foreground", "47 6% 47%");
    root.style.setProperty("--border", "50 11% 89%");
    root.style.setProperty("--input", "0 0% 100%");
    root.style.setProperty("--secondary", "50 11% 89%");
    root.style.setProperty("--secondary-foreground", "51 12% 13%");
    root.style.setProperty("--sidebar-background", "60 23% 97%");
    root.style.setProperty("--sidebar-foreground", "45 5% 34%");
    root.style.setProperty("--sidebar-primary-foreground", "0 0% 100%");
    root.style.setProperty("--sidebar-accent", "50 11% 89%");
    root.style.setProperty("--sidebar-accent-foreground", "51 12% 13%");
    root.style.setProperty("--sidebar-border", "51 18% 92%");
  }

  root.classList.toggle("reduce-motion", settings.reducedMotion);
  root.classList.toggle("high-contrast", settings.highContrast);
  root.dataset.density = settings.density;
}
