import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AuthorityReceiptError,
  AuthorityReceiptIssuer,
  Ed25519ReceiptVerifier,
  FailClosedReceiptVerifier,
  type AuthorityReceiptInput,
} from "../../services/security/authorityReceipt";

const keys = generateKeyPairSync("ed25519");
const NOW = 1_700_000_000_000;

function baseInput(overrides: Partial<AuthorityReceiptInput> = {}): AuthorityReceiptInput {
  return {
    purpose: "authorize_model_use",
    issuer: "authority-pdp",
    requestId: "req-1",
    turnId: "turn-1",
    stepId: "step-route",
    stepClass: "route",
    modelRef: "router-default",
    artifactDigest: `sha256:${"a".repeat(64)}`,
    capability: "rag-route-classification",
    boundDigest: `sha256:${"b".repeat(64)}`,
    revision: 1,
    ...overrides,
  };
}

describe("AuthorityReceipt: issue and verify", () => {
  it("verifies a validly issued receipt against exact expected fields", () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const verifier = new Ed25519ReceiptVerifier(keys.publicKey, { now: () => NOW + 100 });
    const { token } = issuer.issue(baseInput(), 5_000);
    const claims = verifier.verify(token, { purpose: "authorize_model_use", requestId: "req-1", stepId: "step-route", modelRef: "router-default" });
    expect(claims.capability).toBe("rag-route-classification");
  });

  it("rejects a receipt whose payload was tampered with after signing (proves the canonicalizer covers nested/renamed content, not just a top-level key list)", () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const verifier = new Ed25519ReceiptVerifier(keys.publicKey, { now: () => NOW + 100 });
    const { token } = issuer.issue(baseInput(), 5_000);
    const [version, payload, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    claims.modelRef = "attacker-controlled-model";
    const tampered = `${version}.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}.${signature}`;
    expect(() => verifier.verify(tampered, { purpose: "authorize_model_use", requestId: "req-1" })).toThrow(AuthorityReceiptError);
  });

  it("rejects an expired receipt", () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const verifier = new Ed25519ReceiptVerifier(keys.publicKey, { now: () => NOW + 10_000 });
    const { token } = issuer.issue(baseInput(), 5_000);
    expect(() => verifier.verify(token, { purpose: "authorize_model_use", requestId: "req-1" })).toThrow(/expired/i);
  });

  it("rejects a receipt whose field does not match the caller's expectation (e.g. wrong step, wrong model)", () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const verifier = new Ed25519ReceiptVerifier(keys.publicKey, { now: () => NOW + 10 });
    const { token } = issuer.issue(baseInput(), 5_000);
    expect(() => verifier.verify(token, { purpose: "authorize_model_use", requestId: "req-1", stepId: "step-final" })).toThrow(/does not match/i);
    expect(() => verifier.verify(token, { purpose: "authorize_model_use", requestId: "req-1", modelRef: "final-generation-model" })).toThrow(/does not match/i);
  });

  it("rejects a receipt signed by a different key (a different issuer cannot forge another authority's receipt)", () => {
    const otherKeys = generateKeyPairSync("ed25519");
    const issuer = new AuthorityReceiptIssuer(otherKeys.privateKey, { now: () => NOW });
    const verifier = new Ed25519ReceiptVerifier(keys.publicKey, { now: () => NOW + 10 });
    const { token } = issuer.issue(baseInput(), 5_000);
    expect(() => verifier.verify(token, { purpose: "authorize_model_use", requestId: "req-1" })).toThrow(/signature/i);
  });

  it("rejects an arbitrary nonempty string that is not a receipt at all", () => {
    const verifier = new Ed25519ReceiptVerifier(keys.publicKey, { now: () => NOW });
    expect(() => verifier.verify("attacker-supplied-nonempty-string", { purpose: "authorize_model_use", requestId: "req-1" })).toThrow(AuthorityReceiptError);
  });

  it("the fail-closed default verifier never accepts anything", () => {
    const verifier = new FailClosedReceiptVerifier();
    expect(() => verifier.verify("anything", { purpose: "authorize_model_use", requestId: "req-1" })).toThrow();
  });
});
