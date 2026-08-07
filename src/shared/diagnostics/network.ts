import { logger } from "./logger";

export type NetworkStatus = "online" | "offline";

type Listener = (status: NetworkStatus) => void;

const listeners = new Set<Listener>();
let status: NetworkStatus =
  typeof navigator !== "undefined" && navigator.onLine ? "online" : "online";

function setStatus(next: NetworkStatus) {
  if (next === status) return;
  status = next;
  logger.info(`network.${next}`);
  listeners.forEach((fn) => fn(next));
}

/** Initialize browser online/offline listeners once. */
export function initNetworkMonitor() {
  if (typeof window === "undefined") return;
  setStatus(navigator.onLine ? "online" : "offline");
  window.addEventListener("online", () => setStatus("online"));
  window.addEventListener("offline", () => setStatus("offline"));
}

export function getNetworkStatus(): NetworkStatus {
  return status;
}

export function subscribeNetwork(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Fetch with timeout + basic retry for provider connection tests.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number; retries?: number } = {},
): Promise<Response> {
  const { timeoutMs = 10_000, retries = 0, ...rest } = init;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(input, { ...rest, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      logger.warn("fetch.failed", {
        attempt,
        reason: err instanceof Error ? err.message : String(err),
      });
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Network request failed");
}
