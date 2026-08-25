import { OrchestratorError } from "../../services/orchestrator";
import type {
  AuditAdmissionPort,
  DisclosureReservationPort,
  GenerationContextFencePort,
  GenerationContextFenceReceipt,
  OutputBlobStorePort,
  OutputGuardPort,
  ResultAuthorizationPort,
  TurnStatePort,
} from "./service";
import type { DisclosureReservation, OrchestratorFailureCode, ReleaseAuthorization } from "../../services/orchestrator/types";

type FetchPort = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const HASH_RE = /^sha256:[a-f0-9]{64}$/;

export class AuthorityClientConfigError extends Error {
  constructor(message: string) {
    super(message);
  }
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

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function internalAuthorityOrigin(value: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new AuthorityClientConfigError("LENS_AUTHORITY_URL must be a valid internal origin.");
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") {
    throw new AuthorityClientConfigError("LENS_AUTHORITY_URL must be a plain internal origin.");
  }
  if (endpoint.protocol === "https:" && isInternalHost(endpoint.hostname)) return endpoint;
  if (endpoint.protocol === "http:" && isLoopbackHost(endpoint.hostname)) return endpoint;
  throw new AuthorityClientConfigError("LENS_AUTHORITY_URL must use HTTPS with an internal host or loopback HTTP.");
}

function assertWorkloadToken(token: string): void {
  if (token.length < 32) {
    throw new AuthorityClientConfigError("LENS_AUTHORITY_WORKLOAD_TOKEN must contain at least 32 characters.");
  }
}

function assertDigest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && HASH_RE.test(value);
}

function assertString(value: unknown, maxLength = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function assertFutureExpiry(value: unknown, maxExpiresAt: number, now: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > now && value <= maxExpiresAt;
}

function assertJsonRecord(payload: unknown): JsonRecord {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Authority returned a malformed response.");
  }
  return payload as JsonRecord;
}

function deadlineSignal(parent: AbortSignal | undefined, deadlineAt: number): AbortSignal {
  const timeout = AbortSignal.timeout(Math.max(1, deadlineAt - Date.now()));
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

function localDeadline(timeoutMs: number): number {
  return Date.now() + timeoutMs;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Authority response exceeded its byte envelope.");
  }
  if (!response.body) throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Authority returned an empty response.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Authority response exceeded its byte envelope.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"));
  } catch {
    throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Authority returned invalid JSON.");
  }
}

function mapStatus(status: number): OrchestratorFailureCode {
  if (status === 403 || status === 409 || status === 412) return "FORBIDDEN";
  if (status === 429) return "OVERLOADED";
  return "DEPENDENCY_UNAVAILABLE";
}

/**
 * Internal authority client for live security/release decisions. Production is
 * expected to bind this to mTLS/workload identity; the token header is a
 * transitional credential and is never accepted in URLs.
 */
