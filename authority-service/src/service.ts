import { createHash, randomUUID } from "node:crypto";
import type { AuthorityStorePort } from "./store";
import { ContextFenceDeniedError, FailClosedContextFencePolicy, type ContextFencePolicyPort } from "./pdpAdapter";
import { GovernanceAuthority, GovernanceError, type Classification as GovernanceClassification } from "../../services/governance/GovernanceAuthority";
import { OutputBlobCrypto } from "./outputCrypto";

const HASH_RE = /^sha256:[a-f0-9]{64}$/;
const MAX_OUTPUT_BYTES = 64 * 1024;
const RESERVATION_TTL_MS = 5 * 60_000;
const CLASSIFICATION_RANK = ["public", "internal", "confidential", "restricted"] as const;
type Classification = typeof CLASSIFICATION_RANK[number];

export class AuthorityValidationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class AuthorityConflictError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class AuthorityNotFoundError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Pluggable content-safety decision point. The default implementation shipped
 * here (see DefaultContentPolicy) performs only real, structurally-checkable
 * validation (emptiness, byte-size bound) plus a real classification-rank
 * derivation from declared source classifications. It is NOT a content-safety
 * model: no PII/secret/keyword scanning is performed. A real model belongs
 * behind this interface, not faked here.
 */
export interface ContentPolicyPort {
  evaluate(input: {
    output: string;
    outputDigest: string;
    sourceClassifications: readonly string[];
  }): { allowed: boolean; derivedClassificationRef: string; reason?: string };
}

/**
 * Production governance boundary. Network-backed implementations are async;
 * the local GovernanceAuthority is accepted only for dev/test fixtures.
 */
export interface GovernancePort {
  reserveDisclosure(input: Parameters<GovernanceAuthority["reserveDisclosure"]>[0]): Promise<ReturnType<GovernanceAuthority["reserveDisclosure"]>>;
  commitDisclosure(reservationId: string, outputDigest: `sha256:${string}`, releaseFenceRef: string): Promise<ReturnType<GovernanceAuthority["commitDisclosure"]>>;
}

export interface ProductionOutputDisclosureAuthorizationPort {
  authorize(input: AuthorizeInput): Promise<AuthorizeResult>;
}

export interface ProductionAuditAdmissionPort {
  admit(input: AdmitInput): Promise<AdmitResult>;
}

function rankOf(classification: string): number {
  const idx = CLASSIFICATION_RANK.indexOf(classification as Classification);
  return idx === -1 ? CLASSIFICATION_RANK.indexOf("internal") : idx;
}

export class DefaultContentPolicy implements ContentPolicyPort {
  evaluate(input: { output: string; outputDigest: string; sourceClassifications: readonly string[] }): {
    allowed: boolean;
    derivedClassificationRef: string;
    reason?: string;
  } {
    const derivedClassificationRef = input.sourceClassifications.length === 0
      ? "internal"
      : input.sourceClassifications.reduce((max, cur) => (rankOf(cur) > rankOf(max) ? cur : max), input.sourceClassifications[0]);
    if (input.output.length === 0) {
      return { allowed: false, derivedClassificationRef, reason: "Output is empty." };
    }
    if (Buffer.byteLength(input.output, "utf8") > MAX_OUTPUT_BYTES) {
      return { allowed: false, derivedClassificationRef, reason: "Output exceeds the maximum byte bound." };
    }
    return { allowed: true, derivedClassificationRef };
  }
}

function sha256Digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function assertDigest(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !HASH_RE.test(value)) throw new AuthorityValidationError(`${field} must be a sha256 digest.`);
}

function assertNonEmptyString(value: unknown, field: string, maxLength = 512): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new AuthorityValidationError(`${field} must be a non-empty string of at most ${maxLength} characters.`);
  }
}

