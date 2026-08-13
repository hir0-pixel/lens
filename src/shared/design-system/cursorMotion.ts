/**
 * Lens motion language — mirrors CSS --duration-* / --ease-* tokens.
 */
export const CURSOR_MOTION = {
  duration: {
    instant: 100,
    fast: 150,
    hover: 100,
    normal: 150,
    slow: 220,
    panel: 320,
    dialog: 220,
    sidebar: 320,
    tooltip: 150,
    contextMenu: 150,
  },
  easing: {
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    decelerate: "cubic-bezier(0, 0, 0, 1)",
    accelerate: "cubic-bezier(0.3, 0, 1, 1)",
    soft: "cubic-bezier(0.2, 0, 0, 1)",
    spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  },
  listRowHeight: 22,
  quickInputRowHeight: 22,
  treeIndent: 12,
  treeTwistie: 16,
} as const;

export type CursorMotion = typeof CURSOR_MOTION;
