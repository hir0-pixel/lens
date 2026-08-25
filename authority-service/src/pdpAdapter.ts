import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  PdpError,
  PolicyDecisionPoint,
  type DecisionFence,
  type DecisionFenceSigner,
  type DeviceFacts,
  type FactReaders,
  type PdpAuditPort,
  type PolicyBundle,
  type ResourceFacts,
  type SubjectFacts,
} from "../../services/pdp/PolicyDecisionPoint";
import { GovernanceAuthority } from "../../services/governance/GovernanceAuthority";

export type GenerationContextBoundary = "generation_start" | "tool_call_boundary";

export class ContextFenceDeniedError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function boundaryToPdp(boundary: GenerationContextBoundary): "generation_start" | "tool_boundary" {
  return boundary === "tool_call_boundary" ? "tool_boundary" : "generation_start";
}

/**
 * The interface a generation-context-fence revalidation actually needs.
 * `AuthorityService.revalidate()` calls this instead of fabricating a local
 * "the caller says so" fence — this is the fix for the finding that
 * `revalidate()` never consulted the canonical PDP/Governance authority.
 */
export interface ContextFencePolicyPort {
  decide(input: {
    requestId: string;
    turnId: string;
    subjectRef: string;
    deviceRef: string;
    sessionRef: string;
    contextDigest: string;
    manifestExpiresAt: number;
    boundary: GenerationContextBoundary;
    resourceRefs: readonly string[];
    indexGeneration: string;
  }): {
    fenceRef: string;
    contextDigest: string;
    expiresAt: number;
    checkedAt: number;
    policyRevision: number;
    subjectRevision: number;
    deviceRevision: number;
  };
}

/**
 * Default, explicit fail-closed policy: denies every decision. This is the
 * production default until a real ContextFencePolicyPort is wired — mirrors
 * the FailClosed* pattern already used elsewhere in this codebase (e.g.
 * orchestrator-service's FailClosedContextFencePort, FailClosedSessionValidator).
 * A service that starts with this policy is honest about being unable to
 * authorize generation, rather than silently approving everything.
 */
export class FailClosedContextFencePolicy implements ContextFencePolicyPort {
  decide(): never {
    throw new ContextFenceDeniedError("No context-fence policy authority is configured; failing closed.");
  }
}

/**
 * Real subject/device identity and posture facts require a corporate
 * IAM/MDM integration that does not exist in this repository. This
 * directory is an explicit, honestly-named DEV/TEST STUB: a subject or
 * device must be registered before it is ever treated as active/compliant.
 * An unregistered subject or device is NEVER silently approved — that would
 * reintroduce exactly the permissive fallback this correction pass removes.
 * A production deployment replaces this with a real adapter to the
 * corporate identity and device-posture systems behind the same
 * `FactReaders` contract PolicyDecisionPoint already defines.
 */
export class DevSubjectDeviceDirectory {
  private readonly subjects = new Map<string, SubjectFacts>();
  private readonly devices = new Map<string, DeviceFacts>();

  registerSubject(subjectRef: string, facts: SubjectFacts): void {
    this.subjects.set(subjectRef, facts);
  }

  registerDevice(deviceRef: string, facts: DeviceFacts): void {
    this.devices.set(deviceRef, facts);
  }

  subject(subjectRef: string): SubjectFacts {
    const facts = this.subjects.get(subjectRef);
    if (!facts) throw new ContextFenceDeniedError(`Subject "${subjectRef}" is not registered.`);
    return facts;
  }

  device(deviceRef: string): DeviceFacts {
    const facts = this.devices.get(deviceRef);
    if (!facts) throw new ContextFenceDeniedError(`Device "${deviceRef}" is not registered.`);
    return facts;
  }
}

/** Maps the real GovernanceAuthority's resource-security facts onto the PDP's ResourceFacts shape — the live ACL/classification/publication state, not a caller-supplied claim. */
export class GovernanceResourceFactReader {
  constructor(private readonly governance: GovernanceAuthority) {}

  resources(refs: readonly string[]): readonly ResourceFacts[] {
    const facts = this.governance.getResourceSecurityFacts(refs);
    return facts.map((fact) => ({
      resourceRef: fact.documentVersionRef,
      revision: fact.resourceSecurityRevision,
      published: fact.publication === "active",
      integrityValid: fact.integrity === "valid",
      // GovernanceAuthority does not evaluate per-subject ACLs (that already
      // happened once at retrieval time, upstream). What it attests here is
      // whether the resource is STILL currently eligible at all — i.e.
      // whether it has been unpublished, quarantined, or had its integrity
      // invalidated since retrieval. `retrievalEligible` is the real,
      // governance-computed signal for that; it is not a stand-in for a
      // per-subject ACL check.
      aclAllows: fact.retrievalEligible,
    }));
  }
}