function assertRouteOverrideFields(value: RouteOverrideAdmissionFields | undefined): asserts value is RouteOverrideAdmissionFields {
  if (!value || typeof value !== "object") throw new AuthorityValidationError("route_override is required when kind is route_override.");
  assertNonEmptyString(value.attemptedRoute, "route_override.attempted_route", 32);
  assertNonEmptyString(value.attemptedReasonCode, "route_override.attempted_reason_code", 128);
  assertNonEmptyString(value.attemptedConfidenceBucket, "route_override.attempted_confidence_bucket", 16);
  if (value.attemptedProfileSelector !== undefined) assertNonEmptyString(value.attemptedProfileSelector, "route_override.attempted_profile_selector", 128);
  assertNonEmptyString(value.effectiveRoute, "route_override.effective_route", 32);
  if (value.effectiveProfileSelector !== undefined) assertNonEmptyString(value.effectiveProfileSelector, "route_override.effective_profile_selector", 128);
  if (typeof value.groundingRequired !== "boolean") throw new AuthorityValidationError("route_override.grounding_required must be a boolean.");
  if (!Number.isSafeInteger(value.routePolicyRevision) || value.routePolicyRevision < 0) throw new AuthorityValidationError("route_override.route_policy_revision must be a non-negative integer.");
  assertDigest(value.routePolicyDigest, "route_override.route_policy_digest");
  assertDigest(value.allowedProfileSetDigest, "route_override.allowed_profile_set_digest");
  if (typeof value.enforcementOverride !== "boolean") throw new AuthorityValidationError("route_override.enforcement_override must be a boolean.");
  assertNonEmptyString(value.overrideReason, "route_override.override_reason", 128);
}

export interface RevalidateInput {
  requestId: string;
  turnId: string;
  subjectRef: string;
  deviceRef: string;
  sessionRef: string;
  contextDigest: string;
  manifestExpiresAt: number;
  boundary: "generation_start" | "tool_call_boundary";
  /** Exact, immutable resource/version references the fence must attest — required so the real PDP can re-check current ACL/publication/integrity state for each one. */
  resourceRefs: readonly string[];
  /** The corpus generation the retrieved context came from, folded into what the signed decision covers — a corpus swap under the same context digest must not pass unnoticed. */
  indexGeneration: string;
  toolCallRef?: string;
}

export interface RevalidateResult {
  requestId: string;
  turnId: string;
  boundary: "generation_start" | "tool_call_boundary";
  fenceRef: string;
  contextDigest: string;
  expiresAt: number;
  checkedAt: number;
}

/**
 * Complete structured provenance for a route_override admission (Doc 004
 * §23 step 4 / item 4) — named fields, never a bare kind+digest and never
 * concatenated into an opaque string. Mirrors
 * `orchestrator-service/src/service.ts`'s `RouteOverrideAuditFields` (kept
 * as an independently declared, structurally-identical type rather than a
 * cross-package import — Authority does not depend on the Orchestrator).
 */
export interface RouteOverrideAdmissionFields {
  attemptedRoute: string;
  attemptedReasonCode: string;
  attemptedConfidenceBucket: string;
  attemptedProfileSelector?: string;
  effectiveRoute: string;
  effectiveProfileSelector?: string;
  groundingRequired: boolean;
  routePolicyRevision: number;
  routePolicyDigest: string;
  allowedProfileSetDigest: string;
  enforcementOverride: boolean;
  overrideReason: string;
}

export interface AdmitInput {
  kind: "generation" | "release" | "route_override";
  requestId: string;
  turnId: string;
  inputDigest: string;
  ragProfileVersion: number;
  ragProfileDigest: string;
  /** Required when, and only valid when, kind === "route_override". */
  routeOverride?: RouteOverrideAdmissionFields;
}

export interface AdmitResult {
  kind: "generation" | "release" | "route_override";
  requestId: string;
  turnId: string;
  inputDigest: string;
  ragProfileVersion: number;
  ragProfileDigest: string;
  receiptDigest: string;
  routeOverride?: RouteOverrideAdmissionFields;
}

export interface InspectInput {
  requestId: string;
  subjectRef: string;
  output: string;
  outputDigest: string;
  sourceClassifications: readonly string[];
}

export type InspectResult =
  | { requestId: string; outputDigest: string; allowed: true; derivedClassificationRef: string; guardReceipt: string }
  | { requestId: string; outputDigest: string; allowed: false; guardReceipt: string; reason: string };

export interface PutBlobInput {
  requestId: string;
  turnId: string;
  output: string;
  outputDigest: string;
  classificationRef: string;
  guardReceipt: string;
}

export interface PutBlobResult {
  requestId: string;
  turnId: string;
  outputRef: string;
  outputDigest: string;
  commitProof: string;
}

export interface VerifyBlobInput {
  outputRef: string;
  outputDigest: string;
}

export interface VerifyBlobResult {
  outputRef: string;
  outputDigest: string;
  verified: boolean;
}

export interface RepairBlobInput {
  outputRef: string;
  outputDigest: string;
}

export interface RepairBlobResult {
  outputRef: string;
  outputDigest: string;
  status: "repaired" | "missing" | "corrupt";
}

