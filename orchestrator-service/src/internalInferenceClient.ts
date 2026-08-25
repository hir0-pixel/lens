import type { RuntimePort, RuntimeReceipt, SchedulerPort, SchedulerReservation } from "../../services/model-gateway/ModelGateway";

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

async function readNdjsonGeneration(response: Response): Promise<{ output: string; receipt: Record<string, unknown> }> {
  if (!response.body) throw new Error("DEPENDENCY_UNAVAILABLE");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let receipt: Record<string, unknown> | undefined;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (Buffer.byteLength(buffer, "utf8") > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("DEPENDENCY_UNAVAILABLE");
    }
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        const event = JSON.parse(line) as { delta?: string; done?: boolean; receipt?: Record<string, unknown> };
        if (typeof event.delta === "string") {
          output += event.delta;
          if (Buffer.byteLength(output, "utf8") > 64 * 1024) throw new Error("DEPENDENCY_UNAVAILABLE");
        }
        if (event.done && event.receipt) receipt = event.receipt;
      }
      newline = buffer.indexOf("\n");
    }
  }
  if (!receipt) throw new Error("DEPENDENCY_UNAVAILABLE");
  return { output, receipt };
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

  async reserve(input: {
    reservationId: string;
    requestId: string;
    turnId: string;
    stepId: string;
    requestDigest: string;
    modelRef: string;
    artifactDigest: `sha256:${string}`;
    endpointRef: string;
    endpointGeneration: string;
    expiresAt: number;
  }): Promise<SchedulerReservation> {
    const payload = await this.post("/v1/scheduler/reservations", {
      reservation_id: input.reservationId,
      request_id: input.requestId,
      turn_id: input.turnId,
      step_id: input.stepId,
      request_digest: input.requestDigest,
      model_ref: input.modelRef,
      artifact_digest: input.artifactDigest,
      endpoint_ref: input.endpointRef,
      endpoint_generation: input.endpointGeneration,
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
      typeof record.lease_token !== "string" ||
      record.lease_token.length < 16 ||
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
      endpointGeneration: typeof record.endpoint_generation === "string" ? record.endpoint_generation : input.endpointGeneration,
      fence: record.fence,
      expiresAt: record.expires_at,
      leaseToken: record.lease_token,
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

  async execute(input: {
    reservationId: string;
    fence: number;
    endpointRef: string;
    scopeId: string;
    deadlineAt: number;
    chunks: readonly string[];
    leaseToken?: string;
    requestDigest?: string;
    endpointGeneration?: string;
  }, signal: AbortSignal): Promise<{ output: string; receipt: RuntimeReceipt }> {
    const payload = await this.post("/v1/inference/generate", {
      reservation_id: input.reservationId,
      fence: input.fence,
      endpoint_ref: input.endpointRef,
      endpoint_generation: input.endpointGeneration,
      request_digest: input.requestDigest,
      lease_token: input.leaseToken,
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
      typeof receipt.schema_version !== "number" ||
      typeof receipt.request_id !== "string" ||
      typeof receipt.turn_id !== "string" ||
      typeof receipt.step_id !== "string" ||
      typeof receipt.artifact_digest !== "string" ||
      typeof receipt.endpoint_generation !== "string" ||
      typeof receipt.usage_event_id !== "string" ||
      receipt.usage_event_id.length > 256 ||
      typeof receipt.measured_units !== "number" ||
      !Number.isSafeInteger(receipt.measured_units) ||
      receipt.measured_units < 0 ||
      typeof receipt.usage_signature !== "string" ||
      receipt.usage_signature.length < 16 ||
      (receipt.terminal !== "completed" && receipt.terminal !== "cancelled" && receipt.terminal !== "failed")
    ) {
      throw new Error("DEPENDENCY_UNAVAILABLE");
    }
    return {
      output: record.output,
      receipt: {
        schemaVersion: receipt.schema_version,
        reservationId: receipt.reservation_id,
        requestId: receipt.request_id,
        turnId: receipt.turn_id,
        stepId: receipt.step_id,
        fence: receipt.fence,
        artifactDigest: receipt.artifact_digest,
        endpointGeneration: receipt.endpoint_generation,
        usageEventId: receipt.usage_event_id,
        measuredUnits: receipt.measured_units,
        terminal: receipt.terminal,
        usageSignature: receipt.usage_signature,
      },
    };
  }

  private async post(path: string, body: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    try {
      const response = await this.fetcher(new URL(path, this.origin), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/x-ndjson, application/json",
          "x-lens-model-workload-token": this.workloadToken,
        },
        body: JSON.stringify(body),
        signal,
      });
      if (response.status === 429) throw new Error("OVERLOADED");
      if (!response.ok) throw new Error("DEPENDENCY_UNAVAILABLE");
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("ndjson")) return await readNdjsonGeneration(response);
      return await readBoundedJson(response);
    } catch (error) {
      if (signal.aborted) throw new Error("CANCELLED");
      if (error instanceof Error && (error.message === "OVERLOADED" || error.message === "DEPENDENCY_UNAVAILABLE")) throw error;
      throw new Error("DEPENDENCY_UNAVAILABLE");
    }
  }
}
