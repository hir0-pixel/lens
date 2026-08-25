import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../services/security/canonicalJson";
import {
  claimVerifiedUsage,
  conservativeMeasuredUnits,
  resetUsageReplayGuardForTests,
  verifySidecarUsage,
  type SidecarUsagePayload,
  type UsageExpectedContext,
} from "../../services/security/sidecarUsage";
import { USAGE_SCHEMA_VERSION } from "../../services/inference-adapter/localMeter";

const keys = generateKeyPairSync("ed25519");
const pub = keys.publicKey.export({ type: "spki", format: "pem" }).toString();

function payload(overrides: Partial<SidecarUsagePayload> = {}): SidecarUsagePayload {
  return {
    schemaVersion: USAGE_SCHEMA_VERSION,
    reservationId: "reservation:1",
    requestId: "req-1",
    turnId: "turn-1",
    stepId: "step-final",
    fence: 2,
    artifactDigest: `sha256:${"a".repeat(64)}`,
    endpointGeneration: "gen-1",
    usageEventId: "usage:reservation:1:2",
    measuredUnits: 12,
    terminal: "completed",
    ...overrides,
  };
}

function expected(overrides: Partial<UsageExpectedContext> = {}): UsageExpectedContext {
  return {
    reservationId: "reservation:1",
    requestId: "req-1",
    turnId: "turn-1",
    stepId: "step-final",
    fence: 2,
    artifactDigest: `sha256:${"a".repeat(64)}`,
    endpointGeneration: "gen-1",
    ...overrides,
  };
}

function sign(body: SidecarUsagePayload): string {
  return cryptoSign(null, Buffer.from(canonicalJson(body), "utf8"), keys.privateKey).toString("base64url");
}

describe("sidecar usage settlement against Orchestrator-owned expected context", () => {
  it("accepts a complete signed receipt that matches the independently known dispatch", () => {
    const body = payload();
    expect(verifySidecarUsage(pub, body, sign(body), expected())).toBe(true);
  });

  it("rejects missing fields and empty strings even when the signature covers them", () => {
    const emptyStep = payload({ stepId: "" });
    expect(verifySidecarUsage(pub, emptyStep, sign(emptyStep), expected({ stepId: "" }))).toBe(false);
    const zeroFence = payload({ fence: 0 });
    expect(verifySidecarUsage(pub, zeroFence, sign(zeroFence), expected({ fence: 0 }))).toBe(false);
  });

  it("rejects cross-step and cross-reservation substitution even if the attacker copies signed fields into expected", () => {
    const body = payload();
    const signature = sign(body);
    expect(verifySidecarUsage(pub, body, signature, expected({ stepId: "step-route" }))).toBe(false);
    expect(verifySidecarUsage(pub, body, signature, expected({ reservationId: "reservation:other" }))).toBe(false);
  });

  it("rejects tampered measured units", () => {
    const body = payload();
    expect(verifySidecarUsage(pub, { ...body, measuredUnits: 99 }, sign(body), expected())).toBe(false);
  });

  it("rejects replay of the same usageEventId after a successful claim", () => {
    resetUsageReplayGuardForTests();
    const body = payload({ usageEventId: "usage:once" });
    const signature = sign(body);
    expect(claimVerifiedUsage(pub, body, signature, expected())).toBe(true);
    expect(claimVerifiedUsage(pub, body, signature, expected())).toBe(false);
  });

  it("settles conservatively when verification fails", () => {
    expect(conservativeMeasuredUnits(40, 12, true)).toBe(40);
    expect(conservativeMeasuredUnits(40, 55, true)).toBe(55);
    expect(conservativeMeasuredUnits(40, 12, false)).toBe(40);
  });
});