export interface CommitTerminalInput {
  requestId: string;
  turnId: string;
  outputRef: string;
  outputDigest: string;
  releaseFence: string;
  releaseAuditReceipt: string;
}

export interface CommitTerminalResult {
  requestId: string;
  turnId: string;
  outputRef: string;
  outputDigest: string;
  releaseFence: string;
  committed: true;
}

export interface MarkFailedInput {
  requestId: string;
  turnId: string;
  code: string;
}

export interface ReserveInput {
  requestId: string;
  subjectRef: string;
  deviceRef: string;
  applicationRef: string;
  purposeRef: string;
  outputRef: string;
  outputDigest: string;
  classificationRef: string;
  /** Classification of each source document that grounded this output, not just the single derived output classification — GovernanceAuthority's exposure ledger keys on the strongest of these. */
  sourceClassifications: readonly string[];
  /** Identifies the set of source resources that grounded this output (e.g. a digest over the sorted document_version_refs), so the exposure ledger tracks disclosure per resource set, not just per output. */
  resourceSetDigest: `sha256:${string}`;
  /** Ties this disclosure to the retrieval/generation lineage that produced it (e.g. a digest over the retrieval manifest digest and the output digest). */
  lineageDigest: `sha256:${string}`;
  /** Disclosure units this release would consume against the exposure ceiling. */
  units: number;
  /**
   * The exposure ceiling for this (subject, device, application, purpose,
   * channel, resource set) combination. HONEST SCOPE NOTE: this is threaded
   * through as a caller-supplied value because no real tenant-policy service
   * exists in this repository to source it from; a production deployment
   * must source this from real tenant/data-governance policy, not let the
   * caller (Orchestrator) set its own ceiling. Tracked as a named gap.
   */
  ceiling: number;
  terminalReceipt: {
    runRef: string;
    finalCounterDigest: `sha256:${string}`;
    terminal: boolean;
    pendingWork: boolean;
  };
  expiresAt: number;
}

export interface ReserveResult {
  requestId: string;
  outputRef: string;
  outputDigest: string;
  classificationRef: string;
  reservationRef: string;
}

export interface CommitReservationInput {
  reservationRef: string;
  outputRef: string;
  outputDigest: string;
  releaseFence: string;
}

export interface CommitReservationResult {
  reservationRef: string;
  outputRef: string;
  outputDigest: string;
  releaseFence: string;
  committed: true;
}

export interface AuthorizeInput {
  requestId: string;
  subjectRef: string;
  outputRef: string;
  outputDigest: string;
  classificationRef: string;
  disclosureReservationRef: string;
}

export interface AuthorizeResult {
  requestId: string;
  outputRef: string;
  outputDigest: string;
  classificationRef: string;
  disclosureReservationRef: string;
  releaseFence: string;
  obligations: readonly string[];
}

const FIXED_OBLIGATIONS = ["audit", "no-store"] as const;

export class AuthorityService {
  constructor(
    private readonly store: AuthorityStorePort,
    private readonly contentPolicy: ContentPolicyPort = new DefaultContentPolicy(),
    private readonly now: () => number = () => Date.now(),
    /**
     * The real authorization decision for a generation-context fence. This
     * is NOT optional in spirit — it defaults to `FailClosedContextFencePolicy`,
     * which denies every decision, precisely so a service instance that
     * hasn't been wired to a real PDP/GovernanceAuthority-backed policy
     * cannot silently approve anything. See pdpAdapter.ts.
     */
    private readonly contextFencePolicy: ContextFencePolicyPort = new FailClosedContextFencePolicy(),
    /**
     * The real disclosure/output-policy authority. Defaults to a fresh,
     * empty, in-process GovernanceAuthority — real in the sense that its
     * exposure ledger, idempotency, and reservation lifecycle are genuinely
     * enforced, but its state is process-local and unseeded with any real
     * tenant policy (ceiling, channel taxonomy) until one is wired in. See
     * the honest-scope note on `reserve()` below.
     */
    private readonly governance: GovernanceAuthority | GovernancePort = new GovernanceAuthority(now),
    private readonly outputCrypto: OutputBlobCrypto,
    private readonly productionOutputAuthorization?: ProductionOutputDisclosureAuthorizationPort,
    private readonly productionAuditAdmission?: ProductionAuditAdmissionPort,
  ) {}

