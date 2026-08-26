/**
 * Lens motion language — mirrors CSS --duration-* / --ease-* tokens.
 */
export const CURSOR_MOTION = {
  duration: {
    instant: 80,
    fast: 120,
    hover: 80,
    normal: 120,
    slow: 180,
    panel: 200,
    dialog: 180,
    sidebar: 200,
    tooltip: 120,
    contextMenu: 180,
  },
  easing: {
    standard: "cubic-bezier(0.25, 0.1, 0.25, 1)",
    enter: "cubic-bezier(0.16, 1, 0.3, 1)",
    dismiss: "cubic-bezier(0.16, 1, 0.3, 1)",
    linear: "linear",
  },
  listRowHeight: 22,
  quickInputRowHeight: 22,
  treeIndent: 12,
  treeTwistie: 16,
} as const;

export type CursorMotion = typeof CURSOR_MOTION;
