import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { ConversationReferenceCodec } from "../src/security/conversationReference";
import { DelegatedSessionAssertionIssuer, DelegatedSessionAssertionVerifier } from "../../services/security/delegatedSessionAssertion";

const conversation = new ConversationReferenceCodec("c".repeat(48));
const assertionKeys = generateKeyPairSync("ed25519");

describe("server security bindings", () => {
  it("issues distinct opaque conversation references and binds them to a subject", () => {
    const first = conversation.issue("subject-a");
    const second = conversation.issue("subject-a");
    expect(first).not.toBe(second);
    expect(conversation.verify(first, "subject-a")).toBeUndefined();
    expect(() => conversation.verify(first, "subject-b")).toThrow();
    expect(() => conversation.verify(`${first.slice(0, -1)}x`, "subject-a")).toThrow();
    expect(() => conversation.verify("c1." + "x".repeat(300), "subject-a")).toThrow();
  });

  it("deterministically issues one subject-bound reference for a creation key and rejects malformed keys", () => {
    const creationKey = Buffer.alloc(32, 7).toString("base64url");
    const first = conversation.issue("subject-a", creationKey);
    const retry = conversation.issue("subject-a", creationKey);
    expect(retry).toBe(first);
    expect(conversation.verify(first, "subject-a")).toBeUndefined();
    expect(() => conversation.verify(first, "subject-b")).toThrow();
    expect(conversation.issue("subject-b", creationKey)).not.toBe(first);
    expect(() => conversation.issue("subject-a", "not-base64!" as string)).toThrow();
    expect(() => conversation.issue("subject-a", Buffer.alloc(8, 1).toString("base64url"))).toThrow();
    expect(conversation.issue("subject-a", "123e4567-e89b-42d3-a456-426614174000")).toBe(conversation.issue("subject-a", "123e4567-e89b-42d3-a456-426614174000"));
  });

  it("binds the short-lived delegated assertion to every request field", () => {
    const issuer = new DelegatedSessionAssertionIssuer(assertionKeys.privateKey, { now: () => 10_000 });
    const verifier = new DelegatedSessionAssertionVerifier(assertionKeys.publicKey, { now: () => 10_001 });
    const expected = {
      issuer: "bff" as const,
      audience: "orchestrator" as const,
      requestId: "request-1",
      subjectRef: "subject-a",
      sessionRef: "session-1",
      deviceRef: "device-1",
      conversationRef: conversation.issue("subject-a"),
      queryDigest: `sha256:${"d".repeat(64)}` as `sha256:${string}`,
      workspaceRef: "default-workspace",
      requestClass: "enterprise-grounded",
      purposeRef: "assistant",
    };
    const token = issuer.issue(expected);
    expect(verifier.verify(token, expected).exp).toBe(15_000);
    expect(() => verifier.verify(token, { ...expected, audience: "memory" })).toThrow();
    const memoryToken = issuer.issue({ ...expected, audience: "memory" });
    expect(() => verifier.verify(memoryToken, expected)).toThrow();
    expect(() => verifier.verify(token, { ...expected, subjectRef: "subject-b" })).toThrow();
    expect(() => verifier.verify(token, { ...expected, workspaceRef: "other-workspace" })).toThrow();
    expect(() => verifier.verify(token, { ...expected, requestClass: "other-class" })).toThrow();
    expect(() => verifier.verify(token, { ...expected, purposeRef: "other-purpose" })).toThrow();
    expect(() => verifier.verify(token.slice(0, -1) + "x", expected)).toThrow();
    const expired = new DelegatedSessionAssertionVerifier(assertionKeys.publicKey, { now: () => 16_000 });
    expect(() => expired.verify(token, expected)).toThrow();
    expect("issue" in verifier).toBe(false);
    expect(() => new DelegatedSessionAssertionIssuer(assertionKeys.publicKey)).toThrow(/private/i);
    expect(() => issuer.issue({ ...expected, requestId: "r".repeat(512), subjectRef: "s".repeat(512), sessionRef: "e".repeat(512), deviceRef: "d".repeat(512), conversationRef: "c".repeat(512) })).toThrow(/maximum token length/i);
  });
});
