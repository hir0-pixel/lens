/**
 * Cursor / VS Code Dark Modern workbench tokens.
 * Source: theme-defaults/themes/dark_modern.json + ActivitybarPart constants.
 * Do not invent values — change only when verified against Cursor.
 */

export const CURSOR = {
  // Layout (px) — from VS Code ActivitybarPart / StatusbarPart
  activityBarWidth: 48,
  activityBarActionHeight: 48,
  activityBarIconSize: 24,
  statusBarHeight: 22,
  titleBarHeight: 35,
  /** Side bar section title row */
  sideBarTitleHeight: 35,
  /** Editor tabs row */
  editorTabsHeight: 35,
  /** Panel title / tab strip */
  panelTitleHeight: 35,
  /** Secondary toolbar under panel tabs */
  panelToolbarHeight: 28,
  sashSize: 4,
  sidebarDefaultWidth: 300,
  secondarySidebarDefaultWidth: 360,

  // Dark Modern colors
  colors: {
    activityBarBg: "#181818",
    activityBarBorder: "#2B2B2B",
    activityBarFg: "#D7D7D7",
    activityBarInactiveFg: "#868686",
    activityBarActiveBorder: "#0078D4",
    sideBarBg: "#181818",
    sideBarBorder: "#2B2B2B",
    sideBarFg: "#CCCCCC",
    editorBg: "#1F1F1F",
    editorFg: "#CCCCCC",
    editorGroupHeaderTabsBg: "#181818",
    editorGroupBorder: "rgba(255,255,255,0.09)",
    panelBg: "#181818",
    panelBorder: "#2B2B2B",
    panelTitleActiveBorder: "#0078D4",
    panelTitleActiveFg: "#CCCCCC",
    panelTitleInactiveFg: "#9D9D9D",
    statusBarBg: "#181818",
    statusBarBorder: "#2B2B2B",
    statusBarFg: "#CCCCCC",
    statusBarHoverBg: "rgba(241,241,241,0.2)",
    titleBarActiveBg: "#181818",
    titleBarActiveFg: "#CCCCCC",
    titleBarInactiveBg: "#1F1F1F",
    titleBarInactiveFg: "#9D9D9D",
    titleBarBorder: "#2B2B2B",
    tabActiveBg: "#1F1F1F",
    tabInactiveBg: "#181818",
    tabActiveFg: "#FFFFFF",
    tabInactiveFg: "#9D9D9D",
    tabBorder: "#2B2B2B",
    tabActiveBorderTop: "#0078D4",
    inputBg: "#313131",
    inputBorder: "#3C3C3C",
    inputFg: "#CCCCCC",
    inputPlaceholder: "#989898",
    dropdownBg: "#313131",
    menuBg: "#1F1F1F",
    menuSelectionBg: "#0078D4",
    quickInputBg: "#222222",
    widgetBorder: "#313131",
    focusBorder: "#0078D4",
    buttonBg: "#0078D4",
    buttonHoverBg: "#026EC1",
    foreground: "#CCCCCC",
    descriptionFg: "#9D9D9D",
    errorFg: "#F85149",
    listHoverBg: "rgba(255,255,255,0.08)",
    listActiveSelectionBg: "#04395E",
    scrollbarSlider: "rgba(121,121,121,0.4)",
    scrollbarSliderHover: "rgba(100,100,100,0.7)",
  },

  // Typography — workbench UI font stack (VS Code)
  fontUi:
    '-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", system-ui, "Ubuntu", "Droid Sans", sans-serif',
  fontMono: '"JetBrains Mono", "Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace',
  fontSizeUi: 13,
  fontSizeStatus: 12,
  fontSizeSideBarTitle: 11,
  lineHeightUi: 1.4,

  // Motion — workbench feels snappy
  motion: {
    fast: "80ms",
    normal: "120ms",
    slow: "180ms",
    panel: "200ms",
    easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
    easingOut: "cubic-bezier(0.16, 1, 0.3, 1)",
  },
} as const;

export type CursorTokens = typeof CURSOR;
