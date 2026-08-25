const READINESS_TTL_MS = 5_000;
const READINESS_TIMEOUT_MS = 2_000;

export interface DependencyReadinessCheck {
  (): Promise<boolean>;
}

/**
 * Bounded, short-TTL cached readiness check against the Orchestrator's own
 * /readyz probe. Never fabricates success: unreachable, slow, or non-2xx
 * responses all resolve to not-ready.
 */
export function createOrchestratorReadinessCheck(
  orchestratorUrl: string,
  fetcher: typeof fetch = fetch,
): DependencyReadinessCheck {
  let cached = false;
  let checkedAt = 0;
  let inFlight: Promise<boolean> | null = null;

  const probe = async (): Promise<boolean> => {
    try {
      const url = new URL("/readyz", orchestratorUrl);
      const response = await fetcher(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(READINESS_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  return async () => {
    const now = Date.now();
    if (now - checkedAt < READINESS_TTL_MS) return cached;
    if (!inFlight) {
      inFlight = probe()
        .then((result) => {
          cached = result;
          checkedAt = Date.now();
          return result;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };
}