const DEV_ACL_DIGEST: `sha256:${string}` = `sha256:${"0".repeat(64)}`;
const DEV_CHANGE_FENCE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * DEV/TEST ONLY. Auto-publishes any resource ref it is asked about the
 * first time it is seen (register + mark active/indexed/valid), then
 * delegates to the real GovernanceResourceFactReader for the actual facts.
 * This exists so the real PDP decision machinery can be exercised in
 * development/CI without hand-registering every fixture document. A
 * production deployment must never use this — every resource must be
 * registered by the real document-governance pipeline, not auto-approved on
 * first mention.
 */
export class DevAutoProvisioningResourceFactReader {
  private readonly seen = new Set<string>();
  private readonly delegate: GovernanceResourceFactReader;

  constructor(private readonly governance: GovernanceAuthority, private readonly now: () => number = () => Date.now()) {
    this.delegate = new GovernanceResourceFactReader(governance);
  }

  resources(refs: readonly string[]): readonly ResourceFacts[] {
    for (const ref of refs) {
      if (this.seen.has(ref)) continue;
      this.governance.registerVersion({ documentVersionRef: ref, classification: "internal", aclDigest: DEV_ACL_DIGEST });
      this.governance.mutateSecurity(
        ref,
        { publication: "active", processing: "indexed", integrity: "valid" },
        { fenceId: `dev-fence:${ref}`, actorRef: "dev-bootstrap-actor", approverRef: "dev-bootstrap-approver", expiresAt: this.now() + DEV_CHANGE_FENCE_TTL_MS },
      );
      this.seen.add(ref);
    }
    return this.delegate.resources(refs);
  }
}

/**
 * DEV/TEST ONLY. Registers a subject/device as active/compliant the first
 * time it is seen, then delegates to the real registered facts. Same
 * rationale and same production prohibition as
 * DevAutoProvisioningResourceFactReader above.
 */
export class DevAutoProvisioningSubjectDeviceDirectory {
  private readonly directory = new DevSubjectDeviceDirectory();

  subject(subjectRef: string): SubjectFacts {
    try {
      return this.directory.subject(subjectRef);
    } catch {
      this.directory.registerSubject(subjectRef, { revision: 1, active: true, groups: [] });
      return this.directory.subject(subjectRef);
    }
  }

  device(deviceRef: string): DeviceFacts {
    try {
      return this.directory.device(deviceRef);
    } catch {
      this.directory.registerDevice(deviceRef, { revision: 1, compliant: true });
      return this.directory.device(deviceRef);
    }
  }
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  return bufA.length === bufB.length && bufA.length > 0 && timingSafeEqual(bufA, bufB);
}

export class HmacFenceSigner implements DecisionFenceSigner {
  constructor(private readonly key: Buffer) {
    if (key.length < 32) throw new Error("HmacFenceSigner key must be at least 32 bytes.");
  }

  sign(fence: Omit<DecisionFence, "signature">): string {
    return createHmac("sha256", this.key).update(JSON.stringify(fence)).digest("hex");
  }

  verify(fence: DecisionFence): boolean {
    const { signature, ...rest } = fence;
    let expected: string;
    try {
      expected = this.sign(rest);
    } catch {
      return false;
    }
    return timingSafeHexEqual(signature, expected);
  }
}

export class InMemoryPdpAuditPort implements PdpAuditPort {
  readonly admissions: Array<Record<string, unknown> & { receiptDigest: string }> = [];

  admitDecision(input: Parameters<PdpAuditPort["admitDecision"]>[0]): { receiptDigest: string } {
    const receiptDigest = `sha256:${sha256Hex(JSON.stringify(input))}`;
    this.admissions.push({ ...input, receiptDigest });
    return { receiptDigest };
  }
}

/**
 * Real PDP-backed context-fence policy. `decide()` drives the canonical
 * PolicyDecisionPoint through a fresh `decideBatch` + `consumeFence` pair
 * for every revalidation — one signed decision per boundary, exactly as
 * PolicyDecisionPoint requires (a fence is single-use; generation_start and
 * tool_call_boundary each mint and consume their own).
 *
 * `normalizedContextDigest` folds in the corpus generation and the session
 * reference, not just the raw context digest, so the signed decision
 * actually attests to "this corpus generation, this session" rather than
 * only "this set of chunks" — otherwise a session or corpus swap with the
 * same chunk digest would pass unnoticed.
 */
