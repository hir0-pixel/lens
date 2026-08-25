import type { ConversationHistoryPort, TerminalEvidence } from "./conversationHistory";

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024;

function internalOrigin(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("LENS_MEMORY_URL must be an internal HTTPS origin or loopback HTTP origin.");
  }
  return url;
}

function boundedString(value: unknown, max = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function digest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function validTerminalEvidence(value: TerminalEvidence): boolean {
  return boundedString(value.releaseFence, 512)
    && boundedString(value.releaseAuditReceipt, 512)
    && boundedString(value.outputCommitProof, 512)
    && boundedString(value.attemptedRoute, 64)
    && boundedString(value.attemptedReasonCode, 64)
    && boundedString(value.attemptedConfidenceBucket, 16)
    && (value.attemptedProfileSelector === undefined || boundedString(value.attemptedProfileSelector, 256))
    && boundedString(value.effectiveRoute, 64)
    && (value.effectiveProfileSelector === undefined || boundedString(value.effectiveProfileSelector, 256))
    && typeof value.groundingRequired === "boolean"
    && Number.isSafeInteger(value.routePolicyRevision) && value.routePolicyRevision >= 0
    && digest(value.routePolicyDigest)
    && digest(value.allowedProfileSetDigest)
    && typeof value.enforcementOverride === "boolean"
    && (value.overrideReason === undefined || boundedString(value.overrideReason, 256))
    && (!value.enforcementOverride || value.overrideReason !== undefined);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isSafeInteger(declared) && declared > MAX_RESPONSE_BYTES) throw new Error("MEMORY_RESPONSE_TOO_LARGE");
  if (!response.body) throw new Error("MEMORY_EMPTY_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("MEMORY_RESPONSE_TOO_LARGE");
    }
    chunks.push(next.value);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("MEMORY_INVALID_RESPONSE");
  return parsed as Record<string, unknown>;
}

/** Production Memory Service adapter. It never falls back to local storage. */
export class MemoryServiceHttpClient implements ConversationHistoryPort {
  private readonly origin: URL;

  constructor(url: string, private readonly workloadToken: string, private readonly timeoutMs = 5_000, private readonly fetcher: typeof fetch = fetch) {
    this.origin = internalOrigin(url);
    if (workloadToken.length < 32) throw new Error("LENS_MEMORY_WORKLOAD_TOKEN must contain at least 32 characters.");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new Error("Memory timeout is outside the allowed range.");
  }

