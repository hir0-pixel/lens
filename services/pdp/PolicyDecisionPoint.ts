import { randomBytes } from "node:crypto";
export type PdpFailure =
  | "POLICY_HEAD_UNAVAILABLE"
  | "BATCH_LIMIT_EXCEEDED"
  | "AUTHORITY_UNAVAILABLE"
  | "AUTHORIZATION_STATE_CHANGED"
  | "EVALUATOR_FAILURE"
  | "AUDIT_UNAVAILABLE"
  | "FENCE_INVALID";

export class PdpError extends Error { constructor(readonly code: PdpFailure) { super(code); } }
export interface SubjectFacts { revision: number; active: boolean; groups: readonly string[]; }
export interface DeviceFacts { revision: number; compliant: boolean; }
export interface ResourceFacts { resourceRef: string; revision: number; published: boolean; integrityValid: boolean; aclAllows: boolean; }
export interface FactReaders { subject(subjectRef: string): SubjectFacts; device(deviceRef: string): DeviceFacts; resources(refs: readonly string[]): readonly ResourceFacts[]; revisionHead?(input: { subjectRef: string; deviceRef: string; resourceRefs: readonly string[] }): string; }
export interface PdpAuditPort { admitDecision(input: { decisionId: string; requestId: string; callerWorkloadRef: string; action: string; candidateDigest: string; allowedDigest: string; revisionDigest: string; policyRevision: number; policyDigest: string; allowedCount: number }): { receiptDigest: string }; }
export interface PolicyBundle { revision: number; digest: string; signed: boolean; evaluate(input: { subject: SubjectFacts; device: DeviceFacts; resource: ResourceFacts; action: string }): boolean; }
export interface DecisionFence { fenceId: string; decisionId: string; requestId: string; callerWorkloadRef: string; action: string; useBoundary: "operation" | "generation_start" | "tool_boundary"; intentDigest: string; resourceRefs: readonly string[]; candidateDigest: string; policyRevision: number; policyDigest: string; subjectRevision: number; deviceRevision: number; resourceRevisionDigest: string; auditReceipt: string; issuedAt: number; expiresAt: number; signature: string; }
export interface DecisionFenceSigner { sign(fence: Omit<DecisionFence, "signature">): string; verify(fence: DecisionFence): boolean; }

/** Sole authorization authority. Caller claims never participate in evaluation. */
export class PolicyDecisionPoint {
  private active?: PolicyBundle; private readonly consumedFences = new Set<string>();
  constructor(private readonly readers: FactReaders, private readonly audit: PdpAuditPort, private readonly signer: DecisionFenceSigner, private readonly now = () => Date.now(), private readonly nextFence = () => `pdp-fence-${randomBytes(8).toString("hex")}`) {}
  activate(bundle: PolicyBundle, approval: { independent: boolean; auditAdmitted: boolean; compatibilityPassed: boolean }): void { if (!bundle.signed || !approval.independent || !approval.auditAdmitted || !approval.compatibilityPassed) throw new PdpError("POLICY_HEAD_UNAVAILABLE"); this.active = Object.freeze({ ...bundle }); }
  decideBatch(input: { requestId: string; callerWorkloadRef: string; subjectRef: string; deviceRef: string; action: string; resourceRefs: readonly string[]; normalizedContextDigest: string; useBoundary?: "operation" | "generation_start" | "tool_boundary"; deadlineAt: number }): { allowed: readonly string[]; fence?: DecisionFence } {
    if (!this.active) throw new PdpError("POLICY_HEAD_UNAVAILABLE"); if (input.resourceRefs.length === 0 || input.resourceRefs.length > 1000) throw new PdpError("BATCH_LIMIT_EXCEEDED"); if (input.deadlineAt <= this.now()) throw new PdpError("AUTHORITY_UNAVAILABLE");
    const policy = this.active;
    const candidateDigest = input.resourceRefs.join("|");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = this.readers.revisionHead?.({ subjectRef: input.subjectRef, deviceRef: input.deviceRef, resourceRefs: input.resourceRefs });
      const subject = this.readers.subject(input.subjectRef); const device = this.readers.device(input.deviceRef); const resources = this.readers.resources(input.resourceRefs);
      if (resources.length !== input.resourceRefs.length || resources.some((resource, index) => resource.resourceRef !== input.resourceRefs[index])) throw new PdpError("AUTHORITY_UNAVAILABLE");
      const revisionDigest = `${subject.revision}:${device.revision}:${resources.map((resource) => `${resource.resourceRef}@${resource.revision}`).join("|")}`;
      const after = this.readers.revisionHead?.({ subjectRef: input.subjectRef, deviceRef: input.deviceRef, resourceRefs: input.resourceRefs });
      if ((before !== undefined && before !== after) || this.active !== policy) { if (attempt === 0) continue; throw new PdpError("AUTHORIZATION_STATE_CHANGED"); }
      let allowed: string[];
      try { allowed = resources.filter((resource) => subject.active && device.compliant && resource.published && resource.integrityValid && resource.aclAllows && policy.evaluate({ subject, device, resource, action: input.action })).map((resource) => resource.resourceRef); } catch { throw new PdpError("EVALUATOR_FAILURE"); }
      const fenceId = this.nextFence(); const decisionId = `decision:${fenceId}`;
      let audit: { receiptDigest: string };
      try { audit = this.audit.admitDecision({ decisionId, requestId: input.requestId, callerWorkloadRef: input.callerWorkloadRef, action: input.action, candidateDigest, allowedDigest: allowed.join("|"), revisionDigest, policyRevision: policy.revision, policyDigest: policy.digest, allowedCount: allowed.length }); } catch { throw new PdpError("AUDIT_UNAVAILABLE"); }
      if (allowed.length === 0) return { allowed };
      const issuedAt = this.now();
      const unsignedFence = { fenceId, decisionId, requestId: input.requestId, callerWorkloadRef: input.callerWorkloadRef, action: input.action, useBoundary: input.useBoundary ?? "operation", intentDigest: input.normalizedContextDigest, resourceRefs: allowed, candidateDigest, policyRevision: policy.revision, policyDigest: policy.digest, subjectRevision: subject.revision, deviceRevision: device.revision, resourceRevisionDigest: revisionDigest, auditReceipt: audit.receiptDigest, issuedAt, expiresAt: input.deadlineAt };
      return { allowed, fence: { ...unsignedFence, signature: this.signer.sign(unsignedFence) } };
    }
    throw new PdpError("AUTHORIZATION_STATE_CHANGED");
  }
  consumeFence(fence: DecisionFence, input: { requestId: string; callerWorkloadRef: string; action: string; useBoundary: "operation" | "generation_start" | "tool_boundary"; normalizedContextDigest: string; resourceRefs: readonly string[] }): void { if (!this.signer.verify(fence) || fence.expiresAt <= this.now() || fence.requestId !== input.requestId || fence.callerWorkloadRef !== input.callerWorkloadRef || fence.action !== input.action || fence.useBoundary !== input.useBoundary || fence.intentDigest !== input.normalizedContextDigest || fence.resourceRefs.join("|") !== input.resourceRefs.join("|") || this.consumedFences.has(fence.fenceId)) throw new PdpError("FENCE_INVALID"); this.consumedFences.add(fence.fenceId); }
}
