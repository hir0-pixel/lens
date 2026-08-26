/**
 * Workbench layout constants + DESIGN-vercel.md color mirrors.
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

  // DESIGN-vercel.md colors only
  colors: {
    activityBarBg: "#ffffff",
    activityBarBorder: "#ebebeb",
    activityBarFg: "#171717",
    activityBarInactiveFg: "#8f8f8f",
    activityBarActiveBorder: "#0070f3",
    sideBarBg: "#ffffff",
    sideBarBorder: "#ebebeb",
    sideBarFg: "#4d4d4d",
    editorBg: "#fafafa",
    editorFg: "#171717",
    editorGroupHeaderTabsBg: "#ffffff",
    editorGroupBorder: "#ebebeb",
    panelBg: "#ffffff",
    panelBorder: "#ebebeb",
    panelTitleActiveBorder: "#0070f3",
    panelTitleActiveFg: "#171717",
    panelTitleInactiveFg: "#8f8f8f",
    statusBarBg: "#ffffff",
    statusBarBorder: "#ebebeb",
    statusBarFg: "#4d4d4d",
    statusBarHoverBg: "#f2f2f2",
    titleBarActiveBg: "#fafafa",
    titleBarActiveFg: "#171717",
    titleBarInactiveBg: "#fafafa",
    titleBarInactiveFg: "#8f8f8f",
    titleBarBorder: "#ebebeb",
    tabActiveBg: "#fafafa",
    tabInactiveBg: "#ffffff",
    tabActiveFg: "#171717",
    tabInactiveFg: "#8f8f8f",
    tabBorder: "#ebebeb",
    tabActiveBorderTop: "#0070f3",
    inputBg: "#ffffff",
    inputBorder: "#ebebeb",
    inputFg: "#171717",
    inputPlaceholder: "#a1a1a1",
    dropdownBg: "#ffffff",
    menuBg: "#ffffff",
    menuSelectionBg: "#f2f2f2",
    quickInputBg: "#ffffff",
    widgetBorder: "#ebebeb",
    focusBorder: "#0070f3",
    buttonBg: "#171717",
    buttonHoverBg: "#0a0a0a",
    foreground: "#171717",
    descriptionFg: "#4d4d4d",
    errorFg: "#ee0000",
    listHoverBg: "#f2f2f2",
    listActiveSelectionBg: "#ebebeb",
    scrollbarSlider: "#a1a1a1",
    scrollbarSliderHover: "#8f8f8f",
  },

  // Typography — workbench UI font stack (VS Code)
  fontFamily:
    'Inter, ui-sans-serif, system-ui, "Helvetica Neue", Helvetica, Arial, sans-serif',
  fontSize: 13,
  fontWeight: 400,
  lineHeight: 1.4,
} as const;
