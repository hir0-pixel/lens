import type { RuntimePort, SchedulerPort } from "../../services/model-gateway/ModelGateway";

type FetchPort = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const MAX_RESPONSE_BYTES = 256 * 1024;

function internalOrigin(value: string): URL {
  const endpoint = new URL(value);
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") {
    throw new Error("MODEL_RUNTIME_URL must be a plain internal origin.");
  }
  if (endpoint.protocol === "https:" && isInternalHost(endpoint.hostname)) return endpoint;
  if (endpoint.protocol === "http:" && loopbackHosts.has(endpoint.hostname)) return endpoint;
  throw new Error("MODEL_RUNTIME_URL must use HTTPS or loopback HTTP.");
}

function isInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".internal")) return true;
  const parts = host.split(".").map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
  }
  return host.startsWith("fc") || host.startsWith("fd");
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new Error("DEPENDENCY_UNAVAILABLE");
  if (!response.body) throw new Error("DEPENDENCY_UNAVAILABLE");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("DEPENDENCY_UNAVAILABLE");
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("DEPENDENCY_UNAVAILABLE");
  }
}

function requestSignal(parent: AbortSignal | undefined, deadlineAt: number): AbortSignal {
  const timeout = AbortSignal.timeout(Math.max(1, deadlineAt - Date.now()));
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

/**
 * Client for the company-hosted inference control plane. The remote service
 * owns global admission and GPU scaling; this client never retries generation.
 */
export class InternalInferenceClient implements SchedulerPort, RuntimePort {
  private readonly origin: URL;

  constructor(
    serviceUrl: string,
    private readonly workloadToken: string,
    private readonly fetcher: FetchPort = fetch,
  ) {
    this.origin = internalOrigin(serviceUrl);
    if (workloadToken.length < 32) throw new Error("MODEL_RUNTIME_WORKLOAD_TOKEN must contain at least 32 characters.");
  }

  async reserve(input: { reservationId: string; requestDigest: string; endpointRef: string; expiresAt: number }): Promise<{ reservationId: string; requestDigest: string; endpointRef: string; fence: number; expiresAt: number }> {
    const payload = await this.post("/v1/scheduler/reservations", {
      reservation_id: input.reservationId,
      request_digest: input.requestDigest,
      endpoint_ref: input.endpointRef,
      expires_at: input.expiresAt,
    }, requestSignal(undefined, input.expiresAt));
    const record = payload as Record<string, unknown>;
    if (
      record.reservation_id !== input.reservationId ||
      record.request_digest !== input.requestDigest ||
      record.endpoint_ref !== input.endpointRef ||
      typeof record.fence !== "number" ||
      !Number.isSafeInteger(record.fence) ||
      record.fence < 1 ||
      typeof record.expires_at !== "number" ||
      !Number.isSafeInteger(record.expires_at) ||
      record.expires_at > input.expiresAt
    ) {
      throw new Error("DEPENDENCY_UNAVAILABLE");
    }
    return {
      reservationId: input.reservationId,
      requestDigest: input.requestDigest,
      endpointRef: input.endpointRef,
      fence: record.fence,
      expiresAt: record.expires_at,
    };
  }

  async start(reservationId: string, requestDigest: string, fence: number): Promise<void> {
    await this.post("/v1/scheduler/reservations/start", {
      reservation_id: reservationId,
      request_digest: requestDigest,
      fence,
    }, AbortSignal.timeout(10_000));
  }

  async release(reservationId: string, fence: number): Promise<void> {
    await this.post("/v1/scheduler/reservations/release", {
      reservation_id: reservationId,
      fence,
    }, AbortSignal.timeout(5_000));
  }

  async execute(input: { reservationId: string; fence: number; endpointRef: string; scopeId: string; deadlineAt: number; chunks: readonly string[] }, signal: AbortSignal): Promise<{ output: string; receipt: { usageEventId: string; generatedTokens: number; terminal: "completed" | "cancelled" } }> {
    const payload = await this.post("/v1/inference/generate", {
      reservation_id: input.reservationId,
      fence: input.fence,
      endpoint_ref: input.endpointRef,
      scope_id: input.scopeId,
      deadline_at: input.deadlineAt,
      chunks: input.chunks,
    }, requestSignal(signal, input.deadlineAt));
    const record = payload as Record<string, unknown>;
    const receipt = record.receipt as Record<string, unknown> | undefined;
    if (
      typeof record.output !== "string" ||
      Buffer.byteLength(record.output, "utf8") > 64 * 1024 ||
      !receipt ||
      receipt.reservation_id !== input.reservationId ||
      receipt.fence !== input.fence ||
      receipt.scope_id !== input.scopeId ||
      typeof receipt.usage_event_id !== "string" ||
      receipt.usage_event_id.length > 256 ||
      typeof receipt.generated_tokens !== "number" ||
      !Number.isSafeInteger(receipt.generated_tokens) ||
      receipt.generated_tokens < 0 ||
      (receipt.terminal !== "completed" && receipt.terminal !== "cancelled")
    ) {
      throw new Error("DEPENDENCY_UNAVAILABLE");
    }
    return {
      output: record.output,
      receipt: {
        usageEventId: receipt.usage_event_id,
        generatedTokens: receipt.generated_tokens,
        terminal: receipt.terminal,
      },
    };
  }

  private async post(path: string, body: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    try {
      const response = await this.fetcher(new URL(path, this.origin), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-lens-model-workload-token": this.workloadToken,
        },
        body: JSON.stringify(body),
        signal,
      });
      if (response.status === 429) throw new Error("OVERLOADED");
      if (!response.ok) throw new Error("DEPENDENCY_UNAVAILABLE");
      return await readBoundedJson(response);
    } catch (error) {
      if (signal.aborted) throw new Error("CANCELLED");
      if (error instanceof Error && (error.message === "OVERLOADED" || error.message === "DEPENDENCY_UNAVAILABLE")) throw error;
      throw new Error("DEPENDENCY_UNAVAILABLE");
    }
  }
}