  async revalidate(input: RevalidateInput): Promise<RevalidateResult> {
    assertNonEmptyString(input.requestId, "request_id", 128);
    assertNonEmptyString(input.turnId, "turn_id", 128);
    assertNonEmptyString(input.subjectRef, "subject_ref");
    assertNonEmptyString(input.deviceRef, "device_ref");
    assertNonEmptyString(input.sessionRef, "session_ref");
    assertDigest(input.contextDigest, "context_digest");
    if (!Number.isSafeInteger(input.manifestExpiresAt)) throw new AuthorityValidationError("manifest_expires_at must be a safe integer.");
    if (input.boundary !== "generation_start" && input.boundary !== "tool_call_boundary") {
      throw new AuthorityValidationError("boundary must be generation_start or tool_call_boundary.");
    }
    if (!Array.isArray(input.resourceRefs) || input.resourceRefs.length === 0) {
      throw new AuthorityValidationError("resource_refs must be a non-empty array.");
    }
    assertNonEmptyString(input.indexGeneration, "index_generation");

    // A local, explicit revocation is an additional emergency circuit
    // breaker layered ON TOP OF the real PDP consultation below — it is
    // checked first so an operator can deny a specific in-flight
    // (requestId, turnId) immediately without waiting for a policy/ACL
    // change to propagate through GovernanceAuthority. It does NOT replace
    // consulting the PDP: a fresh, un-revoked (requestId, turnId) is still
    // required to pass the real decision every single call.
    const existing = await this.store.getContextFence(input.requestId, input.turnId, input.contextDigest);
    if (existing?.revoked) throw new AuthorityConflictError("Context fence has been revoked.");

    const checkedAt = this.now();
    if (input.manifestExpiresAt <= checkedAt) throw new AuthorityConflictError("Context fence manifest has already expired.");

    let decision;
    try {
      decision = this.contextFencePolicy.decide({
        requestId: input.requestId,
        turnId: input.turnId,
        subjectRef: input.subjectRef,
        deviceRef: input.deviceRef,
        sessionRef: input.sessionRef,
        contextDigest: input.contextDigest,
        manifestExpiresAt: input.manifestExpiresAt,
        boundary: input.boundary,
        resourceRefs: input.resourceRefs,
        indexGeneration: input.indexGeneration,
      });
    } catch (error) {
      // PDP outage, a revision that changed mid-decision, a total or
      // partial denial, an unregistered subject/device: every one of these
      // must deny, not pass through. Fail closed.
      throw new AuthorityConflictError(error instanceof ContextFenceDeniedError ? error.reason : "Context fence policy authority is unavailable.");
    }

    await this.store.upsertContextFence({
      requestId: input.requestId,
      turnId: input.turnId,
      contextDigest: input.contextDigest,
      fenceRef: decision.fenceRef,
      expiresAt: decision.expiresAt,
      checkedAt: decision.checkedAt,
      revoked: 0,
      createdAt: existing?.createdAt ?? checkedAt,
    });

    return {
      requestId: input.requestId,
      turnId: input.turnId,
      boundary: input.boundary,
      fenceRef: decision.fenceRef,
      contextDigest: input.contextDigest,
      expiresAt: decision.expiresAt,
      checkedAt: decision.checkedAt,
    };
  }

  /** Test/admin-only capability: not exposed over HTTP. Revokes any issued context fences for (requestId, turnId) so a subsequent revalidate for the same key denies. */
  async revokeContextFence(requestId: string, turnId: string): Promise<number> {
    return this.store.revokeContextFence(requestId, turnId);
  }