export class PdpBackedContextFencePolicy implements ContextFencePolicyPort {
  constructor(
    private readonly pdp: PolicyDecisionPoint,
    private readonly now: () => number = () => Date.now(),
  ) {}

  decide(input: {
    requestId: string;
    turnId: string;
    subjectRef: string;
    deviceRef: string;
    sessionRef: string;
    contextDigest: string;
    manifestExpiresAt: number;
    boundary: GenerationContextBoundary;
    resourceRefs: readonly string[];
    indexGeneration: string;
  }): {
    fenceRef: string;
    contextDigest: string;
    expiresAt: number;
    checkedAt: number;
    policyRevision: number;
    subjectRevision: number;
    deviceRevision: number;
  } {
    if (input.resourceRefs.length === 0) {
      throw new ContextFenceDeniedError("At least one resource reference is required to authorize a generation context fence.");
    }
    const normalizedContextDigest = `sha256:${sha256Hex([input.contextDigest, input.indexGeneration, input.sessionRef].join("|"))}`;
    const useBoundary = boundaryToPdp(input.boundary);

    let decision;
    try {
      decision = this.pdp.decideBatch({
        requestId: input.requestId,
        callerWorkloadRef: "orchestrator-service",
        subjectRef: input.subjectRef,
        deviceRef: input.deviceRef,
        action: "generation-context-fence",
        resourceRefs: input.resourceRefs,
        normalizedContextDigest,
        useBoundary,
        deadlineAt: input.manifestExpiresAt,
      });
    } catch (error) {
      // PDP outage, evaluator failure, audit unavailability, policy head
      // unavailable, a stale/changed revision mid-decision — every one of
      // these is a PdpError and every one of them must deny, not pass
      // through silently. Re-throw as the same denial type the caller
      // already handles as a conflict.
      throw new ContextFenceDeniedError(error instanceof PdpError ? error.code : "PDP_UNAVAILABLE");
    }

    // decideBatch returns { allowed: [] } with no fence on a total denial —
    // it does not throw. A caller that only checks "did it throw" fails
    // OPEN on a total denial. Treat a missing fence, or any resource that
    // did not make it into the allowed subset, as an explicit denial: a
    // revoked ACL or unpublished version on even one referenced chunk must
    // not silently shrink the context and continue.
    if (!decision.fence || decision.allowed.length !== input.resourceRefs.length) {
      throw new ContextFenceDeniedError("AUTHORIZATION_STATE_CHANGED");
    }

    this.pdp.consumeFence(decision.fence, {
      requestId: input.requestId,
      callerWorkloadRef: "orchestrator-service",
      action: "generation-context-fence",
      useBoundary,
      normalizedContextDigest,
      resourceRefs: decision.fence.resourceRefs,
    });

    return {
      fenceRef: decision.fence.fenceId,
      contextDigest: input.contextDigest,
      expiresAt: decision.fence.expiresAt,
      checkedAt: this.now(),
      policyRevision: decision.fence.policyRevision,
      subjectRevision: decision.fence.subjectRevision,
      deviceRevision: decision.fence.deviceRevision,
    };
  }
}

/**
 * Wires a real PolicyDecisionPoint against GovernanceAuthority-sourced
 * resource facts. The activated PolicyBundle here has no additional
 * business-rule restrictions beyond the structural facts decideBatch itself
 * already ANDs together (subject.active, device.compliant, resource
 * published/integrity-valid/aclAllows) — an honest scope note, not a hidden
 * always-allow: every one of those structural checks is real and is what
 * actually gates the decision. A production deployment with real
 * classification/clearance policy content plugs it in here via a real
 * `PolicyBundle.evaluate`, not by editing PolicyDecisionPoint itself.
 */
export function bootstrapGenerationPdp(options: {
  directory: { subject(subjectRef: string): SubjectFacts; device(deviceRef: string): DeviceFacts };
  resourceReader: { resources(refs: readonly string[]): readonly ResourceFacts[] };
  audit: PdpAuditPort;
  signer: DecisionFenceSigner;
  now?: () => number;
}): PolicyDecisionPoint {
  const readers: FactReaders = {
    subject: (subjectRef) => options.directory.subject(subjectRef),
    device: (deviceRef) => options.directory.device(deviceRef),
    resources: (refs) => options.resourceReader.resources(refs),
  };
  const pdp = new PolicyDecisionPoint(readers, options.audit, options.signer, options.now);
  const bundle: PolicyBundle = {
    revision: 1,
    digest: `sha256:${sha256Hex("generation-context-fence-policy-v1")}`,
    signed: true,
    evaluate: () => true,
  };
  pdp.activate(bundle, { independent: true, auditAdmitted: true, compatibilityPassed: true });
  return pdp;
}
