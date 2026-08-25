/**
 * A dedicated authority for `AuthorizeGenerate` and `AuthorizeModelUse` (Doc 004 §23 / the
 * "REAL TOP-LEVEL AUTHORIZATION" / "LIVE MODEL-USE AUTHORIZATION" requirements). Deliberately
 * NOT bolted onto `PolicyDecisionPoint.decideBatch`: that API's `resourceRefs`/`ResourceFacts`
 * shape (`published`/`integrityValid`/`aclAllows`) is document-ACL-oriented, and overloading a
 * model_ref into a `resourceRef` to reuse it would be exactly the "mapped onto different
 * semantics" pattern this repository has already been corrected for once (see
 * `groundingPolicy.ts`'s history). This authority has its own subject/device fact reader and
 * its own model-eligibility check (delegating to `ModelEligibilityCheckPort` — the same real,
 * per-capability-gated registry check `ModelGateway` uses), and issues the same
 * `AuthorityReceipt` shape every other shared authority in this repository issues, so
 * `ModelGateway` verifies all of them through one contract, not five.
 */
import type { SubjectFacts, DeviceFacts } from "./PolicyDecisionPoint";
import { AuthorityReceiptIssuer, type AuthorityReceiptInput, type SignedAuthorityReceipt } from "../security/authorityReceipt";

export type ModelUseAuthorityFailure = "SUBJECT_INACTIVE" | "DEVICE_NONCOMPLIANT" | "MODEL_INELIGIBLE" | "AUTHORITY_UNAVAILABLE" | "STALE_REVISION" | "REPLAYED";
export class ModelUseAuthorityError extends Error {
  constructor(readonly code: ModelUseAuthorityFailure, message: string) {
    super(message);
  }
}

export interface AuthorizeGenerateInput {
  requestId: string;
  requestDigest: `sha256:${string}`;
  subjectRef: string;
  deviceRef: string;
  sessionRef: string;
  applicationRef: string;
  workspaceRef: string;
  purposeRef: string;
  requestClass: string;
  deadlineAt: number;
}

export interface AuthorizeModelUseInput {
  requestId: string;
  turnId: string;
  stepId: string;
  stepClass: "route" | "final_generation" | "tool";
  requestDigest: `sha256:${string}`;
  modelRef: string;
  artifactDigest: `sha256:${string}`;
  capability: string;
  subjectRef: string;
  applicationRef: string;
  workspaceRef: string;
  purposeRef: string;
  requestClass: string;
  deadlineAt: number;
}

/** The model-eligibility check this authority delegates to — the same real registry check `ModelGateway` performs, so a model that would fail dispatch cannot receive a valid AuthorizeModelUse receipt in the first place. */
export interface ModelEligibilityForAuthority {
  resolveEndpoint(input: { capability: string; artifactDigest: string; denyEpoch: number }): Promise<{ endpointRef: string; snapshotExpiresAt: number; external: boolean }>;
  currentDenyEpoch(): number;
}

export interface ModelUseAuthorityPort {
  authorizeGenerate(input: AuthorizeGenerateInput, signal: AbortSignal): Promise<SignedAuthorityReceipt>;
  authorizeModelUse(input: AuthorizeModelUseInput, signal: AbortSignal): Promise<SignedAuthorityReceipt>;
}

/** Production default when no real authority is wired: fails closed on every call. */
export class FailClosedModelUseAuthorityPort implements ModelUseAuthorityPort {
  async authorizeGenerate(): Promise<SignedAuthorityReceipt> {
    throw new ModelUseAuthorityError("AUTHORITY_UNAVAILABLE", "No AuthorizeGenerate authority is configured.");
  }
  async authorizeModelUse(): Promise<SignedAuthorityReceipt> {
    throw new ModelUseAuthorityError("AUTHORITY_UNAVAILABLE", "No AuthorizeModelUse authority is configured.");
  }
}

export interface SubjectDeviceFactReaders {
  subject(subjectRef: string): SubjectFacts;
  device(deviceRef: string): DeviceFacts;
}

/**
 * Real implementation: checks subject/device liveness facts, checks model eligibility for the
 * EXACT requested capability (not "routable for something"), and issues a signed, expiring,
 * single-use `AuthorityReceipt` bound to every field the caller supplied. `revision` binds the
 * subject/device facts revision at issuance, so a later fact change makes the receipt's
 * `revision` stale relative to a fresh check — callers that need liveness re-verified at
 * consumption time (not just signature/expiry) should re-derive `subject()`/`device()` and
 * compare, the same discipline `PolicyDecisionPoint.decideBatch` already applies.
 */