  private async post(path: string, body: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized, "utf8") > MAX_REQUEST_BYTES) throw new Error("MEMORY_REQUEST_TOO_LARGE");
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = AbortSignal.any([signal, timeout]);
    const response = await this.fetcher(new URL(path, this.origin), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-lens-memory-token": this.workloadToken, "x-lens-memory-assertion": String(body.memory_session_assertion ?? "") },
      body: serialized,
      signal: requestSignal,
    });
    if (!response.ok) throw new Error(`MEMORY_HTTP_${response.status}`);
    return readJson(response);
  }

  async get(input: { requestId: string; subjectRef: string; sessionRef: string; deviceRef: string; conversationRef: string; queryDigest: `sha256:${string}`; limit: number; memorySessionAssertion?: string }, signal: AbortSignal): Promise<readonly { role: "user" | "assistant"; text: string }[]> {
    if (!boundedString(input.requestId) || !boundedString(input.subjectRef) || !boundedString(input.sessionRef) || !boundedString(input.deviceRef) || !boundedString(input.conversationRef) || !digest(input.queryDigest) || !Number.isSafeInteger(input.limit) || input.limit < 0 || input.limit > 64) throw new Error("MEMORY_INVALID_REQUEST");
    if (!boundedString(input.sessionRef) || !boundedString(input.memorySessionAssertion, 2_048)) throw new Error("MEMORY_ASSERTION_REQUIRED");
    const response = await this.post(`/v1/conversations/${encodeURIComponent(input.conversationRef)}/history`, { request_id: input.requestId, subject_ref: input.subjectRef, session_ref: input.sessionRef, device_ref: input.deviceRef, conversation_ref: input.conversationRef, query_digest: input.queryDigest, limit: input.limit, memory_session_assertion: input.memorySessionAssertion }, signal);
    if (response.subject_ref !== input.subjectRef || response.conversation_ref !== input.conversationRef || !Array.isArray(response.turns)) throw new Error("MEMORY_BINDING_MISMATCH");
    const turns = response.turns.map((turn) => {
      if (!turn || typeof turn !== "object") throw new Error("MEMORY_INVALID_TURN");
      const record = turn as Record<string, unknown>;
      if ((record.role !== "user" && record.role !== "assistant") || typeof record.text !== "string" || record.text.length > 32_768) throw new Error("MEMORY_INVALID_TURN");
      return { role: record.role, text: record.text } as const;
    });
    return turns;
  }

  async beginTurn(input: { requestId: string; subjectRef: string; sessionRef: string; deviceRef: string; conversationRef: string; turnId: string; inputDigest: `sha256:${string}`; inputText: string; memorySessionAssertion?: string }, signal: AbortSignal): Promise<{ turnId: string; sequence: number }> {
    if (!boundedString(input.memorySessionAssertion, 2_048)) throw new Error("MEMORY_ASSERTION_REQUIRED");
    const response = await this.post(`/v1/conversations/${encodeURIComponent(input.conversationRef)}/turns:begin`, {
      request_id: input.requestId, idempotency_key: input.requestId, subject_ref: input.subjectRef, session_ref: input.sessionRef, device_ref: input.deviceRef, conversation_ref: input.conversationRef, query_digest: input.inputDigest, input_digest: input.inputDigest, input_text: input.inputText, memory_session_assertion: input.memorySessionAssertion,
    }, signal);
    if (response.subject_ref !== input.subjectRef || response.conversation_ref !== input.conversationRef || !boundedString(response.turn_id) || typeof response.turn_sequence !== "number" || !Number.isSafeInteger(response.turn_sequence) || (response.input_digest !== undefined && response.input_digest !== input.inputDigest)) throw new Error("MEMORY_BEGIN_BINDING_MISMATCH");
    return { turnId: response.turn_id, sequence: response.turn_sequence };
  }

  async finalizeTurn(input: { requestId: string; subjectRef: string; sessionRef: string; deviceRef: string; conversationRef: string; turnId: string; inputDigest: `sha256:${string}`; output: string; outputDigest: `sha256:${string}`; terminalEvidence: TerminalEvidence; memorySessionAssertion?: string }, signal: AbortSignal): Promise<void> {
    if (!boundedString(input.memorySessionAssertion, 2_048)) throw new Error("MEMORY_ASSERTION_REQUIRED");
    if (!digest(input.outputDigest) || input.output.length > 64 * 1024 || !validTerminalEvidence(input.terminalEvidence)) throw new Error("MEMORY_INVALID_FINALIZATION");
    const response = await this.post(`/v1/turns/${encodeURIComponent(input.turnId)}:finalize`, {
      request_id: input.requestId, subject_ref: input.subjectRef, session_ref: input.sessionRef, device_ref: input.deviceRef, conversation_ref: input.conversationRef, turn_id: input.turnId, query_digest: input.inputDigest, input_digest: input.inputDigest, output_digest: input.outputDigest, output: input.output,
      // Structured — never a pipe-delimited opaque string (Doc 004 §23 step 4).
      terminal_evidence: {
        release_fence: input.terminalEvidence.releaseFence,
        release_audit_receipt: input.terminalEvidence.releaseAuditReceipt,
        output_commit_proof: input.terminalEvidence.outputCommitProof,
        attempted_route: input.terminalEvidence.attemptedRoute,
        attempted_reason_code: input.terminalEvidence.attemptedReasonCode,
        attempted_confidence_bucket: input.terminalEvidence.attemptedConfidenceBucket,
        ...(input.terminalEvidence.attemptedProfileSelector !== undefined ? { attempted_profile_selector: input.terminalEvidence.attemptedProfileSelector } : {}),
        effective_route: input.terminalEvidence.effectiveRoute,
        ...(input.terminalEvidence.effectiveProfileSelector !== undefined ? { effective_profile_selector: input.terminalEvidence.effectiveProfileSelector } : {}),
        grounding_required: input.terminalEvidence.groundingRequired,
        route_policy_revision: input.terminalEvidence.routePolicyRevision,
        route_policy_digest: input.terminalEvidence.routePolicyDigest,
        allowed_profile_set_digest: input.terminalEvidence.allowedProfileSetDigest,
        enforcement_override: input.terminalEvidence.enforcementOverride,
        ...(input.terminalEvidence.overrideReason !== undefined ? { override_reason: input.terminalEvidence.overrideReason } : {}),
      },
      memory_session_assertion: input.memorySessionAssertion,
    }, signal);
    if (response.subject_ref !== input.subjectRef || response.conversation_ref !== input.conversationRef || response.turn_id !== input.turnId || response.output_digest !== input.outputDigest || response.committed !== true) throw new Error("MEMORY_FINALIZE_BINDING_MISMATCH");
  }

  async append(): Promise<void> {
    throw new Error("MEMORY_APPEND_UNSUPPORTED");
  }
}
