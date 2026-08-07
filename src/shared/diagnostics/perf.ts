import { logger } from "./logger";

export interface PerfMark {
  name: string;
  startedAt: number;
  durationMs?: number;
}

const marks = new Map<string, number>();
const history: PerfMark[] = [];
const MAX = 100;

/**
 * Lightweight performance marks for startup and critical paths.
 */
export const perf = {
  mark(name: string) {
    marks.set(name, performance.now());
  },

  measure(name: string, startName?: string): number {
    const start = marks.get(startName ?? name) ?? performance.now();
    const durationMs = performance.now() - start;
    history.push({ name, startedAt: start, durationMs });
    if (history.length > MAX) history.shift();
    logger.debug(`perf:${name}`, { durationMs: Math.round(durationMs * 100) / 100 });
    return durationMs;
  },

  getHistory(): readonly PerfMark[] {
    return history;
  },

  /** Report navigation timing when available */
  reportStartup() {
    try {
      const nav = performance.getEntriesByType(
        "navigation",
      )[0] as PerformanceNavigationTiming | undefined;
      if (nav) {
        logger.info("startup.timing", {
          domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
          loadEvent: Math.round(nav.loadEventEnd),
          transferSize: nav.transferSize,
        });
      }
    } catch {
      // ignore
    }
  },
};