  async admit(input: AdmitInput): Promise<AdmitResult> {
    if (this.productionAuditAdmission) return this.productionAuditAdmission.admit(input);
    assertNonEmptyString(input.requestId, "request_id", 128);
    assertNonEmptyString(input.turnId, "turn_id", 128);
    if (input.kind !== "generation" && input.kind !== "release" && input.kind !== "route_override") throw new AuthorityValidationError("kind must be generation, release, or route_override.");
    assertDigest(input.inputDigest, "input_digest");
    if (!Number.isSafeInteger(input.ragProfileVersion) || input.ragProfileVersion < 0) throw new AuthorityValidationError("rag_profile_version must be a non-negative integer.");
    assertDigest(input.ragProfileDigest, "rag_profile_digest");
    if (input.kind === "route_override") assertRouteOverrideFields(input.routeOverride);
    else if (input.routeOverride !== undefined) throw new AuthorityValidationError("route_override fields are only valid when kind is route_override.");

    const existing = await this.store.getAdmission(input.requestId, input.kind);
    if (existing) {
      const existingRouteOverride = existing.routeOverrideJson ? JSON.parse(existing.routeOverrideJson) as RouteOverrideAdmissionFields : undefined;
      if (
        existing.inputDigest !== input.inputDigest ||
        existing.ragProfileVersion !== input.ragProfileVersion ||
        existing.ragProfileDigest !== input.ragProfileDigest ||
        JSON.stringify(existingRouteOverride) !== JSON.stringify(input.routeOverride)
      ) {
        throw new AuthorityConflictError("Admission already recorded with different input_digest, RAG profile lineage, or route_override provenance.");
      }
      return {
        kind: input.kind,
        requestId: input.requestId,
        turnId: existing.turnId,
        inputDigest: existing.inputDigest,
        ragProfileVersion: existing.ragProfileVersion,
        ragProfileDigest: existing.ragProfileDigest,
        receiptDigest: existing.receiptDigest,
        ...(existingRouteOverride ? { routeOverride: existingRouteOverride } : {}),
      };
    }

    const createdAt = this.now();
    const receiptDigest = sha256Digest(`${input.kind}|${input.requestId}|${input.turnId}|${input.inputDigest}|${input.ragProfileVersion}|${input.ragProfileDigest}|${input.routeOverride ? JSON.stringify(input.routeOverride) : ""}|${createdAt}|${randomUUID()}`);
    await this.store.insertAdmission({
      requestId: input.requestId,
      kind: input.kind,
      turnId: input.turnId,
      inputDigest: input.inputDigest,
      ragProfileVersion: input.ragProfileVersion,
      ragProfileDigest: input.ragProfileDigest,
      receiptDigest,
      createdAt,
      routeOverrideJson: input.routeOverride ? JSON.stringify(input.routeOverride) : undefined,
    });
    return {
      kind: input.kind,
      requestId: input.requestId,
      turnId: input.turnId,
      inputDigest: input.inputDigest,
      ragProfileVersion: input.ragProfileVersion,
      ragProfileDigest: input.ragProfileDigest,
      receiptDigest,
      ...(input.routeOverride ? { routeOverride: input.routeOverride } : {}),
    };
  }

  async inspect(input: InspectInput): Promise<InspectResult> {
    assertNonEmptyString(input.requestId, "request_id", 128);
    assertNonEmptyString(input.subjectRef, "subject_ref");
    if (typeof input.output !== "string") throw new AuthorityValidationError("output must be a string.");
    assertDigest(input.outputDigest, "output_digest");
    if (!Array.isArray(input.sourceClassifications)) throw new AuthorityValidationError("source_classifications must be an array.");

    const decision = this.contentPolicy.evaluate({
      output: input.output,
      outputDigest: input.outputDigest,
      sourceClassifications: input.sourceClassifications,
    });
    const guardReceipt = sha256Digest(`${input.requestId}|${input.outputDigest}|${decision.allowed}|${decision.derivedClassificationRef}`);
    if (!decision.allowed) {
      return {
        requestId: input.requestId,
        outputDigest: input.outputDigest,
        allowed: false,
        guardReceipt,
        reason: decision.reason ?? "Output guard denied release.",
      };
    }
    return {
      requestId: input.requestId,
      outputDigest: input.outputDigest,
      allowed: true,
      derivedClassificationRef: decision.derivedClassificationRef,
      guardReceipt,
    };
  }

