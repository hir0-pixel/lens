import { createHash } from "node:crypto";
import type { RetrievalRequest, RetrievalResult } from "../../libs/rag-contracts";

const MAX_RESPONSE_BYTES = 256 * 1024;

export class RetrievalClientError extends Error {
  constructor(readonly code: "INVALID_CONFIG" | "UNAVAILABLE" | "INVALID_RESPONSE", message: string) {
    super(message);
  }
}

function internalServiceUrl(value: string): URL {
  const endpoint = new URL(value);
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new RetrievalClientError("INVALID_CONFIG", "RETRIEVAL_URL must be a plain HTTPS or loopback HTTP URL.");
  }
  if (endpoint.protocol === "https:" && isInternalHost(endpoint.hostname)) return endpoint;
  if (endpoint.protocol === "http:" && loopbackHosts.has(endpoint.hostname)) return endpoint;
  throw new RetrievalClientError("INVALID_CONFIG", "RETRIEVAL_URL must use HTTPS or loopback HTTP.");
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

function safeToken(token: string): void {
  if (token.length < 32) throw new RetrievalClientError("INVALID_CONFIG", "RETRIEVAL_WORKLOAD_TOKEN must contain at least 32 characters.");
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new RetrievalClientError("INVALID_RESPONSE", "Retrieval response exceeded its byte envelope.");
  if (!response.body) throw new RetrievalClientError("INVALID_RESPONSE", "Retrieval returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new RetrievalClientError("INVALID_RESPONSE", "Retrieval response exceeded its byte envelope.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"));
  } catch {
    throw new RetrievalClientError("INVALID_RESPONSE", "Retrieval returned invalid JSON.");
  }
}

function isRetrievalResult(payload: unknown, request: RetrievalRequest, now: number): payload is RetrievalResult {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  if (record.status === "no_context" || record.status === "denied_policy" || record.status === "failed_downstream") return true;
  if (record.status !== "context") return false;
  const manifest = record.manifest as Record<string, unknown> | undefined;
  const manifestSources = manifest?.sources;
  return (
    typeof record.retrieval_id === "string" &&
    record.request_id === request.request_id &&
    record.turn_id === request.turn_id &&
    typeof record.visibility_sequence === "number" &&
    Number.isSafeInteger(record.visibility_sequence) &&
    record.visibility_sequence >= request.visibility_minimum &&
    typeof record.index_generation === "string" &&
    typeof record.context_digest === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(record.context_digest) &&
    Boolean(manifest) &&
    manifest?.digest === record.context_digest &&
    typeof manifest.expires_at === "number" &&
    manifest.expires_at > now &&
    manifest.expires_at <= request.deadline_at &&
    Array.isArray(record.sources) &&
    Array.isArray(manifestSources) &&
    manifestSources.length === record.sources.length &&
    record.sources.length > 0 &&
    record.sources.length <= 20 &&
    record.sources.every((source, index) => {
      const item = source as Record<string, unknown>;
      const manifestItem = manifestSources[index] as Record<string, unknown>;
      return (
        typeof item.document_version_ref === "string" &&
        typeof item.chunk_ref === "string" &&
        typeof item.content_digest === "string" &&
        /^sha256:[a-f0-9]{64}$/.test(item.content_digest) &&
        typeof item.citation_anchor === "string" &&
        typeof item.classification_ref === "string" &&
        typeof item.text === "string" &&
        item.text.length > 0 &&
        item.text.length <= 65_536 &&
        digest(item.text) === item.content_digest &&
        manifestItem.document_version_ref === item.document_version_ref &&
        manifestItem.chunk_ref === item.chunk_ref &&
        manifestItem.content_digest === item.content_digest &&
        manifestItem.citation_anchor === item.citation_anchor &&
        manifestItem.classification_ref === item.classification_ref &&
        manifestItem.text === undefined
      );
    })
  );
}

export class RetrievalHttpClient {
  private readonly endpoint: URL;

  constructor(
    serviceUrl: string,
    private readonly workloadToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.endpoint = internalServiceUrl(serviceUrl);
    safeToken(workloadToken);
  }

  async retrieve(request: RetrievalRequest, signal: AbortSignal): Promise<RetrievalResult> {
    let response: Response;
    const deadlineSignal = AbortSignal.timeout(Math.max(1, request.deadline_at - Date.now()));
    const combinedSignal = AbortSignal.any([signal, deadlineSignal]);
    try {
      response = await this.fetcher(new URL("/v1/retrieve", this.endpoint), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-lens-caller-workload": "ai-orchestrator",
          "x-lens-orchestrator-token": this.workloadToken,
          "x-lens-request-id": request.request_id,
        },
        body: JSON.stringify(request),
        signal: combinedSignal,
      });
    } catch {
      throw new RetrievalClientError("UNAVAILABLE", "Retrieval is unavailable.");
    }
    if (!response.ok) throw new RetrievalClientError("UNAVAILABLE", "Retrieval returned a non-success response.");

    const payload = await readBoundedJson(response);
    if (!isRetrievalResult(payload, request, Date.now())) {
      throw new RetrievalClientError("INVALID_RESPONSE", "Retrieval returned an invalid contract payload.");
    }
    return payload;
  }
}
