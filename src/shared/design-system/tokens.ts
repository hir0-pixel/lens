/**
 * Lens Design System — TypeScript tokens (mirror of CSS HSL system).
 * Prefer CSS vars in styles; use these for JS layout math.
 */

export const SPACE = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

export const LAYOUT = {
  activityBarWidth: 48,
  activityBarAction: 48,
  statusBarHeight: 24,
  titleBarHeight: 32,
  projectToolbarHeight: 36,
  sidebarTitleHeight: 32,
  tabsHeight: 28,
  panelTitleHeight: 32,
  panelToolbarHeight: 28,
  listRowHeight: 22,
  menuItemHeight: 28,
  sash: 4,
  treeIndent: 12,
  sidebarMinWidth: 180,
  editorMinWidth: 320,
  aiPanelMinWidth: 280,
  iconActivity: 18,
  iconToolbar: 16,
  iconInline: 14,
  iconStatus: 14,
} as const;

export const TYPE = {
  xs: 11,
  sm: 12,
  base: 13,
  md: 14,
  lg: 16,
  xl: 22,
  meta: 11,
  caption: 11,
  body: 12,
  bodyEmphasis: 13,
  title: 14,
  heading: 16,
  palette: 13,
  status: 11,
} as const;

export const ICON = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 24,
  activity: 18,
  toolbar: 16,
  status: 14,
} as const;

export const RADIUS = {
  none: 0,
  chrome: 4,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 8,
  pill: 9999,
  full: 9999,
} as const;

export const MOTION = {
  instant: 100,
  fast: 150,
  base: 220,
  slow: 320,
  hover: 100,
  panel: 320,
  enter: 220,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
  easingOut: "cubic-bezier(0, 0, 0, 1)",
  easingIn: "cubic-bezier(0.3, 0, 1, 1)",
  easingSpring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  easingHover: "cubic-bezier(0.2, 0, 0, 1)",
} as const;

export const Z = {
  base: 0,
  sticky: 10,
  dropdown: 40,
  modal: 50,
  toast: 60,
  tooltip: 70,
} as const;

export const OPACITY = {
  hover: 0.08,
  active: 0.12,
  borderSubtle: 0.06,
  border: 0.1,
  disabled: 0.4,
  overlay: 0.6,
} as const;

export const SEMANTIC = {
  error: "hsl(0, 84%, 60%)",
  warning: "hsl(38, 92%, 55%)",
  success: "hsl(142, 70%, 45%)",
  info: "hsl(200, 90%, 60%)",
  modified: "hsl(200, 90%, 60%)",
  added: "hsl(142, 70%, 45%)",
  deleted: "hsl(0, 84%, 60%)",
  conflict: "hsl(38, 92%, 55%)",
  ignored: "hsl(240, 6%, 48%)",
  brand: "hsl(266, 85%, 65%)",
  focus: "hsl(266, 85%, 65%)",
} as const;

export const PROVIDER_COLORS = {
  lens: "#8B5CF6",
  anthropic: "#D97757",
  openai: "#10A37F",
  google: "#8E75B2",
  cursor: "#7EE787",
  ollama: "#FFFFFF",
  openrouter: "#A78BFA",
  azure: "#0078D4",
  custom: "#A1A1AA",
  chatgpt: "#10A37F",
  claude: "#D97757",
  gemini: "#8E75B2",
  copilot: "#7EE787",
} as const;

export const cx = {
  panelHeader:
    "flex h-8 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3",
  panelHeaderTitle:
    "truncate text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-tertiary)]",
  toolbar:
    "flex h-7 shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-2",
  listRow:
    "relative flex h-[22px] items-center gap-1 px-3 text-[12px] text-[var(--text-primary)] transition-colors duration-[var(--duration-instant)] hover:bg-[var(--bg-hover)]",
} as const;

export function cnTokens(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
