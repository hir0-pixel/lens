/**
 * Cursor-inspired workbench tokens.
 * Colors mirror DESIGN-cursor.md; layout constants remain local workbench values.
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

  // Cursor design colors
  colors: {
    activityBarBg: "#ffffff",
    activityBarBorder: "#f5f5f5",
    activityBarFg: "#171717",
    activityBarInactiveFg: "#888888",
    activityBarActiveBorder: "#0070f3",
    sideBarBg: "#ffffff",
    sideBarBorder: "#f5f5f5",
    sideBarFg: "#4d4d4d",
    editorBg: "#fafafa",
    editorFg: "#171717",
    editorGroupHeaderTabsBg: "#ffffff",
    editorGroupBorder: "#ebebeb",
    panelBg: "#ffffff",
    panelBorder: "#ebebeb",
    panelTitleActiveBorder: "#0070f3",
    panelTitleActiveFg: "#171717",
    panelTitleInactiveFg: "#888888",
    statusBarBg: "#ffffff",
    statusBarBorder: "#f5f5f5",
    statusBarFg: "#4d4d4d",
    statusBarHoverBg: "#ebebeb",
    titleBarActiveBg: "#ffffff",
    titleBarActiveFg: "#171717",
    titleBarInactiveBg: "#fafafa",
    titleBarInactiveFg: "#888888",
    titleBarBorder: "#f5f5f5",
    tabActiveBg: "#fafafa",
    tabInactiveBg: "#ffffff",
    tabActiveFg: "#171717",
    tabInactiveFg: "#888888",
    tabBorder: "#ebebeb",
    tabActiveBorderTop: "#0070f3",
    inputBg: "#ffffff",
    inputBorder: "#ebebeb",
    inputFg: "#171717",
    inputPlaceholder: "#888888",
    dropdownBg: "#ffffff",
    menuBg: "#ffffff",
    menuSelectionBg: "#ebebeb",
    quickInputBg: "#ffffff",
    widgetBorder: "#ebebeb",
    focusBorder: "#0070f3",
    buttonBg: "#0070f3",
    buttonHoverBg: "#0761d1",
    foreground: "#171717",
    descriptionFg: "#4d4d4d",
    errorFg: "#ee0000",
    listHoverBg: "#ebebeb",
    listActiveSelectionBg: "#ebebeb",
    scrollbarSlider: "#a1a1a1",
    scrollbarSliderHover: "#a1a1a1",
  },

  // Typography — workbench UI font stack (VS Code)
  fontUi: '"Inter", ui-sans-serif, system-ui, "Helvetica Neue", Helvetica, Arial, sans-serif',
  fontMono: '"JetBrains Mono", "Fira Code", monospace',
  fontSizeUi: 13,
  fontSizeStatus: 13,
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
