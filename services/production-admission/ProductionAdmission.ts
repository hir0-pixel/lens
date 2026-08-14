export type EvidenceKind = "capacity" | "failure_domain" | "dr" | "slo" | "security" | "compatibility";
export interface Evidence { kind: EvidenceKind; digest: `sha256:${string}`; targetDigest: `sha256:${string}`; passed: boolean; expiresAt: number; signerRef: string; }
export interface ReadinessManifest { manifestDigest: `sha256:${string}`; targetDigest: `sha256:${string}`; phase: "pilot" | "production"; evidence: readonly Evidence[]; reviewerRefs: readonly string[]; }
export class ProductionAdmissionError extends Error { constructor(readonly code: "EVIDENCE_MISSING" | "EVIDENCE_INVALID" | "TARGET_MISMATCH") { super(code); } }

/** Validates domain-owner evidence; it cannot waive or author any domain result. */
export class ProductionAdmission {
  constructor(private readonly now = () => Date.now()) {}
  admit(manifest: ReadinessManifest, targetDigest: `sha256:${string}`): { admissionRef: string; manifestDigest: string } {
    if (manifest.phase !== "production" || manifest.targetDigest !== targetDigest) throw new ProductionAdmissionError("TARGET_MISMATCH");
    const required: EvidenceKind[] = ["capacity", "failure_domain", "dr", "slo", "security", "compatibility"];
    if (required.some((kind) => !manifest.evidence.some((evidence) => evidence.kind === kind))) throw new ProductionAdmissionError("EVIDENCE_MISSING");
    if (manifest.reviewerRefs.length < 2 || manifest.evidence.some((evidence) => !evidence.digest || evidence.targetDigest !== targetDigest || !evidence.passed || evidence.expiresAt <= this.now() || !evidence.signerRef)) throw new ProductionAdmissionError("EVIDENCE_INVALID");
    return { admissionRef: `production-admission:${manifest.manifestDigest}`, manifestDigest: manifest.manifestDigest };
  }
}
