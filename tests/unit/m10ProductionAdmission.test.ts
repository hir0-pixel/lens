import { describe, expect, it } from "vitest";
import { ProductionAdmission, ProductionAdmissionError, type EvidenceKind, type ReadinessManifest } from "../../services/production-admission/ProductionAdmission";
const digest = (value: string) => `sha256:${value}` as const;
const target = digest("target");
const manifest = (overrides: Partial<ReadinessManifest> = {}): ReadinessManifest => ({ manifestDigest: digest("manifest"), targetDigest: target, phase: "production", reviewerRefs: ["security", "sre"], evidence: (["capacity", "failure_domain", "dr", "slo", "security", "compatibility"] as EvidenceKind[]).map((kind) => ({ kind, digest: digest(kind), targetDigest: target, passed: true, expiresAt: 2_000, signerRef: `${kind}-owner` })), ...overrides });
describe("M10 production admission", () => {
  it("admits only an exact, current, independently reviewed production manifest", () => expect(new ProductionAdmission(() => 1_000).admit(manifest(), target).admissionRef).toContain("production-admission"));
  it("fails closed for missing, stale, failed, or target-mismatched evidence", () => { const admission = new ProductionAdmission(() => 1_000); expect(() => admission.admit(manifest({ evidence: manifest().evidence.slice(1) }), target)).toThrow(ProductionAdmissionError); expect(() => admission.admit(manifest({ evidence: manifest().evidence.map((e) => ({ ...e, expiresAt: 1_000 })) }), target)).toThrow("EVIDENCE_INVALID"); expect(() => admission.admit(manifest(), digest("other"))).toThrow("TARGET_MISMATCH"); });
});
