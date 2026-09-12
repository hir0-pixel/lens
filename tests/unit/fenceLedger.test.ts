import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAgentFenceLedger,
  InMemoryFenceLedger,
  SqliteFenceLedger,
} from "../../services/pdp/FenceLedger";
import { PolicyDecisionPoint, PdpError } from "../../services/pdp/PolicyDecisionPoint";

describe("FenceLedger", () => {
  const signer = {
    sign: () => "signed-fence",
    verify: (fence: { signature: string }) => fence.signature === "signed-fence",
  };

  function createPdp(fenceLedger: InMemoryFenceLedger | SqliteFenceLedger, now = () => 1_000) {
    const service = new PolicyDecisionPoint(
      {
        subject: () => ({ revision: 3, active: true, groups: ["staff"] }),
        device: () => ({ revision: 5, compliant: true }),
        resources: (refs) => refs.map((resourceRef, index) => ({
          resourceRef,
          revision: index + 1,
          published: true,
          integrityValid: true,
          aclAllows: resourceRef !== "denied",
        })),
      },
      { admitDecision: () => ({ receiptDigest: "audit" }) },
      signer,
      now,
      undefined,
      fenceLedger,
    );
    service.activate(
      { revision: 1, digest: "sha256:policy", signed: true, evaluate: () => true },
      { independent: true, auditAdmitted: true, compatibilityPassed: true },
    );
    return service;
  }

  const request = () => ({
    requestId: "r1",
    callerWorkloadRef: "retrieval",
    subjectRef: "s",
    deviceRef: "d",
    action: "document.read",
    resourceRefs: ["allowed"],
    normalizedContextDigest: "sha256:context",
    deadlineAt: 2_000,
  });

  const consumption = {
    requestId: "r1",
    callerWorkloadRef: "retrieval",
    action: "document.read",
    useBoundary: "operation" as const,
    normalizedContextDigest: "sha256:context",
    resourceRefs: ["allowed"],
  };

  it("fence.replay-across-replicas-rejected", () => {
    const dir = mkdtempSync(join(tmpdir(), "fence-ledger-"));
    const dbPath = join(dir, "fences.db");
    try {
      const ledgerA = new SqliteFenceLedger(dbPath);
      const ledgerB = new SqliteFenceLedger(dbPath);
      const pdpA = createPdp(ledgerA);
      const pdpB = createPdp(ledgerB);
      const decision = pdpA.decideBatch(request());
      pdpA.consumeFence(decision.fence!, consumption);
      expect(() => pdpB.consumeFence(decision.fence!, consumption)).toThrow(PdpError);
      expect(ledgerB.consume(decision.fence!.fenceId)).toBe(false);
      ledgerA.close();
      ledgerB.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fence.default-ledger-unchanged", () => {
    const service = createPdp(new InMemoryFenceLedger());
    const decision = service.decideBatch(request());
    expect(decision.allowed).toEqual(["allowed"]);
    service.consumeFence(decision.fence!, consumption);
    expect(() => service.consumeFence(decision.fence!, consumption)).toThrow(PdpError);
  });

  it("fence.memory-refused-in-production", () => {
    expect(() => createAgentFenceLedger(":memory:", "production")).toThrow(/in-memory agent fence ledger/);
  });
});
