/**
 * DESIGN-cursor.md responsive breakpoints (Prompt 9).
 * Map only to real app equivalents — do not invent marketing hero/mockup behavior.
 */
export const BREAKPOINTS = {
  /** Mobile: < 640 — single primary pane / 1-up grids */
  mobile: 640,
  /** Nav hamburger-equivalent collapse (DESIGN: below 768) */
  navCollapse: 768,
  /** Desktop floor: full multi-pane docked tools (DESIGN: 1024+) */
  desktop: 1024,
  /** Wide: content cap applies above this */
  wide: 1280,
  /** Wide content max width */
  contentMax: 1200,
} as const;

/** Primary CTA min height (DESIGN touch target) */
export const TOUCH_PRIMARY_PX = 40;
/** Download / most-prominent CTA min height */
export const TOUCH_PROMINENT_PX = 44;
