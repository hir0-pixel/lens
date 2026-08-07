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
  root.style.setProperty("--orchids-accent", accent);
  root.style.setProperty("--radius", `${settings.cornerRadius / 16}rem`);
  root.style.setProperty("--orchids-font-size", `${settings.fontSize}px`);
  root.style.setProperty("--orchids-line-height", String(settings.lineHeight));
  root.style.setProperty("--orchids-font-family", settings.fontFamily);

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
  } else {
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
  }

  root.classList.toggle("reduce-motion", settings.reducedMotion);
  root.classList.toggle("high-contrast", settings.highContrast);
  root.dataset.density = settings.density;
}
