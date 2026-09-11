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

  // DESIGN-lens.md — light workbench map. Values and inferences are documented there.
  colors: {
    activityBarBg: "#f7f7f4",
    activityBarBorder: "#e6e5e0",
    activityBarFg: "#26251e",
    activityBarInactiveFg: "#a09c92",
    activityBarActiveBorder: "#3183d8",
    sideBarBg: "#f7f7f4",
    sideBarBorder: "#e6e5e0",
    sideBarFg: "#5a5852",
    editorBg: "#fdfbfa",
    editorFg: "#26251e",
    editorGroupHeaderTabsBg: "#f7f7f4",
    editorGroupBorder: "#e6e5e0",
    panelBg: "#f7f7f4",
    panelBorder: "#e6e5e0",
    panelTitleActiveBorder: "#3183d8",
    panelTitleActiveFg: "#26251e",
    panelTitleInactiveFg: "#a09c92",
    statusBarBg: "#f7f7f4",
    statusBarBorder: "#e6e5e0",
    statusBarFg: "#5a5852",
    statusBarHoverBg: "#f2f1ed",
    titleBarActiveBg: "#fdfbfa",
    titleBarActiveFg: "#26251e",
    titleBarInactiveBg: "#fdfbfa",
    titleBarInactiveFg: "#a09c92",
    titleBarBorder: "#e6e5e0",
    tabActiveBg: "#fdfbfa",
    tabInactiveBg: "#f7f7f4",
    tabActiveFg: "#26251e",
    tabInactiveFg: "#a09c92",
    tabBorder: "#e6e5e0",
    tabActiveBorderTop: "#3183d8",
    inputBg: "#fdfbfa",
    inputBorder: "#e6e5e0",
    inputFg: "#26251e",
    inputPlaceholder: "#a09c92",
    dropdownBg: "#fdfbfa",
    menuBg: "#fdfbfa",
    menuSelectionBg: "#f2f1ed",
    quickInputBg: "#fdfbfa",
    widgetBorder: "#e6e5e0",
    focusBorder: "#3183d8",
    buttonBg: "#3183d8",
    buttonFg: "#141312",
    buttonHoverBg: "#5a9be0",
    buttonSecondaryBg: "#f2f1ed",
    foreground: "#26251e",
    descriptionFg: "#5a5852",
    errorFg: "#b91c1c",
    listHoverBg: "#f2f1ed",
    listActiveSelectionBg: "#e6e5e0",
    scrollbarSlider: "#a09c92",
    scrollbarSliderHover: "#807d72",
  },

  // Typography — workbench UI font stack (VS Code)
  fontFamily:
    'Inter, ui-sans-serif, system-ui, "Helvetica Neue", Helvetica, Arial, sans-serif',
  fontSize: 13,
  fontWeight: 400,
  lineHeight: 1.4,
} as const;
