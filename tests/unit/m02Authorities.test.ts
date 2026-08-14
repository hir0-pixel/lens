import { describe, expect, it } from "vitest";
import { AuditAdmissionError, AuditLedger } from "../../services/audit/AuditLedger";
import { IdentityReadError, IdentitySyncAuthority } from "../../services/identity-sync/IdentitySyncAuthority";
import { SessionAuthority, SessionError } from "../../services/session/SessionAuthority";

describe("M02 Engineer A authorities", () => {
  it("requires attested quorum audit admission and preserves idempotent event receipts", () => {
    const ledger = new AuditLedger({ "identity-sync": ["identity.sync"] }, () => new Date("2026-08-14T00:00:00Z"));
    const event = { eventId: "evt-1", partitionKey: "subject-1", eventType: "identity.sync", requestId: "req-1", action: "sync", intentDigest: "sha256:a", byteLength: 128 };
    const receipt = ledger.appendIntent({ workloadId: "identity-sync", attested: true }, event);
    expect(ledger.appendIntent({ workloadId: "identity-sync", attested: true }, event)).toEqual(receipt);
    expect(() => ledger.appendIntent({ workloadId: "identity-sync", attested: false }, { ...event, eventId: "evt-2" })).toThrow(AuditAdmissionError);
    ledger.setHealth({ quorumAvailable: false });
    expect(ledger.appendIntent({ workloadId: "identity-sync", attested: true }, event)).toEqual(receipt);
    expect(() => ledger.appendIntent({ workloadId: "identity-sync", attested: true }, { ...event, action: "altered" })).toThrow("different canonical content");
    expect(() => ledger.appendIntent({ workloadId: "identity-sync", attested: true }, { ...event, eventId: "evt-3" })).toThrow("Audit write quorum is unavailable");
  });

  it("revision-fences identity facts and fails closed when a source becomes stale", () => {
    let now = 1_000;
    const identity = new IdentitySyncAuthority({ admitSyncBatch: () => ({ receiptDigest: "audit-receipt" }) }, () => now);
    identity.applyBatch({ batchId: "batch-1", cursor: 1, sourceRef: "internal-directory", mutations: [{ subjectRef: "subject-1", accountState: "active", facts: { clearance: "internal" }, groups: ["staff"], sourceVersion: 1 }] });
    expect(identity.readSnapshot("subject-1", 100).subjectSecurityRevision).toBe(1);
    expect(() => identity.applyBatch({ batchId: "batch-1", cursor: 2, sourceRef: "internal-directory", mutations: [] })).toThrow("batch_id_conflict");
    now = 1_200;
    expect(() => identity.readSnapshot("subject-1", 100)).toThrow(IdentityReadError);
  });

  it("binds opaque sessions to a device and client key and audit-admits revocation", () => {
    const calls: string[] = [];
    const sessions = new SessionAuthority({ admitSession: (event) => { calls.push(event); return { receiptDigest: event }; } }, () => 1_000);
    const issued = sessions.issue({ subjectRef: "subject-1", deviceRef: "device-1", clientKeyRef: "key-1", authenticationMethodRef: "phishing-resistant", expiresAt: 2_000 }, "idem-1");
    expect(sessions.validate(issued.sessionId, "device-1", "key-1").subjectRef).toBe("subject-1");
    expect(() => sessions.issue({ subjectRef: "subject-1", deviceRef: "device-2", clientKeyRef: "key-1", authenticationMethodRef: "phishing-resistant", expiresAt: 2_000 }, "idem-1")).toThrow("idempotency_conflict");
    expect(() => sessions.validate(issued.sessionId, "device-2", "key-1")).toThrow(SessionError);
    sessions.revoke(issued.sessionId);
    expect(calls).toEqual(["issued", "revoked"]);
    expect(() => sessions.validate(issued.sessionId, "device-1", "key-1")).toThrow("session_revoked");
  });
});