export class SubjectDeviceModelUseAuthority implements ModelUseAuthorityPort {
  constructor(
    private readonly readers: SubjectDeviceFactReaders,
    private readonly modelEligibility: ModelEligibilityForAuthority,
    private readonly issuer: AuthorityReceiptIssuer,
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs = 5_000,
  ) {}

  async authorizeGenerate(input: AuthorizeGenerateInput, signal: AbortSignal): Promise<SignedAuthorityReceipt> {
    if (signal.aborted) throw new ModelUseAuthorityError("AUTHORITY_UNAVAILABLE", "The request was cancelled.");
    if (!input.subjectRef || !input.deviceRef) throw new ModelUseAuthorityError("AUTHORITY_UNAVAILABLE", "subjectRef and deviceRef are required.");
    if (input.deadlineAt <= this.now()) throw new ModelUseAuthorityError("AUTHORITY_UNAVAILABLE", "The request deadline has already elapsed.");
    const subject = this.safeSubject(input.subjectRef);
    const device = this.safeDevice(input.deviceRef);
    if (!subject.active) throw new ModelUseAuthorityError("SUBJECT_INACTIVE", "The subject is not active.");
    if (!device.compliant) throw new ModelUseAuthorityError("DEVICE_NONCOMPLIANT", "The device is not compliant.");

    const claims: AuthorityReceiptInput = {
      purpose: "authorize_generate",
      issuer: "authority-model-use",
      requestId: input.requestId,
      subjectRef: input.subjectRef,
      deviceRef: input.deviceRef,
      sessionRef: input.sessionRef,
      applicationRef: input.applicationRef,
      workspaceRef: input.workspaceRef,
      purposeRef: input.purposeRef,
      requestClass: input.requestClass,
      boundDigest: input.requestDigest,
      revision: subject.revision + device.revision,
    };
    return this.issuer.issue(claims, this.ttlMs);
  }

  async authorizeModelUse(input: AuthorizeModelUseInput, signal: AbortSignal): Promise<SignedAuthorityReceipt> {
    if (signal.aborted) throw new ModelUseAuthorityError("AUTHORITY_UNAVAILABLE", "The request was cancelled.");
    if (input.deadlineAt <= this.now()) throw new ModelUseAuthorityError("AUTHORITY_UNAVAILABLE", "The request deadline has already elapsed.");
    const subject = this.safeSubject(input.subjectRef);
    if (!subject.active) throw new ModelUseAuthorityError("SUBJECT_INACTIVE", "The subject is not active.");

    try {
      await this.modelEligibility.resolveEndpoint({
        capability: input.capability,
        artifactDigest: input.artifactDigest,
        denyEpoch: this.modelEligibility.currentDenyEpoch(),
      });
    } catch {
      throw new ModelUseAuthorityError("MODEL_INELIGIBLE", `Model ${input.modelRef} is not eligible for capability ${input.capability}.`);
    }

    const claims: AuthorityReceiptInput = {
      purpose: "authorize_model_use",
      issuer: "authority-model-use",
      requestId: input.requestId,
      turnId: input.turnId,
      stepId: input.stepId,
      stepClass: input.stepClass,
      modelRef: input.modelRef,
      artifactDigest: input.artifactDigest,
      capability: input.capability,
      subjectRef: input.subjectRef,
      applicationRef: input.applicationRef,
      workspaceRef: input.workspaceRef,
      purposeRef: input.purposeRef,
      requestClass: input.requestClass,
      boundDigest: input.requestDigest,
      revision: subject.revision + this.modelEligibility.currentDenyEpoch(),
    };
    return this.issuer.issue(claims, this.ttlMs);
  }

  private safeSubject(subjectRef: string): SubjectFacts {
    try {
      return this.readers.subject(subjectRef);
    } catch {
      throw new ModelUseAuthorityError("AUTHORITY_UNAVAILABLE", "Subject facts are unavailable.");
    }
  }

  private safeDevice(deviceRef: string): DeviceFacts {
    try {
      return this.readers.device(deviceRef);
    } catch {
      throw new ModelUseAuthorityError("AUTHORITY_UNAVAILABLE", "Device facts are unavailable.");
    }
  }
}
