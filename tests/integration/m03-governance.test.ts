import { describe, expect, it } from "vitest";
import {
  GovernanceAuthority,
  GovernanceError,
  PdpGovernanceConsumerSimulator,
  type DisclosureReservationRequest,
} from "../../services/governance";

const digest = (letter: string) => `sha256:${letter.repeat(64)}` as const;
const now = 1_000;
const fence = { fenceId: "fence-1", actorRef: "steward-1", approverRef: "reviewer-1", expiresAt: 2_000 };

function authority() {
  return new GovernanceAuthority(() => now);
}

function expectErrorCode(action: () => unknown, code: GovernanceError["code"]): void {
  let error: unknown;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(GovernanceError);
  expect((error as GovernanceError).code).toBe(code);
}

function reservation(overrides: Partial<DisclosureReservationRequest> = {}): DisclosureReservationRequest {
  return {
    reservationId: "reservation-1",
    subjectRef: "subject-1",
    deviceRef: "device-1",
    applicationRef: "employee-desktop",
    purposeRef: "assistant",
    channel: "chat",
    resourceSetDigest: digest("a"),
    sourceClassifications: ["confidential"],
    outputDigest: digest("b"),
    lineageDigest: digest("c"),
    units: 2,
    ceiling: 3,
    terminalReceipt: { runRef: "run-1", finalCounterDigest: digest("d"), terminal: true, pendingWork: false },
    expiresAt: 1_500,
    ...overrides,
  };
}

describe("M03 Governance authority", () => {
  it("publishes only indexed, integrity-valid versions and supplies current facts to PDP", () => {
    const governance = authority();
    governance.registerVersion({ documentVersionRef: "docver-1", classification: "internal", aclDigest: digest("e") });
    expect(() => governance.mutateSecurity("docver-1", { publication: "active" }, fence)).toThrow(GovernanceError);

    const active = governance.mutateSecurity("docver-1", { publication: "active", processing: "indexed", integrity: "valid" }, fence);
    expect(active).toMatchObject({ retrievalEligible: true, resourceSecurityRevision: 2 });
    const pdp = new PdpGovernanceConsumerSimulator(governance);
    expect(pdp.readCurrentDocumentFacts(["docver-1"], { "docver-1": 2 })[0]).toMatchObject({ publication: "active", classification: "internal" });

    governance.mutateSecurity("docver-1", { publication: "withdrawn" }, fence);
    expectErrorCode(() => pdp.readCurrentDocumentFacts(["docver-1"], { "docver-1": 2 }), "STALE_AUTHORITY");
  });

  it("fences security mutations when an expected revision is supplied and preserves unfenced compatibility", () => {
    const governance = authority();
    governance.registerVersion({ documentVersionRef: "docver-1", classification: "internal", aclDigest: digest("e") });
    expect(governance.mutateSecurity("docver-1", { processing: "indexed" }, fence, 1).resourceSecurityRevision).toBe(2);
    expectErrorCode(() => governance.mutateSecurity("docver-1", { integrity: "valid" }, fence, 1), "STALE_AUTHORITY");
    expect(governance.mutateSecurity("docver-1", { integrity: "valid" }, fence).resourceSecurityRevision).toBe(3);
  });

  it("keeps preservation separate from access and rejects self-approved governance changes", () => {
    const governance = authority();
    governance.registerVersion({ documentVersionRef: "docver-1", classification: "internal", aclDigest: digest("e") });
    expectErrorCode(() => governance.setPreservation("docver-1", "legal_hold", "hold-1", { ...fence, approverRef: "steward-1" }), "FORBIDDEN");
    governance.setPreservation("docver-1", "legal_hold", "hold-1", fence);
    expect(governance.canPurge("docver-1")).toBe(false);
    expect(governance.getResourceSecurityFacts(["docver-1"])[0].retrievalEligible).toBe(false);
  });

  it("raises derived classification, makes reservations serializable, and commits exact output once", () => {
    const governance = authority();
    const first = governance.reserveDisclosure(reservation({ detectorClassification: "restricted" }));
    expect(first.classification).toBe("restricted");
    expect(governance.reserveDisclosure(reservation({ detectorClassification: "restricted" }))).toEqual(first);
    expectErrorCode(() => governance.reserveDisclosure(reservation({ reservationId: "reservation-2", outputDigest: digest("f"), detectorClassification: "restricted" })), "FORBIDDEN");

    const committed = governance.commitDisclosure("reservation-1", digest("b"), "release-fence-1");
    expect(committed.state).toBe("committed");
    expect(governance.commitDisclosure("reservation-1", digest("b"), "release-fence-1")).toEqual(committed);
    expectErrorCode(() => governance.commitDisclosure("reservation-1", digest("a"), "release-fence-1"), "CONFLICT");
  });

  it("fails closed for non-terminal evidence, uncertain disclosure, and over-limit fact batches", () => {
    const governance = authority();
    expectErrorCode(() => governance.reserveDisclosure(reservation({ terminalReceipt: { runRef: "run-1", finalCounterDigest: digest("d"), terminal: false, pendingWork: true } })), "EVIDENCE_REQUIRED");

    governance.reserveDisclosure(reservation());
    governance.markDisclosureUncertain("reservation-1");
    expectErrorCode(() => governance.commitDisclosure("reservation-1", digest("b"), "release-fence-1"), "STALE_AUTHORITY");
    expectErrorCode(() => governance.getResourceSecurityFacts(Array.from({ length: 1001 }, (_, index) => `docver-${index}`)), "INVALID_ARGUMENT");
  });

  it("returns a revision-pinned current snapshot for the documented 100, 500, and 1000-resource batches", () => {
    for (const batchSize of [100, 500, 1000]) {
      const governance = authority();
      const references = Array.from({ length: batchSize }, (_, index) => `docver-${batchSize}-${index}`);
      const expectedRevisions: Record<string, number> = {};
      for (const documentVersionRef of references) {
        governance.registerVersion({ documentVersionRef, classification: "internal", aclDigest: digest("e") });
        expectedRevisions[documentVersionRef] = governance.mutateSecurity(
          documentVersionRef,
          { publication: "active", processing: "indexed", integrity: "valid" },
          fence,
        ).resourceSecurityRevision;
      }

      const facts = new PdpGovernanceConsumerSimulator(governance).readCurrentDocumentFacts(references, expectedRevisions);
      expect(facts).toHaveLength(batchSize);
      expect(facts.every((fact) => fact.retrievalEligible && fact.resourceSecurityRevision === expectedRevisions[fact.documentVersionRef])).toBe(true);

      governance.mutateSecurity(references[0], { publication: "withdrawn" }, fence);
      expectErrorCode(() => new PdpGovernanceConsumerSimulator(governance).readCurrentDocumentFacts(references, expectedRevisions), "STALE_AUTHORITY");
    }
  });
});
