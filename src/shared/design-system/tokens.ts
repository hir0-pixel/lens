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
  captionUppercase: 11,
  caption: 13,
  code: 13,
  button: 14,
  nav: 14,
  bodySm: 14,
  titleSm: 16,
  bodyMd: 16,
  titleMd: 18,
  displaySm: 22,
  displayMd: 26,
  xs: 11,
  sm: 13,
  base: 13,
  md: 14,
  lg: 16,
  xl: 22,
  meta: 11,
  body: 13,
  bodyEmphasis: 13,
  title: 16,
  heading: 16,
  palette: 13,
  status: 13,
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
  instant: 80,
  fast: 120,
  base: 180,
  slow: 200,
  hover: 80,
  panel: 200,
  enter: 180,
  easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
  easingOut: "cubic-bezier(0.16, 1, 0.3, 1)",
  easingIn: "cubic-bezier(0.16, 1, 0.3, 1)",
  easingHover: "cubic-bezier(0.25, 0.1, 0.25, 1)",
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
  error: "#ee0000",
  warning: "#f5a623",
  success: "#0070f3",
  info: "#0070f3",
  modified: "#d8ccf1",
  added: "#0070f3",
  deleted: "#ee0000",
  conflict: "#f5a623",
  ignored: "#888888",
  brand: "#0070f3",
  focus: "#0070f3",
} as const;

export const PROVIDER_COLORS = {
  lens: "#0070f3",
  anthropic: "#ffefcf",
  openai: "#0070f3",
  google: "#d8ccf1",
  cursor: "#0070f3",
  ollama: "#ffffff",
  openrouter: "#d8ccf1",
  azure: "#0070f3",
  custom: "#888888",
  chatgpt: "#0070f3",
  claude: "#ffefcf",
  gemini: "#d8ccf1",
  copilot: "#aaffec",
} as const;

export const cx = {
  panelHeader:
    "flex h-8 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3",
  panelHeaderTitle:
    "type-caption-uppercase truncate text-[var(--text-tertiary)]",
  toolbar:
    "flex h-7 shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-2",
  listRow:
    "relative flex h-[22px] items-center gap-1 px-3 type-caption text-[var(--text-primary)] transition-colors duration-[var(--duration-instant)] hover:bg-[var(--bg-hover)]",
} as const;

export function cnTokens(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