export class AuthorityHttpClient implements
  GenerationContextFencePort,
  AuditAdmissionPort,
  OutputGuardPort,
  OutputBlobStorePort,
  TurnStatePort,
  DisclosureReservationPort,
  ResultAuthorizationPort {
  private readonly origin: URL;

  constructor(
    serviceUrl: string,
    private readonly workloadToken: string,
    private readonly fetcher: FetchPort = fetch,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    this.origin = internalAuthorityOrigin(serviceUrl);
    assertWorkloadToken(workloadToken);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
      throw new AuthorityClientConfigError("Authority timeout must be an integer from 1 to 30000 ms.");
    }
  }

  async revalidate(input: Parameters<GenerationContextFencePort["revalidate"]>[0], signal: AbortSignal): Promise<GenerationContextFenceReceipt> {
    const response = assertJsonRecord(await this.post("/v1/generation-context-fences/revalidate", {
      request_id: input.requestId,
      turn_id: input.turnId,
      subject_ref: input.subjectRef,
      device_ref: input.deviceRef,
      session_ref: input.sessionRef,
      context_digest: input.contextDigest,
      manifest_expires_at: input.manifestExpiresAt,
      boundary: input.boundary,
      resource_refs: input.resourceRefs,
      index_generation: input.indexGeneration,
      ...(input.toolCallRef ? { tool_call_ref: input.toolCallRef } : {}),
    }, signal, Math.min(input.manifestExpiresAt, localDeadline(this.timeoutMs)), input.requestId));

    if (
      response.request_id !== input.requestId ||
      response.turn_id !== input.turnId ||
      response.boundary !== input.boundary ||
      !assertString(response.fence_ref) ||
      response.context_digest !== input.contextDigest ||
      !assertFutureExpiry(response.expires_at, input.manifestExpiresAt, Date.now()) ||
      typeof response.checked_at !== "number" ||
      !Number.isSafeInteger(response.checked_at)
    ) {
      throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Context fence authority returned an invalid receipt.");
    }
    return {
      fenceRef: response.fence_ref,
      contextDigest: response.context_digest,
      expiresAt: response.expires_at,
      checkedAt: response.checked_at,
    };
  }

  async admit(input: Parameters<AuditAdmissionPort["admit"]>[0], signal: AbortSignal): Promise<{ receiptDigest: string }> {
    const response = assertJsonRecord(await this.post("/v1/audit/admissions", {
      kind: input.kind,
      request_id: input.requestId,
      turn_id: input.turnId,
      input_digest: input.inputDigest,
      rag_profile_version: input.ragProfileVersion,
      rag_profile_digest: input.ragProfileDigest,
      ...(input.routeOverride ? {
        route_override: {
          attempted_route: input.routeOverride.attemptedRoute,
          attempted_reason_code: input.routeOverride.attemptedReasonCode,
          attempted_confidence_bucket: input.routeOverride.attemptedConfidenceBucket,
          ...(input.routeOverride.attemptedProfileSelector !== undefined ? { attempted_profile_selector: input.routeOverride.attemptedProfileSelector } : {}),
          effective_route: input.routeOverride.effectiveRoute,
          ...(input.routeOverride.effectiveProfileSelector !== undefined ? { effective_profile_selector: input.routeOverride.effectiveProfileSelector } : {}),
          grounding_required: input.routeOverride.groundingRequired,
          route_policy_revision: input.routeOverride.routePolicyRevision,
          route_policy_digest: input.routeOverride.routePolicyDigest,
          allowed_profile_set_digest: input.routeOverride.allowedProfileSetDigest,
          enforcement_override: input.routeOverride.enforcementOverride,
          override_reason: input.routeOverride.overrideReason,
        },
      } : {}),
    }, signal, localDeadline(this.timeoutMs), input.requestId));

    if (
      response.kind !== input.kind ||
      response.request_id !== input.requestId ||
      response.turn_id !== input.turnId ||
      response.input_digest !== input.inputDigest ||
      response.rag_profile_version !== input.ragProfileVersion ||
      response.rag_profile_digest !== input.ragProfileDigest ||
      !assertDigest(response.receipt_digest)
    ) {
      throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Audit authority returned an invalid admission receipt.");
    }
    // The echoed route_override (if any) must match what was sent — Authority
    // is expected to persist and return it verbatim, not silently drop it.
    if (input.routeOverride) {
      const echoed = response.route_override as Record<string, unknown> | undefined;
      if (
        !echoed ||
        echoed.attempted_route !== input.routeOverride.attemptedRoute ||
        echoed.effective_route !== input.routeOverride.effectiveRoute ||
        echoed.route_policy_revision !== input.routeOverride.routePolicyRevision ||
        echoed.route_policy_digest !== input.routeOverride.routePolicyDigest ||
        echoed.enforcement_override !== input.routeOverride.enforcementOverride ||
        echoed.override_reason !== input.routeOverride.overrideReason
      ) {
        throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Audit authority did not echo the route_override provenance it was given.");
      }
    }
    return { receiptDigest: response.receipt_digest };
  }

  async inspect(input: Parameters<OutputGuardPort["inspect"]>[0], signal: AbortSignal): Promise<Awaited<ReturnType<OutputGuardPort["inspect"]>>> {
    const response = assertJsonRecord(await this.post("/v1/output-guard/inspect", {
      request_id: input.requestId,
      subject_ref: input.subjectRef,
      output: input.output,
      output_digest: input.outputDigest,
      source_classifications: input.sourceClassifications,
    }, signal, localDeadline(this.timeoutMs), input.requestId));

    if (response.request_id !== input.requestId || response.output_digest !== input.outputDigest || typeof response.allowed !== "boolean") {
      throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Output guard returned an invalid decision.");
    }
    if (!response.allowed) {
      return {
        allowed: false,
        derivedClassificationRef: "denied",
        guardReceipt: assertString(response.guard_receipt) ? response.guard_receipt : "denied",
        reason: assertString(response.reason, 1024) ? response.reason : "Output guard denied release.",
      };
    }
    if (!assertString(response.derived_classification_ref) || !assertString(response.guard_receipt)) {
      throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Output guard returned an incomplete allow decision.");
    }
    return {
      allowed: true,
      derivedClassificationRef: response.derived_classification_ref,
      guardReceipt: response.guard_receipt,
    };
  }

  async putBlob(input: Parameters<OutputBlobStorePort["putBlob"]>[0], signal: AbortSignal): Promise<Awaited<ReturnType<OutputBlobStorePort["putBlob"]>>> {
    const response = assertJsonRecord(await this.post("/v1/output-blobs", {
      request_id: input.requestId,
      turn_id: input.turnId,
      output: input.output,
      output_digest: input.outputDigest,
      classification_ref: input.classificationRef,
      guard_receipt: input.guardReceipt,
    }, signal, localDeadline(this.timeoutMs), input.requestId));

    if (
      response.request_id !== input.requestId ||
      response.turn_id !== input.turnId ||
      !assertString(response.output_ref) ||
      response.output_digest !== input.outputDigest ||
      !assertString(response.commit_proof)
    ) {
      throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Output blob store returned an invalid commit proof.");
    }
    return {
      outputRef: response.output_ref,
      outputDigest: response.output_digest,
      commitProof: response.commit_proof,
    };
  }

  async verifyBlob(input: Parameters<OutputBlobStorePort["verifyBlob"]>[0], signal: AbortSignal): Promise<boolean> {
    const response = assertJsonRecord(await this.post("/v1/output-blobs/verify", {
      output_ref: input.outputRef,
      output_digest: input.outputDigest,
    }, signal, localDeadline(this.timeoutMs)));

    if (response.output_ref !== input.outputRef || response.output_digest !== input.outputDigest || typeof response.verified !== "boolean") {
      throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Output blob store returned an invalid verification response.");
    }
    return response.verified;
  }

  async repairDanglingOutput(input: Parameters<OutputBlobStorePort["repairDanglingOutput"]>[0], signal: AbortSignal): Promise<"repaired" | "missing" | "corrupt"> {
    const response = assertJsonRecord(await this.post("/v1/output-blobs/repair", {
      output_ref: input.outputRef,
      output_digest: input.outputDigest,
    }, signal, localDeadline(this.timeoutMs)));

    if (
      response.output_ref !== input.outputRef ||
      response.output_digest !== input.outputDigest ||
      (response.status !== "repaired" && response.status !== "missing" && response.status !== "corrupt")
    ) {
      throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Output blob store returned an invalid repair response.");
    }
    return response.status;
  }

  async commitTerminal(input: Parameters<TurnStatePort["commitTerminal"]>[0], signal: AbortSignal): Promise<void> {
    const response = assertJsonRecord(await this.post("/v1/turn-state/terminal-commits", {
      request_id: input.requestId,
      turn_id: input.turnId,
      output_ref: input.outputRef,
      output_digest: input.outputDigest,
      release_fence: input.releaseFence,
      release_audit_receipt: input.releaseAuditReceipt,
    }, signal, localDeadline(this.timeoutMs), input.requestId));

    if (
      response.request_id !== input.requestId ||
      response.turn_id !== input.turnId ||
      response.output_ref !== input.outputRef ||
      response.output_digest !== input.outputDigest ||
      response.release_fence !== input.releaseFence ||
      response.committed !== true
    ) {
      throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Turn-state authority returned an invalid terminal commit.");
    }
  }

  async markFailed(input: Parameters<TurnStatePort["markFailed"]>[0]): Promise<void> {
    await this.post("/v1/turn-state/failures", {
      request_id: input.requestId,
      turn_id: input.turnId,
      code: input.code,
    }, undefined, localDeadline(this.timeoutMs), input.requestId);
  }

  async reserve(input: Parameters<DisclosureReservationPort["reserve"]>[0], signal: AbortSignal): Promise<DisclosureReservation> {
    const response = assertJsonRecord(await this.post("/v1/disclosures/reservations", {
      request_id: input.requestId,
      subject_ref: input.subjectRef,
      device_ref: input.deviceRef,
      application_ref: input.applicationRef,
      purpose_ref: input.purposeRef,
      output_ref: input.outputRef,
      output_digest: input.outputDigest,
      classification_ref: input.classificationRef,
      source_classifications: input.sourceClassifications,
      resource_set_digest: input.resourceSetDigest,
      lineage_digest: input.lineageDigest,
      units: input.units,
      ceiling: input.ceiling,
      terminal_receipt: {
        run_ref: input.terminalReceipt.runRef,
        final_counter_digest: input.terminalReceipt.finalCounterDigest,
        terminal: input.terminalReceipt.terminal,
        pending_work: input.terminalReceipt.pendingWork,
      },
      expires_at: input.expiresAt,
    }, signal, localDeadline(this.timeoutMs), input.requestId));

    if (
      response.request_id !== input.requestId ||
      response.output_ref !== input.outputRef ||
      response.output_digest !== input.outputDigest ||
      // The returned classification is the live exposure ledger's own
      // determination (the strongest of the source classifications), which
      // can legitimately be stronger than the single classification_ref we
      // sent — that is the live-policy check actually doing something, not
      // an error. Only its type/presence is validated here.
      typeof response.classification_ref !== "string" ||
      response.classification_ref.length === 0 ||
      !assertString(response.reservation_ref)
    ) {
      throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Disclosure authority returned an invalid reservation.");
    }
    return { reservationRef: response.reservation_ref, classificationRef: response.classification_ref };
  }

  async commit(input: Parameters<DisclosureReservationPort["commit"]>[0], signal: AbortSignal): Promise<void> {
    const response = assertJsonRecord(await this.post("/v1/disclosures/commits", {
      reservation_ref: input.reservation.reservationRef,
      output_ref: input.outputRef,
      output_digest: input.outputDigest,
      release_fence: input.releaseFence,
    }, signal, localDeadline(this.timeoutMs)));

    if (
      response.reservation_ref !== input.reservation.reservationRef ||
      response.output_ref !== input.outputRef ||
      response.output_digest !== input.outputDigest ||
      response.release_fence !== input.releaseFence ||
      response.committed !== true
    ) {
      throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Disclosure authority returned an invalid commit.");
    }
  }

  async authorize(input: Parameters<ResultAuthorizationPort["authorize"]>[0], signal: AbortSignal): Promise<ReleaseAuthorization> {
    const response = assertJsonRecord(await this.post("/v1/result-authorization/authorize", {
      request_id: input.requestId,
      subject_ref: input.subjectRef,
      output_ref: input.outputRef,
      output_digest: input.outputDigest,
      classification_ref: input.classificationRef,
      disclosure_reservation_ref: input.disclosureReservationRef,
    }, signal, localDeadline(this.timeoutMs), input.requestId));

    if (
      response.request_id !== input.requestId ||
      response.output_ref !== input.outputRef ||
      response.output_digest !== input.outputDigest ||
      response.classification_ref !== input.classificationRef ||
      response.disclosure_reservation_ref !== input.disclosureReservationRef ||
      !assertString(response.release_fence) ||
      !Array.isArray(response.obligations) ||
      response.obligations.length > 32 ||
      !response.obligations.every((obligation) => assertString(obligation, 128))
    ) {
      throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Result authorization returned an invalid release fence.");
    }
    return {
      releaseFence: response.release_fence,
      obligations: response.obligations,
    };
  }

  private async post(path: string, body: JsonRecord, signal: AbortSignal | undefined, deadlineAt: number, requestId?: string): Promise<unknown> {
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized, "utf8") > MAX_REQUEST_BYTES) {
      throw new OrchestratorError("OVERLOADED", "Authority request exceeded its byte envelope.");
    }
    const requestSignal = deadlineSignal(signal, deadlineAt);
    try {
      const response = await this.fetcher(new URL(path, this.origin), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-lens-caller-workload": "ai-orchestrator",
          "x-lens-authority-token": this.workloadToken,
          ...(requestId ? { "x-lens-request-id": requestId } : {}),
        },
        body: serialized,
        signal: requestSignal,
      });
      if (!response.ok) throw new OrchestratorError(mapStatus(response.status), "Authority rejected the request.");
      return await readBoundedJson(response);
    } catch (error) {
      if (requestSignal.aborted || signal?.aborted) throw new OrchestratorError("CANCELLED", "Authority request was cancelled.");
      if (error instanceof OrchestratorError) throw error;
      throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Authority is unavailable.");
    }
  }
}
