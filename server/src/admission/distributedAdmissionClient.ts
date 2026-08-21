const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MAX_ROUTE_CHARS = 256;
const MAX_RESPONSE_BYTES = 8_192;
const MAX_RETRY_AFTER_MS = 300_000;
const MAX_TIMEOUT_MS = 5_000;
const MIN_TIMEOUT_MS = 100;
const MAX_FUTURE_DEADLINE_MS = 30_000;
const MAX_BUCKET_VALUE = 1_000_000_000;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export interface DistributedAdmissionRequest {
  keyDigest: string;
  route: string;
  capacity: number;
  refillTokens: number;
  refillIntervalMs: number;
  cost: number;
  deadlineAt: number;
}

export interface DistributedAdmissionResponse {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export class DistributedAdmissionClientError extends Error {}

export class DistributedAdmissionClientOverloadedError extends DistributedAdmissionClientError {}

function admissionOrigin(value: string): URL {
  const endpoint = new URL(value);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new DistributedAdmissionClientError(
      "ADMISSION_API_ORIGIN must be a plain HTTPS or loopback HTTP origin.",
    );
  }
  if (endpoint.pathname !== "/" && endpoint.pathname !== "") {
    throw new DistributedAdmissionClientError("ADMISSION_API_ORIGIN must not include a path.");
  }
  if (endpoint.protocol === "https:" && isInternalHost(endpoint.hostname)) {
    return endpoint;
  }
  if (endpoint.protocol === "http:" && LOOPBACK_HOSTS.has(endpoint.hostname)) {
    return endpoint;
  }
  throw new DistributedAdmissionClientError(
    "ADMISSION_API_ORIGIN must use HTTPS or loopback HTTP only.",
  );
}

function isInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (LOOPBACK_HOSTS.has(endpointHost(host)) || host.endsWith(".internal")) return true;
  const parts = host.split(".").map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
  }
  return host.startsWith("fc") || host.startsWith("fd");
}

function endpointHost(host: string): string {
  return host === "::1" ? "[::1]" : host;
}

function requireBoundedInteger(value: number, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new DistributedAdmissionClientError(`INVALID_${field.toUpperCase()}`);
  }
  return value;
}

function validateRequest(input: DistributedAdmissionRequest, now: number): void {
  if (!SHA256_HEX.test(input.keyDigest)) {
    throw new DistributedAdmissionClientError("INVALID_KEY_DIGEST");
  }
  if (
    input.route.length === 0 ||
    input.route.length > MAX_ROUTE_CHARS ||
    !input.route.startsWith("/") ||
    input.route.includes("?") ||
    input.route.includes("#")
  ) {
    throw new DistributedAdmissionClientError("INVALID_ROUTE");
  }

  requireBoundedInteger(input.capacity, "capacity", 1, MAX_BUCKET_VALUE);
  requireBoundedInteger(input.refillTokens, "refill_tokens", 1, MAX_BUCKET_VALUE);
  requireBoundedInteger(input.refillIntervalMs, "refill_interval_ms", 1, MAX_BUCKET_VALUE);
  requireBoundedInteger(input.cost, "cost", 1, MAX_BUCKET_VALUE);
  requireBoundedInteger(input.deadlineAt, "deadline_at", now + MIN_TIMEOUT_MS, now + MAX_FUTURE_DEADLINE_MS);
}

function validateResponse(payload: unknown): DistributedAdmissionResponse {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new DistributedAdmissionClientError("ADMISSION_INVALID_RESPONSE");
  }

  const record = payload as Record<string, unknown>;
  if (
    typeof record.allowed !== "boolean" ||
    !Number.isInteger(record.remaining) ||
    (record.remaining as number) < 0 ||
    !Number.isInteger(record.retry_after_ms) ||
    (record.retry_after_ms as number) < 0 ||
    (record.retry_after_ms as number) > MAX_RETRY_AFTER_MS
  ) {
    throw new DistributedAdmissionClientError("ADMISSION_INVALID_RESPONSE");
  }

  return {
    allowed: record.allowed,
    remaining: record.remaining as number,
    retryAfterMs: record.retry_after_ms as number,
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) {
    throw new DistributedAdmissionClientError("ADMISSION_INVALID_RESPONSE");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      throw new DistributedAdmissionClientError("ADMISSION_RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new DistributedAdmissionClientError("ADMISSION_INVALID_RESPONSE");
  }
}

export class DistributedAdmissionClient {
  private readonly endpoint: URL;

  constructor(
    origin: string,
    private readonly workloadToken: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.endpoint = admissionOrigin(origin);
    if (workloadToken.length < 32) {
      throw new DistributedAdmissionClientError(
        "ADMISSION_WORKLOAD_TOKEN must contain at least 32 characters.",
      );
    }
  }

  async check(input: DistributedAdmissionRequest, signal?: AbortSignal): Promise<DistributedAdmissionResponse> {
    const now = this.now();
    validateRequest(input, now);

    const timeoutMs = Math.max(
      MIN_TIMEOUT_MS,
      Math.min(MAX_TIMEOUT_MS, input.deadlineAt - now),
    );
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const url = new URL("/v1/admission/check", this.endpoint);
    const body = JSON.stringify({
      key_digest: input.keyDigest,
      route: input.route,
      capacity: input.capacity,
      refill_tokens: input.refillTokens,
      refill_interval_ms: input.refillIntervalMs,
      cost: input.cost,
      deadline_at: input.deadlineAt,
    });

    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-lens-workload-token": this.workloadToken,
        },
        body,
        signal: requestSignal,
      });
    } catch (error) {
      if (
        error instanceof DOMException && error.name === "AbortError" ||
        error instanceof Error && error.name === "AbortError"
      ) {
        throw new DistributedAdmissionClientError("ADMISSION_UNAVAILABLE");
      }
      throw new DistributedAdmissionClientError("ADMISSION_UNAVAILABLE");
    }

    if (response.status === 429) {
      throw new DistributedAdmissionClientOverloadedError("ADMISSION_OVERLOADED");
    }
    if (!response.ok) {
      throw new DistributedAdmissionClientError("ADMISSION_UNAVAILABLE");
    }

    return validateResponse(await readBoundedJson(response));
  }
}