  async putBlob(input: PutBlobInput): Promise<PutBlobResult> {
    assertNonEmptyString(input.requestId, "request_id", 128);
    assertNonEmptyString(input.turnId, "turn_id", 128);
    if (typeof input.output !== "string") throw new AuthorityValidationError("output must be a string.");
    assertDigest(input.outputDigest, "output_digest");
    assertNonEmptyString(input.classificationRef, "classification_ref");
    assertNonEmptyString(input.guardReceipt, "guard_receipt");

    const computed = sha256Digest(input.output);
    if (computed !== input.outputDigest) throw new AuthorityValidationError("output_digest does not match the sha256 of output.");

    const outputRef = `blob:${input.outputDigest}`;
    const commitProof = sha256Digest(`${outputRef}|${input.outputDigest}`);

    const existing = await this.store.getOutputBlob(outputRef);
    if (existing) {
      try {
        const existingOutput = this.outputCrypto.decrypt(existing);
        if (sha256Digest(existingOutput) !== input.outputDigest) {
          throw new AuthorityConflictError("Existing output blob failed integrity verification.");
        }
      } catch (error) {
        if (error instanceof AuthorityConflictError) throw error;
        throw new AuthorityConflictError("Existing output blob failed authenticated integrity verification.");
      }
      // Blobs are content-addressed (outputRef = blob:digest). guardReceipt is per-request
      // staging correlation from the orchestrator, not part of immutable blob identity.
      if (existing.classificationRef !== input.classificationRef) {
        throw new AuthorityConflictError("Output blob already exists with a different classification.");
      }
      return { requestId: input.requestId, turnId: input.turnId, outputRef, outputDigest: input.outputDigest, commitProof: existing.commitProof };
    }

    const encrypted = this.outputCrypto.encrypt(input.output, outputRef, input.outputDigest);
    await this.store.insertOutputBlob({
      outputRef,
      outputDigest: input.outputDigest,
      ...encrypted,
      classificationRef: input.classificationRef,
      guardReceipt: input.guardReceipt,
      requestId: input.requestId,
      turnId: input.turnId,
      commitProof,
      createdAt: this.now(),
    });
    const stored = await this.store.getOutputBlob(outputRef);
    if (!stored || stored.outputDigest !== input.outputDigest || stored.classificationRef !== input.classificationRef || stored.guardReceipt !== input.guardReceipt) {
      throw new AuthorityConflictError("Output blob insert could not establish a consistent immutable record.");
    }
    try {
      if (sha256Digest(this.outputCrypto.decrypt(stored)) !== input.outputDigest) {
        throw new AuthorityConflictError("Stored output blob failed integrity verification after insert.");
      }
    } catch (error) {
      if (error instanceof AuthorityConflictError) throw error;
      throw new AuthorityConflictError("Stored output blob failed authenticated integrity verification after insert.");
    }
    return { requestId: input.requestId, turnId: input.turnId, outputRef, outputDigest: input.outputDigest, commitProof: stored.commitProof };
  }

  async verifyBlob(input: VerifyBlobInput): Promise<VerifyBlobResult> {
    assertNonEmptyString(input.outputRef, "output_ref");
    assertDigest(input.outputDigest, "output_digest");
    const row = await this.store.getOutputBlob(input.outputRef);
    if (!row) return { outputRef: input.outputRef, outputDigest: input.outputDigest, verified: false };
    try {
      const computed = sha256Digest(this.outputCrypto.decrypt(row));
      return { outputRef: input.outputRef, outputDigest: input.outputDigest, verified: computed === input.outputDigest && computed === row.outputDigest };
    } catch {
      return { outputRef: input.outputRef, outputDigest: input.outputDigest, verified: false };
    }
  }

  async repairDanglingOutput(input: RepairBlobInput): Promise<RepairBlobResult> {
    assertNonEmptyString(input.outputRef, "output_ref");
    assertDigest(input.outputDigest, "output_digest");
    const row = await this.store.getOutputBlob(input.outputRef);
    if (!row) return { outputRef: input.outputRef, outputDigest: input.outputDigest, status: "missing" };
    try {
      const computed = sha256Digest(this.outputCrypto.decrypt(row));
      if (computed !== input.outputDigest || computed !== row.outputDigest) {
        return { outputRef: input.outputRef, outputDigest: input.outputDigest, status: "corrupt" };
      }
    } catch {
      return { outputRef: input.outputRef, outputDigest: input.outputDigest, status: "corrupt" };
    }
    return { outputRef: input.outputRef, outputDigest: input.outputDigest, status: "repaired" };
  }

  async commitTerminal(input: CommitTerminalInput): Promise<CommitTerminalResult> {
    assertNonEmptyString(input.requestId, "request_id", 128);
    assertNonEmptyString(input.turnId, "turn_id", 128);
    assertNonEmptyString(input.outputRef, "output_ref");
    assertDigest(input.outputDigest, "output_digest");
    assertNonEmptyString(input.releaseFence, "release_fence");
    assertNonEmptyString(input.releaseAuditReceipt, "release_audit_receipt");

    const existing = await this.store.getTerminalCommit(input.requestId, input.turnId);
    if (existing) {
      if (
        existing.outputRef !== input.outputRef ||
        existing.outputDigest !== input.outputDigest ||
        existing.releaseFence !== input.releaseFence
      ) {
        throw new AuthorityConflictError("Terminal commit already recorded with different values.");
      }
      return {
        requestId: input.requestId,
        turnId: input.turnId,
        outputRef: existing.outputRef,
        outputDigest: existing.outputDigest,
        releaseFence: existing.releaseFence,
        committed: true,
      };
    }

    await this.store.insertTerminalCommit({
      requestId: input.requestId,
      turnId: input.turnId,
      outputRef: input.outputRef,
      outputDigest: input.outputDigest,
      releaseFence: input.releaseFence,
      releaseAuditReceipt: input.releaseAuditReceipt,
      committed: 1,
      createdAt: this.now(),
    });
    return {
      requestId: input.requestId,
      turnId: input.turnId,
      outputRef: input.outputRef,
      outputDigest: input.outputDigest,
      releaseFence: input.releaseFence,
      committed: true,
    };
  }

