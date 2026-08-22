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
  amber: "#FCAA26",
  blue: "#3B82F6",
  emerald: "#10B981",
  violet: "#8B5CF6",
  rose: "#F43F5E",
  cyan: "#06B6D4",
};

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  themeMode: "dark",
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

  // Sync design-system accent + shadcn primary when accent changes
  if (settings.accent === "amber") {
    root.style.setProperty("--primary", "36 97% 57%");
    root.style.setProperty("--ring", "36 97% 57%");
    root.style.setProperty("--accent-primary", "hsl(38, 92%, 55%)");
    root.style.setProperty("--accent-primary-hover", "hsl(38, 92%, 62%)");
    root.style.setProperty("--accent-primary-muted", "hsl(38, 60%, 20%)");
    root.style.setProperty("--border-focus", "hsl(38, 92%, 55%)");
  } else if (settings.accent === "blue") {
    root.style.setProperty("--primary", "217 91% 60%");
    root.style.setProperty("--ring", "217 91% 60%");
    root.style.setProperty("--accent-primary", "hsl(217, 91%, 60%)");
    root.style.setProperty("--accent-primary-hover", "hsl(217, 91%, 68%)");
    root.style.setProperty("--accent-primary-muted", "hsl(217, 60%, 20%)");
    root.style.setProperty("--border-focus", "hsl(217, 91%, 60%)");
  } else if (settings.accent === "emerald") {
    root.style.setProperty("--primary", "160 84% 39%");
    root.style.setProperty("--ring", "160 84% 39%");
    root.style.setProperty("--accent-primary", "hsl(160, 84%, 39%)");
    root.style.setProperty("--accent-primary-hover", "hsl(160, 84%, 46%)");
    root.style.setProperty("--accent-primary-muted", "hsl(160, 50%, 18%)");
    root.style.setProperty("--border-focus", "hsl(160, 84%, 39%)");
  } else if (settings.accent === "violet") {
    root.style.setProperty("--primary", "266 85% 65%");
    root.style.setProperty("--ring", "266 85% 65%");
    root.style.setProperty("--accent-primary", "hsl(266, 85%, 65%)");
    root.style.setProperty("--accent-primary-hover", "hsl(266, 85%, 72%)");
    root.style.setProperty("--accent-primary-muted", "hsl(266, 60%, 20%)");
    root.style.setProperty("--border-focus", "hsl(255, 85%, 65%)");
  } else if (settings.accent === "rose") {
    root.style.setProperty("--primary", "347 77% 60%");
    root.style.setProperty("--ring", "347 77% 60%");
    root.style.setProperty("--accent-primary", "hsl(347, 77%, 60%)");
    root.style.setProperty("--accent-primary-hover", "hsl(347, 77%, 68%)");
    root.style.setProperty("--accent-primary-muted", "hsl(347, 50%, 20%)");
    root.style.setProperty("--border-focus", "hsl(347, 77%, 60%)");
  } else if (settings.accent === "cyan") {
    root.style.setProperty("--primary", "189 94% 43%");
    root.style.setProperty("--ring", "189 94% 43%");
    root.style.setProperty("--accent-primary", "hsl(189, 94%, 43%)");
    root.style.setProperty("--accent-primary-hover", "hsl(189, 94%, 50%)");
    root.style.setProperty("--accent-primary-muted", "hsl(189, 50%, 18%)");
    root.style.setProperty("--border-focus", "hsl(189, 94%, 43%)");
  }

  if (resolved === "light") {
    // Keep the Lens design-system tokens in sync with the shadcn tokens below.
    // Most workbench components consume these semantic variables rather than
    // --background/--foreground directly.
    root.style.setProperty("--bg-canvas", "hsl(240, 20%, 98%)");
    root.style.setProperty("--bg-surface", "hsl(0, 0%, 100%)");
    root.style.setProperty("--bg-surface-raised", "hsl(240, 14%, 96%)");
    root.style.setProperty("--bg-overlay", "hsl(0, 0%, 100%)");
    root.style.setProperty("--bg-hover", "hsl(240, 10%, 93%)");
    root.style.setProperty("--bg-active", "hsl(240, 9%, 89%)");
    root.style.setProperty("--bg-selected", `color-mix(in srgb, ${accent} 14%, white)`);
    root.style.setProperty("--border-subtle", "hsl(240, 8%, 90%)");
    root.style.setProperty("--border-default", "hsl(240, 7%, 82%)");
    root.style.setProperty("--border-strong", "hsl(240, 6%, 70%)");
    root.style.setProperty("--text-primary", "hsl(240, 10%, 12%)");
    root.style.setProperty("--text-secondary", "hsl(240, 6%, 36%)");
    root.style.setProperty("--text-tertiary", "hsl(240, 5%, 48%)");
    root.style.setProperty("--text-disabled", "hsl(240, 5%, 64%)");
    root.style.setProperty("--text-on-accent", "hsl(0, 0%, 100%)");
    root.style.setProperty("--accent-primary-muted", `color-mix(in srgb, ${accent} 14%, white)`);
    root.style.setProperty("--cursor-scrollbar", "hsl(240, 6%, 50% / 0.35)");
    root.style.setProperty("--cursor-scrollbar-hover", "hsl(240, 6%, 40% / 0.55)");
    root.style.setProperty("--background", "0 0% 98%");
    root.style.setProperty("--foreground", "240 5% 10%");
    root.style.setProperty("--card", "0 0% 100%");
    root.style.setProperty("--card-foreground", "240 5% 10%");
    root.style.setProperty("--popover", "0 0% 100%");
    root.style.setProperty("--popover-foreground", "240 5% 10%");
    root.style.setProperty("--muted", "240 5% 94%");
    root.style.setProperty("--muted-foreground", "240 4% 40%");
    root.style.setProperty("--border", "240 5% 88%");
    root.style.setProperty("--input", "240 5% 88%");
    root.style.setProperty("--secondary", "240 5% 94%");
    root.style.setProperty("--secondary-foreground", "240 5% 10%");
    root.style.setProperty("--sidebar-background", "0 0% 100%");
    root.style.setProperty("--sidebar-foreground", "240 6% 36%");
    root.style.setProperty("--sidebar-primary-foreground", "0 0% 100%");
    root.style.setProperty("--sidebar-accent", "240 10% 93%");
    root.style.setProperty("--sidebar-accent-foreground", "240 10% 12%");
    root.style.setProperty("--sidebar-border", "240 8% 90%");
  } else {
    root.style.removeProperty("--bg-canvas");
    root.style.removeProperty("--bg-surface");
    root.style.removeProperty("--bg-surface-raised");
    root.style.removeProperty("--bg-overlay");
    root.style.removeProperty("--bg-hover");
    root.style.removeProperty("--bg-active");
    root.style.removeProperty("--bg-selected");
    root.style.removeProperty("--border-subtle");
    root.style.removeProperty("--border-default");
    root.style.removeProperty("--border-strong");
    root.style.removeProperty("--text-primary");
    root.style.removeProperty("--text-secondary");
    root.style.removeProperty("--text-tertiary");
    root.style.removeProperty("--text-disabled");
    root.style.removeProperty("--text-on-accent");
    root.style.removeProperty("--cursor-scrollbar");
    root.style.removeProperty("--cursor-scrollbar-hover");
    root.style.setProperty("--background", "240 5% 5%");
    root.style.setProperty("--foreground", "240 5% 90%");
    root.style.setProperty("--card", "240 4% 8%");
    root.style.setProperty("--card-foreground", "240 5% 90%");
    root.style.setProperty("--popover", "240 4% 10%");
    root.style.setProperty("--popover-foreground", "240 5% 90%");
    root.style.setProperty("--muted", "240 4% 14%");
    root.style.setProperty("--muted-foreground", "240 4% 55%");
    root.style.setProperty("--border", "240 4% 16%");
    root.style.setProperty("--input", "240 4% 16%");
    root.style.setProperty("--secondary", "240 4% 12%");
    root.style.setProperty("--secondary-foreground", "240 5% 90%");
    root.style.removeProperty("--sidebar-background");
    root.style.removeProperty("--sidebar-foreground");
    root.style.removeProperty("--sidebar-primary-foreground");
    root.style.removeProperty("--sidebar-accent");
    root.style.removeProperty("--sidebar-accent-foreground");
    root.style.removeProperty("--sidebar-border");
  }

  root.classList.toggle("reduce-motion", settings.reducedMotion);
  root.classList.toggle("high-contrast", settings.highContrast);
  root.dataset.density = settings.density;
}
