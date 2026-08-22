export interface PolicyAuditEvent {
  requestId: string;
  subjectDigest: string;
  queryDigest: string;
  corpusRef: string;
  generation: string;
  sourceDigests: string[];
  modelId: string;
}

export interface PolicyAudit {
  admit(event: PolicyAuditEvent, signal?: AbortSignal): Promise<{ receipt: string }>;
}

export function createLocalPolicyAudit(): PolicyAudit {
  return { async admit(event) { return { receipt: `local:${event.requestId}` }; } };
}

export function createGovernedPolicyAudit(options: {
  endpoint: string;
  bearerToken: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}): PolicyAudit {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = Math.max(100, options.timeoutMs ?? 1_000);
  return {
    async admit(event, signal) {
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
          body: JSON.stringify({ eventType: "policy.context.disclosure", ...event }),
        });
        if (!response.ok) throw new Error("Audit admission rejected");
        const body = await response.json().catch(() => null) as { receipt?: unknown } | null;
        if (typeof body?.receipt !== "string" || !body.receipt) throw new Error("Audit receipt missing");
        return { receipt: body.receipt };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", relay);
      }
    },
  };
}
