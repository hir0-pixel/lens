import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  SecureDeliveryAdmissionClient,
  type AdmissionEvidence,
} from "../../libs/security-envelope";
import { createGovernedReference, TelemetryCollector } from "../../platform/observability";

const now = new Date("2026-08-14T12:00:00.000Z");
const digest = `sha256:${"a".repeat(64)}` as const;

function evidence(overrides: Partial<AdmissionEvidence> = {}): AdmissionEvidence {
  return {
    schemaVersion: "1.0.0",
    artifactDigest: digest,
    provenanceDigest: digest,
    cryptoProfile: { id: "crypto-profile-v1", epoch: 7 },
    workloadAttestation: {
      workloadId: "contract-probe-owner",
      audience: "telemetry-collector.internal",
      expiresAt: "2026-08-14T12:10:00.000Z",
    },
    identityLease: {
      leaseId: "identity-lease-1",
      workloadId: "contract-probe-owner",
      audience: "telemetry-collector.internal",
      expiresAt: "2026-08-14T12:10:00.000Z",
    },
    secretLease: {
      leaseId: "secret-lease-1",
      workloadId: "contract-probe-owner",
      audience: "telemetry-collector.internal",
      expiresAt: "2026-08-14T12:10:00.000Z",
    },
    verifiedAt: "2026-08-14T11:59:00.000Z",
    expiresAt: "2026-08-14T12:05:00.000Z",
    ...overrides,
  };
}

function client(verified = true) {
  return new SecureDeliveryAdmissionClient(
    { verify: async () => verified },
    {
      now: () => now,
      supportedCryptoProfiles: new Set(["crypto-profile-v1"]),
      minimumCryptoEpoch: 7,
    },
  );
}

describe("M01 workload trust", () => {
  it("admits only exact digest evidence with active attestation and short-lived leases", async () => {
    await expect(client().admit({
      artifactReference: digest,
      artifactDigest: digest,
      workloadId: "contract-probe-owner",
      audience: "telemetry-collector.internal",
      evidence: evidence(),
    })).resolves.toMatchObject({ admitted: true });
  });

  it.each([
    ["mutable tag", { artifactReference: "lens:latest" }, "artifact-reference-mutable"],
    ["unattested workload", { evidence: evidence({ workloadAttestation: { workloadId: "other", audience: "telemetry-collector.internal", expiresAt: "2026-08-14T12:10:00.000Z" } }) }, "attestation-invalid"],
    ["expired lease", { evidence: evidence({ secretLease: { leaseId: "expired", workloadId: "contract-probe-owner", audience: "telemetry-collector.internal", expiresAt: "2026-08-14T11:59:00.000Z" } }) }, "lease-invalid"],
    ["unsupported crypto profile", { evidence: evidence({ cryptoProfile: { id: "deprecated", epoch: 1 } }) }, "crypto-profile-unsupported"],
  ])("fails closed for %s", async (_label, override, reason) => {
    const request = {
      artifactReference: digest,
      artifactDigest: digest,
      workloadId: "contract-probe-owner",
      audience: "telemetry-collector.internal",
      evidence: evidence(),
      ...override,
    };
    await expect(client().admit(request)).resolves.toEqual({ admitted: false, reason });
  });

  it("rejects invalid signed evidence", async () => {
    await expect(client(false).admit({
      artifactReference: digest,
      artifactDigest: digest,
      workloadId: "contract-probe-owner",
      audience: "telemetry-collector.internal",
      evidence: evidence(),
    })).resolves.toEqual({ admitted: false, reason: "evidence-verification-failed" });
  });
});

describe("M01 redacted telemetry", () => {
  it("rejects secret-bearing telemetry, keeps governed references, and counts bounded queue loss", () => {
    const collector = new TelemetryCollector({ maxRecords: 1, maxBytes: 1024 });
    const workloadRef = createGovernedReference("contract-probe-owner", "workload", {
      keyId: "2026q3",
      secret: "k".repeat(32),
    });
    expect(collector.collect({
      signal: "log",
      priority: "normal",
      serviceName: "contract-probe-owner",
      operation: "admit",
      timestamp: now.toISOString(),
      statusCode: "OK",
      attributes: { error_code: "E42", workload_ref: workloadRef },
    })).toMatchObject({ accepted: true, redactedFields: 0 });
    expect(collector.drain()[0].attributes).toEqual({ error_code: "E42", workload_ref: workloadRef });
    expect(collector.collect({
      signal: "trace",
      priority: "normal",
      serviceName: "contract-probe-owner",
      operation: "admit",
      timestamp: now.toISOString(),
      statusCode: "OK",
      attributes: { prompt: "protected content" },
    })).toMatchObject({ accepted: false, reason: "forbidden-attribute", redactedFields: 1 });
    expect(collector.drain()).toEqual([]);

    collector.collect({ signal: "metric", priority: "normal", serviceName: "contract-probe-owner", operation: "admit", timestamp: now.toISOString(), statusCode: "OK" });
    expect(collector.collect({ signal: "metric", priority: "debug", serviceName: "contract-probe-owner", operation: "admit", timestamp: now.toISOString(), statusCode: "OK" })).toMatchObject({ accepted: false, reason: "queue-full" });
    expect(collector.dropCounts().metric).toBe(1);
  });
});

describe("M01 local packaging", () => {
  it("declares default-deny network and short-lived attested workload inputs", async () => {
    const policy = JSON.parse(
      await readFile(path.join(".", "deploy/local/m01-workload-trust.json"), "utf8"),
    );

    expect(policy.network).toMatchObject({
      default: "deny",
      publicDns: "forbidden",
      publicIp: "forbidden",
      proxy: "forbidden",
      webhooks: "forbidden",
    });
    expect(policy.workloadTrust).toMatchObject({
      attestationRequired: true,
      cryptoProfileRequired: true,
      identityLeaseMaxSeconds: 900,
      secretLeaseMaxSeconds: 900,
    });
  });
});
