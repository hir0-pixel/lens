export const USAGE_SCHEMA_VERSION = 1;
export const MAX_MEASURED_UNITS = 1_000_000;

/**
 * Adapter-owned metering: Unicode word-like segments, not runtime-reported tokens
 * and not a bytes/4 heuristic. Unknown/unbounded measurement throws so settlement
 * stays conservative at the caller.
 */
export function measureOutputUnits(text: string): number {
  const units = text.trim() === "" ? 0 : text.trim().split(/\s+/u).length;
  if (!Number.isSafeInteger(units) || units < 0 || units > MAX_MEASURED_UNITS) {
    throw new Error("USAGE_UNBOUNDED");
  }
  return units;
}
