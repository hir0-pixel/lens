import { describe, expect, it } from "vitest";
import { IngestionError, IngestionService, type IngestionRequest } from "../../services/ingestion";

const digest = (letter: string) => `sha256:${letter.repeat(64)}` as const;
const request = (overrides: Partial<IngestionRequest> = {}): IngestionRequest => ({
  sourceId: "source-1", documentRef: "document-1", version: "v1", versionRef: "docver-1", contentDigest: digest("a"),
  parse: { status: "accepted", renditionDigest: digest("b"), chunks: [{ chunkRef: "chunk-1", contentDigest: digest("c"), citationAnchor: "page:1" }] },
  ...overrides,
});

function service(options: { stale?: boolean; failCommitOnce?: boolean } = {}) {
  const calls: string[] = [];
  let failCommit = options.failCommitOnce ?? false;
  const ingestion = new IngestionService(
    {
      registerVersion: async () => { calls.push("register"); return { resourceSecurityRevision: 1 }; },
      activatePublishedVersion: async ({ expectedResourceSecurityRevision }) => {
        calls.push(`activate:${expectedResourceSecurityRevision}`);
        if (options.stale) throw new IngestionError("STALE_AUTHORITY", "Changed.");
        return { resourceSecurityRevision: 2 };
      },
      withdrawVersion: async () => { calls.push("withdraw"); },
    },
    { embed: async () => { calls.push("embed"); return { profileRef: "embedding-profile-v1", vectorsDigest: digest("d") }; } },
    {
      writeGeneration: async () => { calls.push("write"); },
      commitGeneration: async () => {
        calls.push("commit");
        if (failCommit) {
          failCommit = false;
          throw new Error("serving index unavailable");
        }
      },
      removeGeneration: async () => { calls.push("remove"); },
    },
  );
  return { ingestion, calls };
}

describe("M05 governed ingestion", () => {
  it("publishes an immutable version only after Governance activation and emits committed invalidation events", async () => {
    const { ingestion, calls } = service();
    const result = await ingestion.ingest(request());
    expect(result).toMatchObject({ state: "COMMITTED", resourceSecurityRevision: 2 });
    expect(calls).toEqual(["register", "embed", "write", "activate:1", "commit"]);
    expect(ingestion.currentVersion("document-1")).toBe("docver-1");
    expect(ingestion.outbox).toEqual([expect.objectContaining({ type: "document.indexed", versionRef: "docver-1", resourceSecurityRevision: 2 })]);
  });

  it("makes replay idempotent, withdraws atomically, and records removal invalidation", async () => {
    const { ingestion, calls } = service();
    await ingestion.ingest(request());
    await ingestion.ingest(request());
    expect(calls.filter((call) => call === "write")).toHaveLength(1);
    await ingestion.withdraw("docver-1");
    expect(ingestion.currentVersion("document-1")).toBeUndefined();
    expect(calls).toContain("remove");
    expect(ingestion.outbox.at(-1)).toMatchObject({ type: "document.removed" });
  });

  it("quarantines isolated-parser failures without embedding or indexing", async () => {
    const { ingestion, calls } = service();
    await expect(ingestion.ingest(request({ parse: { status: "quarantined", renditionDigest: digest("b"), chunks: [], quarantineReason: "malformed" } }))).rejects.toMatchObject<Partial<IngestionError>>({ code: "QUARANTINED" });
    expect(calls).toEqual([]);
  });

  it("fails closed when Governance changes during publication and never advances the committed pointer", async () => {
    const { ingestion, calls } = service({ stale: true });
    await expect(ingestion.ingest(request())).rejects.toMatchObject<Partial<IngestionError>>({ code: "STALE_AUTHORITY" });
    expect(ingestion.currentVersion("document-1")).toBeUndefined();
    expect(calls).not.toContain("commit");
  });

  it("compensates a post-activation index failure before permitting the immutable version to be retried", async () => {
    const { ingestion, calls } = service({ failCommitOnce: true });
    await expect(ingestion.ingest(request())).rejects.toThrow("serving index unavailable");
    expect(calls).toEqual(["register", "embed", "write", "activate:1", "commit", "withdraw", "remove"]);
    expect(ingestion.currentVersion("document-1")).toBeUndefined();

    await expect(ingestion.ingest(request())).resolves.toMatchObject({ state: "COMMITTED" });
    expect(ingestion.currentVersion("document-1")).toBe("docver-1");
  });
});
