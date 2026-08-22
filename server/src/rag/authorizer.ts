export interface PolicyAuthorizer {
  authorize(subject: string, corpusRef: string, signal?: AbortSignal, resourceRefs?: readonly string[]): Promise<boolean>;
}

/**
 * Explicitly local-only authorization. It is intentionally not presented as
 * a production policy authority; production configuration rejects this mode.
 */
export function createLocalPolicyAuthorizer(): PolicyAuthorizer {
  return {
    async authorize(subject: string, corpusRoot: string): Promise<boolean> {
      return Boolean(subject && corpusRoot);
    },
  };
}

export function createDenyPolicyAuthorizer(): PolicyAuthorizer {
  return { async authorize(): Promise<boolean> { return false; } };
}

export interface GovernedPolicyAuthorizerOptions {
  endpoint: string;
  bearerToken: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

/** Calls the authoritative policy service for every disclosure boundary. */
export function createGovernedPolicyAuthorizer(options: GovernedPolicyAuthorizerOptions): PolicyAuthorizer {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = Math.max(100, options.timeoutMs ?? 1_000);
  return {
    async authorize(subject, corpusRef, signal, resourceRefs): Promise<boolean> {
      const controller = new AbortController();
      const relay = () => controller.abort();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener("abort", relay, { once: true });
      }
      try {
        const response = await fetcher(options.endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${options.bearerToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ action: resourceRefs?.length ? "policy.context.use" : "policy.retrieve", subject, corpusRef, resourceRefs: resourceRefs ?? [] }),
        });
        if (!response.ok) return false;
        const body = await response.json().catch(() => null) as { allowed?: unknown } | null;
        return body?.allowed === true;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", relay);
      }
    },
  };
}
