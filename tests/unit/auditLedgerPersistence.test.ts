import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuditLedger } from "../../services/audit/AuditLedger";

describe("AuditLedger durable persistence", () => {
  it("reloads committed intents and continues partition offsets", () => {
    const directory = mkdtempSync(join(tmpdir(), "lens-audit-ledger-"));
    const path = join(directory, "audit.sqlite");
    const producer = { workloadId: "ingestion", attested: true };
    const event = { eventId: "evt-1", partitionKey: "corpus-1", eventType: "ingestion.job.submitted", requestId: "req-1", action: "submit", intentDigest: "sha256:a", byteLength: 128 };
    try {
      const first = new AuditLedger({ ingestion: ["ingestion.job.submitted"] }, undefined, undefined, undefined, undefined, path);
      const receipt = first.appendIntent(producer, event);
      first.close();

      const reloaded = new AuditLedger({ ingestion: ["ingestion.job.submitted"] }, undefined, undefined, undefined, undefined, path);
      expect(reloaded.appendIntent(producer, event)).toEqual(receipt);
      expect(reloaded.appendIntent(producer, { ...event, eventId: "evt-2" }).committedOffset).toBe(receipt.committedOffset + 1);
      reloaded.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
