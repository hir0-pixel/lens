import { createHash } from "node:crypto";

const MAX_OUTPUT_CHARS = 64_000;
const MAX_CITATIONS = 20;
const MAX_QUERY_CHARS = 12_000;
const DEFAULT_DEADLINE_MS = 60_000;
const MAX_RESPONSE_BYTES = 128 * 1024;
const MODEL_REF_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export interface RagCitation {
  source: string;
  section: string;
}

export interface RagAnswer {
  output: string;
  citations: readonly RagCitation[];
}

export class OrchestratorClientError extends Error {
  constructor(readonly code: string, readonly reason?: string) {
    super(reason ?? code);
    this.name = "OrchestratorClientError";
  }
}

export type OrchestratorStatusCode =
  | "COMPLETED"
  | "CANCELLED"
  | "DENIED"
  | "FAILED";

export interface OrchestratorResponse {
  status: OrchestratorStatusCode;
  output: string;
  citations: readonly RagCitation[];
  requestId: string;
  turnId?: string;
  outputDigest: `sha256:${string}`;
}

function internalServiceUrl(value: string): URL {
  const endpoint = new URL(value);
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") {
    throw new OrchestratorClientError("ORCHESTRATOR_URL must be a plain HTTPS or loopback HTTP URL.");
  }
  if (endpoint.protocol === "https:" && isInternalHost(endpoint.hostname)) return endpoint;
  if (endpoint.protocol === "http:" && loopbackHosts.has(endpoint.hostname)) return endpoint;
  throw new OrchestratorClientError("ORCHESTRATOR_URL must use an internal HTTPS or loopback HTTP endpoint.");
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

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new OrchestratorClientError("ORCHESTRATOR_INVALID_RESPONSE");
  if (!response.body) throw new OrchestratorClientError("ORCHESTRATOR_INVALID_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new OrchestratorClientError("ORCHESTRATOR_INVALID_RESPONSE");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"));
  } catch {
    throw new OrchestratorClientError("ORCHESTRATOR_INVALID_RESPONSE");
  }
}

/**
 * The BFF routes every RAG turn through the internal Orchestrator. It never
 * calls the Retrieval service or an inference provider directly, and it never
 * accepts a client-supplied subject, session, device, endpoint, capability, or
 * authorization decision. Every trusted identity field is bound server-side
 * from the authenticated session.
 */
export class OrchestratorClient {
  private readonly endpoint: URL;

  constructor(
    serviceUrl: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.endpoint = internalServiceUrl(serviceUrl);
    if (token.length < 32) {
      throw new OrchestratorClientError("ORCHESTRATOR_TOKEN must contain at least 32 characters.");
    }
  }

