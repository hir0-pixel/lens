import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRetrievalDeployment } from "../../services/retrieval/ProductionRetrievalWiring";

describe("retrieval audit ledger wiring", () => {
  it("reloads committed events through deployment persistence", () => {
    const directory = mkdtempSync(join(tmpdir(), "lens-retrieval-audit-"));
    const path = join(directory, "audit.sqlite");
    const event = { eventId: "evt-retrieval-1", partitionKey: "request-1", eventType: "retrieval.retrieve", requestId: "request-1", action: "retrieve", intentDigest: "sha256:a", byteLength: 10 };
    const producer = { workloadId: "retrieval", attested: true };
    try {
      const first = createRetrievalDeployment({ persistencePath: path });
      const receipt = first.auditLedger.appendIntent(producer, event);
      first.auditLedger.close();
      const second = createRetrievalDeployment({ persistencePath: path });
      expect(second.auditLedger.appendIntent(producer, event)).toEqual(receipt);
      second.auditLedger.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
