import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ModelUseAuthorityError,
  SubjectDeviceModelUseAuthority,
  FailClosedModelUseAuthorityPort,
  type AuthorizeGenerateInput,
  type AuthorizeModelUseInput,
  type ModelEligibilityForAuthority,
  type SubjectDeviceFactReaders,
} from "../../services/pdp/ModelUseAuthority";
import { AuthorityReceiptIssuer, Ed25519ReceiptVerifier } from "../../services/security/authorityReceipt";

const keys = generateKeyPairSync("ed25519");
const NOW = 1_700_000_000_000;

function readers(overrides: Partial<{ active: boolean; compliant: boolean }> = {}): SubjectDeviceFactReaders {
  return {
    subject: () => ({ revision: 1, active: overrides.active ?? true, groups: [] }),
    device: () => ({ revision: 1, compliant: overrides.compliant ?? true }),
  };
}

function eligibility(approved: readonly string[]): ModelEligibilityForAuthority {
  return {
    async resolveEndpoint(input) {
      if (!approved.includes(`${input.capability}:${input.artifactDigest}`)) throw new Error("not eligible");
      return { endpointRef: `internal-model:${input.artifactDigest}`, snapshotExpiresAt: NOW + 60_000, external: false };
    },
    currentDenyEpoch: () => 0,
  };
}

function generateInput(overrides: Partial<AuthorizeGenerateInput> = {}): AuthorizeGenerateInput {
  return {
    requestId: "req-1",
    requestDigest: `sha256:${"a".repeat(64)}`,
    subjectRef: "subject-1",
    deviceRef: "device-1",
    sessionRef: "session-1",
    applicationRef: "lens-employee-client",
    workspaceRef: "default-workspace",
    purposeRef: "assistant",
    requestClass: "enterprise-grounded",
    deadlineAt: NOW + 30_000,
    ...overrides,
  };
}

function modelUseInput(overrides: Partial<AuthorizeModelUseInput> = {}): AuthorizeModelUseInput {
  return {
    requestId: "req-1",
    turnId: "turn-1",
    stepId: "step-route",
    stepClass: "route",
    requestDigest: `sha256:${"a".repeat(64)}`,
    modelRef: "router-default",
    artifactDigest: `sha256:${"b".repeat(64)}`,
    capability: "rag-route-classification",
    subjectRef: "subject-1",
    applicationRef: "lens-employee-client",
    workspaceRef: "default-workspace",
    purposeRef: "assistant",
    requestClass: "enterprise-grounded",
    deadlineAt: NOW + 30_000,
    ...overrides,
  };
}

describe("SubjectDeviceModelUseAuthority", () => {
  it("authorizeGenerate issues a valid receipt bound to every field, verifiable by a real Ed25519 verifier", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const verifier = new Ed25519ReceiptVerifier(keys.publicKey, { now: () => NOW + 10 });
    const authority = new SubjectDeviceModelUseAuthority(readers(), eligibility([]), issuer, () => NOW);
    const { token } = await authority.authorizeGenerate(generateInput(), new AbortController().signal);
    const claims = verifier.verify(token, { purpose: "authorize_generate", requestId: "req-1", subjectRef: "subject-1", workspaceRef: "default-workspace" });
    expect(claims.applicationRef).toBe("lens-employee-client");
  });

  it("authorizeGenerate fails closed when subjectRef or deviceRef is empty, even against a permissive fact reader", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const authority = new SubjectDeviceModelUseAuthority(readers(), eligibility([]), issuer, () => NOW);
    await expect(authority.authorizeGenerate(generateInput({ subjectRef: "" }), new AbortController().signal)).rejects.toThrow(ModelUseAuthorityError);
    await expect(authority.authorizeGenerate(generateInput({ deviceRef: "" }), new AbortController().signal)).rejects.toThrow(ModelUseAuthorityError);
  });

  it("authorizeGenerate fails closed when the subject is inactive", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const authority = new SubjectDeviceModelUseAuthority(readers({ active: false }), eligibility([]), issuer, () => NOW);
    await expect(authority.authorizeGenerate(generateInput(), new AbortController().signal)).rejects.toThrow(ModelUseAuthorityError);
  });

  it("authorizeGenerate fails closed when the device is noncompliant", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const authority = new SubjectDeviceModelUseAuthority(readers({ compliant: false }), eligibility([]), issuer, () => NOW);
    await expect(authority.authorizeGenerate(generateInput(), new AbortController().signal)).rejects.toThrow(ModelUseAuthorityError);
  });

  it("authorizeGenerate fails closed once the deadline has elapsed", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW + 40_000 });
    const authority = new SubjectDeviceModelUseAuthority(readers(), eligibility([]), issuer, () => NOW + 40_000);
    await expect(authority.authorizeGenerate(generateInput(), new AbortController().signal)).rejects.toThrow(ModelUseAuthorityError);
  });

  it("authorizeModelUse issues a receipt only when the exact (capability, artifactDigest) pair is eligible", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const verifier = new Ed25519ReceiptVerifier(keys.publicKey, { now: () => NOW + 10 });
    const authority = new SubjectDeviceModelUseAuthority(readers(), eligibility([`rag-route-classification:sha256:${"b".repeat(64)}`]), issuer, () => NOW);
    const { token } = await authority.authorizeModelUse(modelUseInput(), new AbortController().signal);
    const claims = verifier.verify(token, { purpose: "authorize_model_use", requestId: "req-1", modelRef: "router-default", capability: "rag-route-classification" });
    expect(claims.stepClass).toBe("route");
  });

  it("authorizeModelUse fails closed when the model is eligible for a different capability but not the requested one", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const authority = new SubjectDeviceModelUseAuthority(readers(), eligibility([`grounded-assistant:sha256:${"b".repeat(64)}`]), issuer, () => NOW);
    await expect(authority.authorizeModelUse(modelUseInput(), new AbortController().signal)).rejects.toThrow(/not eligible/);
  });

  it("route-step and final-generation authorizations are independent calls bound to distinct stepId/stepClass", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const verifier = new Ed25519ReceiptVerifier(keys.publicKey, { now: () => NOW + 10 });
    const authority = new SubjectDeviceModelUseAuthority(
      readers(),
      eligibility([`rag-route-classification:sha256:${"b".repeat(64)}`, `grounded-assistant:sha256:${"c".repeat(64)}`]),
      issuer,
      () => NOW,
    );
    const route = await authority.authorizeModelUse(modelUseInput(), new AbortController().signal);
    const final = await authority.authorizeModelUse(
      modelUseInput({ stepId: "step-final", stepClass: "final_generation", modelRef: "employee-selected-model", artifactDigest: `sha256:${"c".repeat(64)}`, capability: "grounded-assistant" }),
      new AbortController().signal,
    );
    const routeClaims = verifier.verify(route.token, { purpose: "authorize_model_use", requestId: "req-1" });
    const finalClaims = verifier.verify(final.token, { purpose: "authorize_model_use", requestId: "req-1" });
    expect(routeClaims.receiptId).not.toBe(finalClaims.receiptId);
    expect(routeClaims.stepClass).toBe("route");
    expect(finalClaims.stepClass).toBe("final_generation");
  });

  it("FailClosedModelUseAuthorityPort never authorizes anything", async () => {
    const port = new FailClosedModelUseAuthorityPort();
    await expect(port.authorizeGenerate(generateInput(), new AbortController().signal)).rejects.toThrow();
    await expect(port.authorizeModelUse(modelUseInput(), new AbortController().signal)).rejects.toThrow();
  });
});
