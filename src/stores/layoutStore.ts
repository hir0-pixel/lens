import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Left workspace navigator views */
export type NavView =
  | "agents"
  | "search"
  | "automations"
  | "knowledge"
  | "projects"
  | "workspaces"
  | "history"
  | "memory"
  | "prompts"
  | "templates"
  | "settings"
  | "repositories";

/** @deprecated Use NavView — kept for command/event migration */
export type ActivityView =
  | "explorer"
  | "search"
  | "git"
  | "debug"
  | "extensions";

export type BottomPanelTab =
  | "terminal"
  | "problems"
  | "output"
  | "logs"
  | "debug"
  | "ports";

export type ToolsTabKind =
  | "editor"
  | "browser"
  | "terminal"
  | "git"
  | "logs"
  | "tasks"
  | "preview"
  | "memory"
  | "database";

const DEFAULT_BOTTOM_H = 240;
const DEFAULT_TOOLS_W = 420;
const DEFAULT_NAV_W = 260;
const TOOLS_RAIL_W = 40;

function activityToNav(view: ActivityView): NavView {
  switch (view) {
    case "explorer":
      return "projects";
    case "search":
      return "search";
    case "git":
      return "repositories";
    case "extensions":
      return "automations";
    case "debug":
      return "history";
    default:
      return "agents";
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

interface LayoutState {
  navView: NavView;
  navOpen: boolean;
  toolsOpen: boolean;
  toolsCollapsed: boolean;
  bottomPanelOpen: boolean;
  bottomPanelSlim: boolean;
  bottomPanelTab: BottomPanelTab;
  bottomPanelMaximized: boolean;
  activeToolsTab: ToolsTabKind;

  navWidthPx: number;
  toolsWidthPx: number;
  toolsWidthBeforeCollapse: number;
  bottomPanelHeightPx: number;
  bottomPanelHeightBeforeToggle: number;

  navSize: number;
  toolsSize: number;
  bottomPanelSize: number;
  bottomPanelSizeBeforeMaximize: number | null;

  setNavView: (view: NavView) => void;
  toggleNav: () => void;
  toggleTools: () => void;
  toggleToolsCollapsed: () => void;
  setToolsCollapsed: (collapsed: boolean) => void;
  openTools: (tab?: ToolsTabKind) => void;
  closeTools: () => void;
  setActiveToolsTab: (tab: ToolsTabKind) => void;
  /** Open navigator (explorer) — Ctrl+Shift+E */
  openExplorer: () => void;
  closeNav: () => void;

  toggleBottomPanel: () => void;
  hideBottomPanel: () => void;
  closeBottomPanel: () => void;
  openBottomPanel: (tab?: BottomPanelTab) => void;
  setBottomPanelSlim: (slim: boolean) => void;
  toggleBottomPanelSlim: () => void;
  setBottomPanelTab: (tab: BottomPanelTab) => void;
  toggleBottomPanelMaximized: () => void;
  toggleBottomPanelDefaultHeight: () => void;

  setNavWidthPx: (px: number) => void;
  setToolsWidthPx: (px: number) => void;
  setBottomPanelHeightPx: (px: number) => void;

  setNavSize: (size: number | { asPercentage: number }) => void;
  setToolsSize: (size: number | { asPercentage: number }) => void;
  setBottomPanelSize: (size: number | { asPercentage: number }) => void;

  /** @deprecated aliases */
  activityView: NavView;
  primarySidebarOpen: boolean;
  aiPanelOpen: boolean;
  aiPanelCollapsed: boolean;
  sidebarWidthPx: number;
  aiPanelWidthPx: number;
  setActivityView: (view: ActivityView | NavView) => void;
  togglePrimarySidebar: () => void;
  toggleAiPanel: () => void;
  toggleAiPanelCollapsed: () => void;
  setAiPanelCollapsed: (collapsed: boolean) => void;
  setSidebarWidthPx: (px: number) => void;
  setAiPanelWidthPx: (px: number) => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      navView: "agents",
      navOpen: false,
      toolsOpen: false,
      toolsCollapsed: false,
      bottomPanelOpen: false,
      bottomPanelSlim: true,
      bottomPanelTab: "terminal",
      bottomPanelMaximized: false,
      activeToolsTab: "editor",

      navWidthPx: DEFAULT_NAV_W,
      toolsWidthPx: DEFAULT_TOOLS_W,
      toolsWidthBeforeCollapse: DEFAULT_TOOLS_W,
      bottomPanelHeightPx: DEFAULT_BOTTOM_H,
      bottomPanelHeightBeforeToggle: DEFAULT_BOTTOM_H,

      navSize: 22,
      toolsSize: 32,
      bottomPanelSize: 30,
      bottomPanelSizeBeforeMaximize: null,

      // Compat mirrors
      activityView: "agents",
      primarySidebarOpen: false,
      aiPanelOpen: false,
      aiPanelCollapsed: false,
      sidebarWidthPx: DEFAULT_NAV_W,
      aiPanelWidthPx: DEFAULT_TOOLS_W,

      setNavView: (view) =>
        set((state) => {
          const navOpen = state.navView === view ? !state.navOpen : true;
          return {
            navView: view,
            navOpen,
            activityView: view,
            primarySidebarOpen: navOpen,
          };
        }),
      toggleNav: () =>
        set((state) => ({
          navOpen: !state.navOpen,
          primarySidebarOpen: !state.navOpen,
        })),
      toggleTools: () =>
        set((state) => ({
          toolsOpen: !state.toolsOpen,
          toolsCollapsed: false,
          aiPanelOpen: !state.toolsOpen,
          aiPanelCollapsed: false,
        })),
      toggleToolsCollapsed: () => {
        const s = get();
        if (!s.toolsOpen) {
          set({
            toolsOpen: true,
            toolsCollapsed: false,
            toolsWidthPx: s.toolsWidthBeforeCollapse || DEFAULT_TOOLS_W,
            aiPanelOpen: true,
            aiPanelCollapsed: false,
            aiPanelWidthPx: s.toolsWidthBeforeCollapse || DEFAULT_TOOLS_W,
          });
          return;
        }
        if (s.toolsCollapsed) {
          const w = s.toolsWidthBeforeCollapse || DEFAULT_TOOLS_W;
          set({
            toolsCollapsed: false,
            toolsWidthPx: w,
            aiPanelCollapsed: false,
            aiPanelWidthPx: w,
          });
        } else {
          set({
            toolsCollapsed: true,
            toolsWidthBeforeCollapse: s.toolsWidthPx,
            toolsWidthPx: TOOLS_RAIL_W,
            aiPanelCollapsed: true,
            aiPanelWidthPx: TOOLS_RAIL_W,
          });
        }
      },
      setToolsCollapsed: (collapsed) => {
        const s = get();
        if (collapsed) {
          const before = Math.max(s.toolsWidthPx, TOOLS_RAIL_W + 1);
          set({
            toolsCollapsed: true,
            toolsOpen: true,
            toolsWidthBeforeCollapse: before,
            toolsWidthPx: TOOLS_RAIL_W,
            aiPanelCollapsed: true,
            aiPanelOpen: true,
            aiPanelWidthPx: TOOLS_RAIL_W,
          });
        } else {
          const w = s.toolsWidthBeforeCollapse || DEFAULT_TOOLS_W;
          set({
            toolsCollapsed: false,
            toolsWidthPx: w,
            aiPanelCollapsed: false,
            aiPanelWidthPx: w,
          });
        }
      },
      openTools: (tab) => {
        const w = get().toolsWidthBeforeCollapse || DEFAULT_TOOLS_W;
        set({
          toolsOpen: true,
          toolsCollapsed: false,
          toolsWidthPx: w,
          aiPanelOpen: true,
          aiPanelCollapsed: false,
          aiPanelWidthPx: w,
          ...(tab ? { activeToolsTab: tab } : {}),
        });
      },
      closeTools: () =>
        set({
          toolsOpen: false,
          toolsCollapsed: false,
          aiPanelOpen: false,
          aiPanelCollapsed: false,
        }),
      setActiveToolsTab: (tab) => set({ activeToolsTab: tab }),
      openExplorer: () =>
        set({
          navOpen: true,
          navView: "projects",
          activityView: "projects",
          primarySidebarOpen: true,
        }),
      closeNav: () =>
        set({
          navOpen: false,
          primarySidebarOpen: false,
        }),

      toggleBottomPanel: () =>
        set((state) => ({
          bottomPanelOpen: !state.bottomPanelOpen,
          bottomPanelMaximized: state.bottomPanelOpen
            ? false
            : state.bottomPanelMaximized,
        })),
      hideBottomPanel: () => set({ bottomPanelOpen: false }),
      closeBottomPanel: () =>
        set((state) => ({
          bottomPanelOpen: false,
          bottomPanelMaximized: false,
          bottomPanelHeightPx:
            state.bottomPanelHeightBeforeToggle || state.bottomPanelHeightPx,
        })),
      openBottomPanel: (tab) =>
        set({
          bottomPanelOpen: true,
          bottomPanelSlim: false,
          ...(tab ? { bottomPanelTab: tab } : {}),
        }),
      setBottomPanelSlim: (slim) => set({ bottomPanelSlim: slim }),
      toggleBottomPanelSlim: () =>
        set((s) => ({
          bottomPanelOpen: true,
          bottomPanelSlim: !s.bottomPanelSlim,
        })),
      setBottomPanelTab: (tab) => set({ bottomPanelTab: tab }),
      toggleBottomPanelMaximized: () => {
        const state = get();
        if (state.bottomPanelMaximized) {
          set({
            bottomPanelMaximized: false,
            bottomPanelHeightPx:
              state.bottomPanelHeightBeforeToggle || DEFAULT_BOTTOM_H,
          });
        } else {
          const maxH = Math.round(window.innerHeight * 0.7);
          set({
            bottomPanelMaximized: true,
            bottomPanelHeightBeforeToggle: state.bottomPanelHeightPx,
            bottomPanelHeightPx: maxH,
          });
        }
      },
      toggleBottomPanelDefaultHeight: () => {
        const state = get();
        if (Math.abs(state.bottomPanelHeightPx - DEFAULT_BOTTOM_H) < 8) {
          set({
            bottomPanelHeightPx:
              state.bottomPanelHeightBeforeToggle || DEFAULT_BOTTOM_H * 1.5,
            bottomPanelMaximized: false,
          });
        } else {
          set({
            bottomPanelHeightBeforeToggle: state.bottomPanelHeightPx,
            bottomPanelHeightPx: DEFAULT_BOTTOM_H,
            bottomPanelMaximized: false,
          });
        }
      },

      setNavWidthPx: (px) => {
        const next = clamp(px, 180, 480);
        set({ navWidthPx: next, sidebarWidthPx: next });
      },
      setToolsWidthPx: (px) => {
        const max = Math.min(720, Math.round(window.innerWidth * 0.55));
        const next = clamp(px, 280, max);
        set({
          toolsWidthPx: next,
          toolsCollapsed: false,
          toolsWidthBeforeCollapse: next,
          aiPanelWidthPx: next,
          aiPanelCollapsed: false,
        });
      },
      setBottomPanelHeightPx: (px) => {
        const max = Math.round(window.innerHeight * 0.7);
        set({
          bottomPanelHeightPx: clamp(px, 120, max),
          bottomPanelMaximized: false,
        });
      },

      setNavSize: (size) => {
        const pct = typeof size === "number" ? size : size.asPercentage;
        const px = clamp(
          Math.round((pct / 100) * window.innerWidth),
          180,
          480,
        );
        set({ navSize: pct, navWidthPx: px, sidebarWidthPx: px });
      },
      setToolsSize: (size) => {
        const pct = typeof size === "number" ? size : size.asPercentage;
        const px = clamp(
          Math.round((pct / 100) * window.innerWidth),
          280,
          Math.min(720, Math.round(window.innerWidth * 0.55)),
        );
        set({
          toolsSize: pct,
          toolsWidthPx: px,
          toolsWidthBeforeCollapse: px,
          toolsCollapsed: false,
          aiPanelWidthPx: px,
          aiPanelCollapsed: false,
        });
      },
      setBottomPanelSize: (size) => {
        const pct = typeof size === "number" ? size : size.asPercentage;
        const px = clamp(
          Math.round((pct / 100) * window.innerHeight),
          120,
          Math.round(window.innerHeight * 0.7),
        );
        set({ bottomPanelSize: pct, bottomPanelHeightPx: px });
      },

      setActivityView: (view) => {
        const nav =
          view === "explorer" ||
          view === "git" ||
          view === "debug" ||
          view === "extensions"
            ? activityToNav(view as ActivityView)
            : (view as NavView);
        get().setNavView(nav);
      },
      togglePrimarySidebar: () => get().toggleNav(),
      toggleAiPanel: () => get().toggleTools(),
      toggleAiPanelCollapsed: () => get().toggleToolsCollapsed(),
      setAiPanelCollapsed: (c) => get().setToolsCollapsed(c),
      setSidebarWidthPx: (px) => get().setNavWidthPx(px),
      setAiPanelWidthPx: (px) => get().setToolsWidthPx(px),
    }),
    {
      name: "orchids-layout",
      version: 6,
      partialize: (state) => ({
        navView: state.navView,
        navOpen: state.navOpen,
        toolsOpen: state.toolsOpen,
        toolsCollapsed: state.toolsCollapsed,
        bottomPanelOpen: state.bottomPanelOpen,
        bottomPanelSlim: state.bottomPanelSlim,
        bottomPanelTab: state.bottomPanelTab,
        bottomPanelMaximized: state.bottomPanelMaximized,
        activeToolsTab: state.activeToolsTab,
        navWidthPx: state.navWidthPx,
        toolsWidthPx: state.toolsWidthPx,
        toolsWidthBeforeCollapse: state.toolsWidthBeforeCollapse,
        bottomPanelHeightPx: state.bottomPanelHeightPx,
        bottomPanelHeightBeforeToggle: state.bottomPanelHeightBeforeToggle,
        navSize: state.navSize,
        toolsSize: state.toolsSize,
        bottomPanelSize: state.bottomPanelSize,
      }),
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>;

        if (version < 3) {
          if (typeof state.sidebarWidthPx !== "number") {
            state.sidebarWidthPx = DEFAULT_NAV_W;
          }
          if (typeof state.aiPanelWidthPx !== "number") {
            state.aiPanelWidthPx = DEFAULT_TOOLS_W;
          }
          if (typeof state.bottomPanelHeightPx !== "number") {
            const pct =
              typeof state.bottomPanelSize === "number"
                ? state.bottomPanelSize
                : 30;
            state.bottomPanelHeightPx = Math.round(
              (pct / 100) *
                (typeof window !== "undefined" ? window.innerHeight : 800),
            );
          }
        }
        if (version < 4) {
          if (typeof state.bottomPanelSlim !== "boolean") {
            state.bottomPanelSlim = true;
          }
          if (state.bottomPanelOpen === false) {
            state.bottomPanelOpen = true;
            state.bottomPanelSlim = true;
          }
        }
        if (version < 5) {
          if (typeof state.navWidthPx !== "number") {
            state.navWidthPx =
              (state.sidebarWidthPx as number) || DEFAULT_NAV_W;
          }
          if (typeof state.toolsWidthPx !== "number") {
            state.toolsWidthPx =
              (state.aiPanelWidthPx as number) || DEFAULT_TOOLS_W;
          }
          if (typeof state.toolsWidthBeforeCollapse !== "number") {
            state.toolsWidthBeforeCollapse =
              (state.aiPanelWidthBeforeCollapse as number) ||
              (state.toolsWidthPx as number) ||
              DEFAULT_TOOLS_W;
          }
          if (typeof state.navOpen !== "boolean") {
            state.navOpen =
              typeof state.primarySidebarOpen === "boolean"
                ? (state.primarySidebarOpen as boolean)
                : true;
          }
          if (typeof state.toolsOpen !== "boolean") {
            state.toolsOpen =
              typeof state.aiPanelOpen === "boolean"
                ? (state.aiPanelOpen as boolean)
                : true;
          }
          if (typeof state.toolsCollapsed !== "boolean") {
            state.toolsCollapsed =
              typeof state.aiPanelCollapsed === "boolean"
                ? (state.aiPanelCollapsed as boolean)
                : false;
          }
          if (!state.navView) {
            const legacy = state.activityView as ActivityView | undefined;
            state.navView = legacy ? activityToNav(legacy) : "agents";
          }
          if (!state.activeToolsTab) {
            state.activeToolsTab = "editor";
          }
          if (typeof state.navSize !== "number") {
            state.navSize = (state.sidebarSize as number) || 22;
          }
          if (typeof state.toolsSize !== "number") {
            state.toolsSize = (state.aiPanelSize as number) || 32;
          }
        }
        if (version < 6) {
          // Minimal chrome default: agent-only
          state.navOpen = false;
          state.toolsOpen = false;
          state.toolsCollapsed = false;
          state.bottomPanelOpen = false;
          state.primarySidebarOpen = false;
          state.aiPanelOpen = false;
        }
        return persisted as unknown as LayoutState;
      },
    },
  ),
);

export const LAYOUT_DEFAULTS = {
  DEFAULT_BOTTOM_H,
  DEFAULT_TOOLS_W,
  DEFAULT_NAV_W,
  TOOLS_RAIL_W,
  DEFAULT_AI_W: DEFAULT_TOOLS_W,
  DEFAULT_SIDEBAR_W: DEFAULT_NAV_W,
  AI_RAIL_W: TOOLS_RAIL_W,
};