  async ask(
    input: {
      requestId: string;
      query: string;
      subjectRef: string;
      sessionRef: string;
      deviceRef: string;
      conversationRef: string;
      sessionAssertion: string;
      memorySessionAssertion: string;
      applicationId: string;
      purposeRef: string;
      retrievalClass: string;
      deadlineMs: number;
      retryBudget: 0 | 1;
      /** Symbolic model alias selected by the authenticated user in the UI; never an endpoint. */
      modelRef?: string;
    },
    signal?: AbortSignal,
  ): Promise<RagAnswer> {
    if (input.query.length === 0 || input.query.length > MAX_QUERY_CHARS) {
      throw new OrchestratorClientError("INVALID_QUERY");
    }
    if (input.modelRef !== undefined && !MODEL_REF_PATTERN.test(input.modelRef)) {
      throw new OrchestratorClientError("INVALID_MODEL_REF");
    }
    if (input.conversationRef.length === 0 || input.conversationRef.length > 256 || input.sessionAssertion.length === 0 || input.sessionAssertion.length > 2_048 || input.memorySessionAssertion.length === 0 || input.memorySessionAssertion.length > 2_048) {
      throw new OrchestratorClientError("INVALID_SECURITY_BINDING");
    }

    const url = new URL("/v1/chat", this.endpoint);
    const deadlineAt = Date.now() + Math.max(1_000, Math.min(input.deadlineMs, DEFAULT_DEADLINE_MS));
    const body = {
      request_id: input.requestId,
      turn_id: `turn-${input.requestId}`,
      subject_ref: input.subjectRef,
      session_ref: input.sessionRef,
      device_ref: input.deviceRef,
      conversation_ref: input.conversationRef,
      session_assertion: input.sessionAssertion,
      memory_session_assertion: input.memorySessionAssertion,
      application_id: input.applicationId,
      purpose_ref: input.purposeRef,
      retrieval_class: input.retrievalClass,
      input_text: input.query,
      query_digest: sha256(input.query),
      deadline_at: deadlineAt,
      cancellation: false,
      retry_budget: input.retryBudget,
      bulkhead: "interactive",
      capability: "grounded-assistant",
      ...(input.modelRef ? { model_ref: input.modelRef } : {}),
    };

    let response: Response;
    try {
      const deadlineSignal = AbortSignal.timeout(Math.max(1, deadlineAt - Date.now()));
      response = await this.fetcher(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-lens-orchestrator-token": this.token,
          "x-lens-request-id": input.requestId,
        },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, deadlineSignal]) : deadlineSignal,
      });
    } catch {
      throw new OrchestratorClientError("ORCHESTRATOR_UNAVAILABLE");
    }

    if (response.status === 403) {
      const denied = await readBoundedJson(response);
      const record = denied as { error?: unknown; reason?: unknown };
      const error = typeof record.error === "string" ? record.error : "FORBIDDEN";
      const reason = typeof record.reason === "string" ? record.reason : undefined;
      throw new OrchestratorClientError(error, reason);
    }
    if (!response.ok) {
      throw new OrchestratorClientError("ORCHESTRATOR_UNAVAILABLE");
    }

    const payload = await readBoundedJson(response);
    if (!payload || typeof payload !== "object") {
      throw new OrchestratorClientError("ORCHESTRATOR_INVALID_RESPONSE");
    }

    const status = (payload as { status?: unknown }).status;
    if (status === "DENIED") {
      const record = payload as { error?: unknown; reason?: unknown };
      const error = typeof record.error === "string" ? record.error : "FORBIDDEN";
      const reason = typeof record.reason === "string" ? record.reason : undefined;
      throw new OrchestratorClientError(error, reason);
    }
    const result = this.validateResponse(payload, input.requestId);
    return {
      output: result.output,
      citations: result.citations,
    };
  }

  private validateResponse(payload: object, requestId: string): OrchestratorResponse {
    const record = payload as Record<string, unknown>;
    if (
      record.status !== "COMPLETED" ||
      record.requestId !== requestId ||
      typeof record.output !== "string" ||
      record.output.length === 0 ||
      record.output.length > MAX_OUTPUT_CHARS ||
      Buffer.byteLength(record.output, "utf8") > 64 * 1024 ||
      typeof record.outputDigest !== "string" ||
      record.outputDigest !== sha256(record.output) ||
      !Array.isArray(record.citations) ||
      record.citations.length > MAX_CITATIONS ||
      record.citations.some((citation) =>
        !citation || typeof citation !== "object" ||
        typeof (citation as RagCitation).source !== "string" ||
        (citation as RagCitation).source.length === 0 ||
        (citation as RagCitation).source.length > 1_024 ||
        typeof (citation as RagCitation).section !== "string" ||
        (citation as RagCitation).section.length === 0 ||
        (citation as RagCitation).section.length > 2_048,
      )
    ) {
      throw new OrchestratorClientError("ORCHESTRATOR_INVALID_RESPONSE");
    }
    return {
      status: "COMPLETED",
      output: record.output,
      citations: record.citations.map((citation) => ({
        source: (citation as RagCitation).source,
        section: (citation as RagCitation).section,
      })),
      requestId,
      turnId: typeof record.turnId === "string" ? record.turnId : undefined,
      outputDigest: record.outputDigest as `sha256:${string}`,
    };
  }
}
