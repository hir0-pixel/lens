export type AdmissionDenial =
  | "artifact-digest-invalid"
  | "artifact-reference-mutable"
  | "evidence-artifact-mismatch"
  | "evidence-expired"
  | "evidence-stale"
  | "attestation-invalid"
  | "lease-invalid"
  | "crypto-profile-unsupported"
  | "evidence-verification-failed";

export interface LeaseReference {
  leaseId: string;
  workloadId: string;
  audience: string;
  expiresAt: string;
}

export interface AdmissionEvidence {
  schemaVersion: "1.0.0";
  artifactDigest: `sha256:${string}`;
  provenanceDigest: `sha256:${string}`;
  cryptoProfile: { id: string; epoch: number };
  workloadAttestation: {
    workloadId: string;
    audience: string;
    expiresAt: string;
  };
  identityLease: LeaseReference;
  secretLease: LeaseReference;
  verifiedAt: string;
  expiresAt: string;
}

export interface AdmissionRequest {
  artifactReference: string;
  artifactDigest: `sha256:${string}`;
  workloadId: string;
  audience: string;
  evidence: AdmissionEvidence;
}

export interface EvidenceVerifier {
  verify(evidence: AdmissionEvidence): Promise<boolean>;
}

export type AdmissionDecision =
  | { admitted: true; identityLease: LeaseReference; secretLease: LeaseReference }
  | { admitted: false; reason: AdmissionDenial };

const DIGEST = /^sha256:[a-f0-9]{64}$/;

function isActiveAt(iso: string, now: Date): boolean {
  const instant = new Date(iso);
  return !Number.isNaN(instant.valueOf()) && instant > now;
}

function validLease(
  lease: LeaseReference,
  workloadId: string,
  audience: string,
  now: Date,
  maxLeaseMs: number,
): boolean {
  const expiry = new Date(lease.expiresAt);
  return (
    Boolean(lease.leaseId) &&
    lease.workloadId === workloadId &&
    lease.audience === audience &&
    isActiveAt(lease.expiresAt, now) &&
    expiry.valueOf() - now.valueOf() <= maxLeaseMs
  );
}

/**
 * Verifies the authorities' admission inputs. It never signs evidence, issues a
 * credential, or falls back to a local allow decision.
 */
export class SecureDeliveryAdmissionClient {
  constructor(
    private readonly verifier: EvidenceVerifier,
    private readonly options: {
      now?: () => Date;
      maxEvidenceAgeMs?: number;
      maxLeaseMs?: number;
      supportedCryptoProfiles: ReadonlySet<string>;
      minimumCryptoEpoch: number;
    },
  ) {}

  async admit(request: AdmissionRequest): Promise<AdmissionDecision> {
    const now = this.options.now?.() ?? new Date();
    const maxEvidenceAgeMs = this.options.maxEvidenceAgeMs ?? 5 * 60_000;
    const maxLeaseMs = this.options.maxLeaseMs ?? 15 * 60_000;
    const { evidence } = request;

    if (!DIGEST.test(request.artifactDigest)) {
      return { admitted: false, reason: "artifact-digest-invalid" };
    }
    if (request.artifactReference !== request.artifactDigest) {
      return { admitted: false, reason: "artifact-reference-mutable" };
    }
    if (evidence.artifactDigest !== request.artifactDigest) {
      return { admitted: false, reason: "evidence-artifact-mismatch" };
    }
    if (!isActiveAt(evidence.expiresAt, now)) {
      return { admitted: false, reason: "evidence-expired" };
    }
    const verifiedAt = new Date(evidence.verifiedAt);
    if (
      Number.isNaN(verifiedAt.valueOf()) ||
      now.valueOf() - verifiedAt.valueOf() > maxEvidenceAgeMs ||
      verifiedAt > now
    ) {
      return { admitted: false, reason: "evidence-stale" };
    }
    if (
      evidence.workloadAttestation.workloadId !== request.workloadId ||
      evidence.workloadAttestation.audience !== request.audience ||
      !isActiveAt(evidence.workloadAttestation.expiresAt, now)
    ) {
      return { admitted: false, reason: "attestation-invalid" };
    }
    if (
      !validLease(evidence.identityLease, request.workloadId, request.audience, now, maxLeaseMs) ||
      !validLease(evidence.secretLease, request.workloadId, request.audience, now, maxLeaseMs)
    ) {
      return { admitted: false, reason: "lease-invalid" };
    }
    if (
      !this.options.supportedCryptoProfiles.has(evidence.cryptoProfile.id) ||
      evidence.cryptoProfile.epoch < this.options.minimumCryptoEpoch
    ) {
      return { admitted: false, reason: "crypto-profile-unsupported" };
    }

    try {
      if (!(await this.verifier.verify(evidence))) {
        return { admitted: false, reason: "evidence-verification-failed" };
      }
    } catch {
      return { admitted: false, reason: "evidence-verification-failed" };
    }

    return {
      admitted: true,
      identityLease: evidence.identityLease,
      secretLease: evidence.secretLease,
    };
  }
}
