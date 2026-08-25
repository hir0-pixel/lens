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
    activityBarBg: "#fafaf7",
    activityBarBorder: "#efeee8",
    activityBarFg: "#26251e",
    activityBarInactiveFg: "#807d72",
    activityBarActiveBorder: "#f54e00",
    sideBarBg: "#fafaf7",
    sideBarBorder: "#efeee8",
    sideBarFg: "#5a5852",
    editorBg: "#f7f7f4",
    editorFg: "#26251e",
    editorGroupHeaderTabsBg: "#fafaf7",
    editorGroupBorder: "#e6e5e0",
    panelBg: "#fafaf7",
    panelBorder: "#e6e5e0",
    panelTitleActiveBorder: "#f54e00",
    panelTitleActiveFg: "#26251e",
    panelTitleInactiveFg: "#807d72",
    statusBarBg: "#fafaf7",
    statusBarBorder: "#efeee8",
    statusBarFg: "#5a5852",
    statusBarHoverBg: "#e6e5e0",
    titleBarActiveBg: "#fafaf7",
    titleBarActiveFg: "#26251e",
    titleBarInactiveBg: "#f7f7f4",
    titleBarInactiveFg: "#807d72",
    titleBarBorder: "#efeee8",
    tabActiveBg: "#f7f7f4",
    tabInactiveBg: "#fafaf7",
    tabActiveFg: "#26251e",
    tabInactiveFg: "#807d72",
    tabBorder: "#e6e5e0",
    tabActiveBorderTop: "#f54e00",
    inputBg: "#ffffff",
    inputBorder: "#e6e5e0",
    inputFg: "#26251e",
    inputPlaceholder: "#807d72",
    dropdownBg: "#ffffff",
    menuBg: "#ffffff",
    menuSelectionBg: "#e6e5e0",
    quickInputBg: "#ffffff",
    widgetBorder: "#e6e5e0",
    focusBorder: "#f54e00",
    buttonBg: "#f54e00",
    buttonHoverBg: "#d04200",
    foreground: "#26251e",
    descriptionFg: "#5a5852",
    errorFg: "#cf2d56",
    listHoverBg: "#e6e5e0",
    listActiveSelectionBg: "#e6e5e0",
    scrollbarSlider: "#cfcdc4",
    scrollbarSliderHover: "#a09c92",
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