  async markFailed(input: MarkFailedInput): Promise<void> {
    await this.store.insertTurnFailure({
      requestId: String(input.requestId ?? ""),
      turnId: String(input.turnId ?? ""),
      code: String(input.code ?? ""),
      createdAt: this.now(),
    });
  }

  async reserve(input: ReserveInput): Promise<ReserveResult> {
    assertNonEmptyString(input.requestId, "request_id", 128);
    assertNonEmptyString(input.subjectRef, "subject_ref");
    assertNonEmptyString(input.deviceRef, "device_ref");
    assertNonEmptyString(input.applicationRef, "application_ref");
    assertNonEmptyString(input.purposeRef, "purpose_ref");
    assertNonEmptyString(input.outputRef, "output_ref");
    assertDigest(input.outputDigest, "output_digest");
    assertNonEmptyString(input.classificationRef, "classification_ref");
    if (!Array.isArray(input.sourceClassifications) || input.sourceClassifications.length === 0) {
      throw new AuthorityValidationError("source_classifications must be a non-empty array.");
    }
    assertDigest(input.resourceSetDigest, "resource_set_digest");
    assertDigest(input.lineageDigest, "lineage_digest");
    if (!Number.isFinite(input.units) || input.units <= 0) throw new AuthorityValidationError("units must be a positive number.");
    if (!Number.isFinite(input.ceiling) || input.ceiling < input.units) throw new AuthorityValidationError("ceiling must be a number at least as large as units.");

    const reservationRef = `reservation:${randomUUID()}`;
    const createdAt = this.now();
    const expiresAt = Math.min(input.expiresAt, createdAt + RESERVATION_TTL_MS);
    if (expiresAt <= createdAt) throw new AuthorityConflictError("Disclosure reservation window has already expired.");

    // The real exposure ledger — this is what makes reserve() "consult live
    // output/disclosure policy" instead of just recording a local intent.
    // Ceiling breaches, malformed lineage evidence, and reservation-id reuse
    // with different content all throw GovernanceError here and deny.
    let governanceReservation;
    try {
      governanceReservation = await Promise.resolve(this.governance.reserveDisclosure({
        reservationId: reservationRef,
        subjectRef: input.subjectRef,
        deviceRef: input.deviceRef,
        applicationRef: input.applicationRef,
        purposeRef: input.purposeRef,
        channel: "assistant-chat",
        resourceSetDigest: input.resourceSetDigest,
        sourceClassifications: input.sourceClassifications as GovernanceClassification[],
        outputDigest: input.outputDigest as `sha256:${string}`,
        lineageDigest: input.lineageDigest,
        units: input.units,
        ceiling: input.ceiling,
        terminalReceipt: input.terminalReceipt,
        expiresAt,
      }));
    } catch (error) {
      throw new AuthorityConflictError(error instanceof GovernanceError ? error.message : "Disclosure policy authority is unavailable.");
    }

    await this.store.insertDisclosureReservation({
      reservationRef,
      requestId: input.requestId,
      subjectRef: input.subjectRef,
      outputRef: input.outputRef,
      outputDigest: input.outputDigest,
      classificationRef: governanceReservation.classification,
      status: "reserved",
      releaseFence: null,
      expiresAt,
      createdAt,
    });
    return {
      requestId: input.requestId,
      outputRef: input.outputRef,
      outputDigest: input.outputDigest,
      classificationRef: governanceReservation.classification,
      reservationRef,
    };
  }

  async commitReservation(input: CommitReservationInput): Promise<CommitReservationResult> {
    assertNonEmptyString(input.reservationRef, "reservation_ref");
    assertNonEmptyString(input.outputRef, "output_ref");
    assertDigest(input.outputDigest, "output_digest");
    assertNonEmptyString(input.releaseFence, "release_fence");

    const reservation = await this.store.getDisclosureReservation(input.reservationRef);
    if (!reservation) throw new AuthorityNotFoundError("Reservation not found.");
    if (reservation.outputRef !== input.outputRef || reservation.outputDigest !== input.outputDigest) {
      throw new AuthorityConflictError("Reservation does not match the given output.");
    }
    if (reservation.status === "committed") {
      if (reservation.releaseFence !== input.releaseFence) throw new AuthorityConflictError("Committed reservation has a different release fence.");
      return {
        reservationRef: input.reservationRef,
        outputRef: input.outputRef,
        outputDigest: input.outputDigest,
        releaseFence: input.releaseFence,
        committed: true,
      };
    }
    if (reservation.expiresAt <= this.now()) throw new AuthorityConflictError("Reservation has expired.");

    // Live commit against the real exposure ledger — moves the reserved
    // units to committed, or denies if the ledger considers this
    // reservation stale/uncertain/expired even though the local mirror
    // still thought it was fine.
    try {
      await Promise.resolve(this.governance.commitDisclosure(input.reservationRef, input.outputDigest as `sha256:${string}`, input.releaseFence));
    } catch (error) {
      throw new AuthorityConflictError(error instanceof GovernanceError ? error.message : "Disclosure policy authority is unavailable.");
    }

    await this.store.commitDisclosureReservation(input.reservationRef, input.releaseFence);
    return {
      reservationRef: input.reservationRef,
      outputRef: input.outputRef,
      outputDigest: input.outputDigest,
      releaseFence: input.releaseFence,
      committed: true,
    };
  }

  async authorize(input: AuthorizeInput): Promise<AuthorizeResult> {
    if (this.productionOutputAuthorization) return this.productionOutputAuthorization.authorize(input);
    assertNonEmptyString(input.requestId, "request_id", 128);
    assertNonEmptyString(input.subjectRef, "subject_ref");
    assertNonEmptyString(input.outputRef, "output_ref");
    assertDigest(input.outputDigest, "output_digest");
    assertNonEmptyString(input.classificationRef, "classification_ref");
    assertNonEmptyString(input.disclosureReservationRef, "disclosure_reservation_ref");

    // Ownership: the caller subject must be the same subject the
    // reservation was made for. GovernanceAuthority's ledger does not carry
    // subjectRef, so this check runs against the local reservation record,
    // which is written from the same reserve() call that books the ledger
    // entry above — not a separately-trusted claim.
    const reservation = await this.store.getDisclosureReservation(input.disclosureReservationRef);
    if (!reservation) throw new AuthorityNotFoundError("Disclosure reservation not found.");
    if (reservation.subjectRef !== input.subjectRef) {
      throw new AuthorityConflictError("Caller subject does not match the disclosure reservation owner.");
    }
    if (reservation.expiresAt <= this.now()) throw new AuthorityConflictError("Disclosure reservation has expired.");
    if (reservation.outputRef !== input.outputRef || reservation.outputDigest !== input.outputDigest) {
      throw new AuthorityConflictError("Disclosure reservation does not match the given output.");
    }

    // Live policy: authorization is not granted merely because a local
    // reservation exists — commitDisclosure against the real exposure
    // ledger is called here (idempotently, if reserve()/commitReservation()
    // haven't already committed it) so a reservation the ledger has since
    // marked "uncertain" (see GovernanceAuthority.markDisclosureUncertain,
    // used when a prior release attempt's outcome was unknown) is denied
    // here even if the local mirror still shows "reserved".
    let releaseFence: string;
    if (reservation.status === "committed" && reservation.releaseFence) {
      releaseFence = reservation.releaseFence;
    } else {
      releaseFence = `fence:release:${randomUUID()}`;
      try {
        await Promise.resolve(this.governance.commitDisclosure(input.disclosureReservationRef, input.outputDigest as `sha256:${string}`, releaseFence));
      } catch (error) {
        throw new AuthorityConflictError(error instanceof GovernanceError ? error.message : "Disclosure policy authority is unavailable.");
      }
      await this.store.commitDisclosureReservation(input.disclosureReservationRef, releaseFence);
    }

    return {
      requestId: input.requestId,
      outputRef: input.outputRef,
      outputDigest: input.outputDigest,
      classificationRef: input.classificationRef,
      disclosureReservationRef: input.disclosureReservationRef,
      releaseFence,
      obligations: FIXED_OBLIGATIONS,
    };
  }
}
