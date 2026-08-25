import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { simpleHash } from "../../services/retrieval/indexGenerationManifest";
import {
  DEFAULT_INGESTION_BOUNDS,
  InMemoryIngestionOwnerStore,
  IngestionService,
  SqliteIngestionOwnerStore,
  type EmbeddingPort,
  type GovernancePort,
  type IndexPort,
  type IngestionBounds,
  type IngestionRequest,
} from "../../services/ingestion";

const digest = (value: string): `sha256:${string}` => `sha256:${simpleHash(value)}`;
const bounds = (overrides: Partial<IngestionBounds> = {}): IngestionBounds => ({
  ...DEFAULT_INGESTION_BOUNDS,
  retryBackoffMs: 0,
  recoverySurgeMaxJobsPerDrain: 8,
  ...overrides,
});
const request = (overrides: Partial<IngestionRequest> = {}): IngestionRequest => ({
  sourceId: "sharepoint",
  documentRef: "policy-handbook",
  version: "2026-08-21T00:00:00Z",
  versionRef: "policy-handbook@2026-08-21",
  profileRef: "enterprise-rag-v1",
  contentDigest: digest("a"),
  contentBytes: 128,
  classificationRef: "internal",
  aclDigest: digest("e"),
  parse: {
    status: "accepted",
    renditionDigest: digest("b"),
    chunks: [{ chunkRef: "chunk-1", contentDigest: digest("chunk text"), text: "chunk text", citationAnchor: "p1" }],
  },
  ...overrides,
});

class FakeGovernance implements GovernancePort {
  async registerVersion(): Promise<{ resourceSecurityRevision: number }> { return { resourceSecurityRevision: 10 }; }
  async activatePublishedVersion(): Promise<{ resourceSecurityRevision: number }> { return { resourceSecurityRevision: 11 }; }
  async withdrawVersion(): Promise<void> {}
}
class FakeEmbedding implements EmbeddingPort {
  fail = false;
  async embed(): Promise<{ profileRef: string; vectorsDigest: `sha256:${string}` }> {
    if (this.fail) throw new Error("embedding backend unavailable");
    return { profileRef: "enterprise-rag-v1", vectorsDigest: digest("d") };
  }
}
class FakeIndex implements IndexPort {
  async writeGeneration(_input: Parameters<IndexPort["writeGeneration"]>[0]): Promise<void> {}
  async verifyGeneration(): Promise<{ verified: boolean; reason?: string }> { return { verified: true }; }
  async commitGeneration(): Promise<void> {}
  async removeGeneration(): Promise<void> {}
}
function service(store: SqliteIngestionOwnerStore | InMemoryIngestionOwnerStore, embedding = new FakeEmbedding(), limits?: Partial<IngestionBounds>) {
  return { ingestion: new IngestionService(new FakeGovernance(), embedding, new FakeIndex(), store, undefined, bounds(limits)), embedding };
}

function withDatabase(run: (path: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "lens-ingestion-"));
  return run(join(directory, "ingestion.sqlite")).finally(() => rmSync(directory, { recursive: true, force: true }));
}

describe("Track 4 durable SQLite ingestion owner store", () => {
  it("round-trips a mid-lifecycle job into an independent store instance", async () => withDatabase(async (path) => {
    const firstStore = new SqliteIngestionOwnerStore(path);
    const embedding = new FakeEmbedding();
    embedding.fail = true;
    const first = service(firstStore, embedding);
    await first.ingestion.enqueueIngest(request());
    await first.ingestion.runNextJob();

    const reloadedStore = new SqliteIngestionOwnerStore(path);
    try {
      expect(reloadedStore.snapshot()).toEqual(firstStore.snapshot());
      const job = reloadedStore.snapshot().jobs[0];
      expect(job).toMatchObject({ stage: "EMBEDDING", attemptsByStage: { EMBEDDING: 1 }, retryBudgetRemaining: 9 });
    } finally {
      firstStore.close();
      reloadedStore.close();
    }
  }));

  it("preserves every transactional outbox state and attempt count across restart", async () => withDatabase(async (path) => {
    const store = new SqliteIngestionOwnerStore(path);
    await store.transaction((state) => {
      for (const [index, outboxState] of (["PENDING", "IN_FLIGHT", "PUBLISHED", "DEAD_LETTERED"] as const).entries()) {
        const eventId = `event-${index}`;
        state.outbox.set(eventId, {
          event: { eventId, type: "document.indexed", documentRef: "doc", versionRef: `doc@${index}`, resourceSecurityRevision: index },
          state: outboxState,
          attempts: index + 1,
          byteSize: 100 + index,
          createdAtMs: index,
          updatedAtMs: index + 10,
        });
      }
    });

    const reloaded = new SqliteIngestionOwnerStore(path);
    expect(reloaded.snapshot().outbox).toEqual(store.snapshot().outbox);
    expect(reloaded.snapshot().outbox.map((entry) => [entry.state, entry.attempts])).toEqual([
      ["PENDING", 1], ["IN_FLIGHT", 2], ["PUBLISHED", 3], ["DEAD_LETTERED", 4],
    ]);
    store.close();
    reloaded.close();
  }));

  it("preserves quarantine and dead-letter records across restart", async () => withDatabase(async (path) => {
    const store = new SqliteIngestionOwnerStore(path);
    const quarantined = service(store);
    await quarantined.ingestion.enqueueIngest(request({ parse: { status: "quarantined", renditionDigest: digest("b"), chunks: [], quarantineReason: "malware" } }));
    await quarantined.ingestion.drain();

    const embedding = new FakeEmbedding();
    embedding.fail = true;
    const deadLettered = service(store, embedding, { maxRetryAttemptsPerStage: 1 });
    await deadLettered.ingestion.enqueueIngest(request({ documentRef: "other", versionRef: "other@1", version: "1", contentDigest: digest("e") }));
    await deadLettered.ingestion.drain();

    const reloaded = new SqliteIngestionOwnerStore(path);
    expect(reloaded.snapshot().quarantine).toHaveLength(1);
    expect(reloaded.snapshot().quarantine[0]).toMatchObject({ state: "QUARANTINED", quarantineReason: "malware" });
    expect(reloaded.snapshot().deadLetters).toHaveLength(1);
    expect(reloaded.snapshot().deadLetters[0]).toMatchObject({ state: "DEAD_LETTERED", attemptsByStage: { EMBEDDING: 1 } });
    store.close();
    reloaded.close();
  }));

  it("rejects when persistence fails rather than returning a non-durable result", async () => withDatabase(async (path) => {
    const store = new SqliteIngestionOwnerStore(path);
    await expect(store.transaction((state) => {
      state.current.set("doc", "v1");
      store.close();
      return "not durable";
    })).rejects.toThrow();
  }));

  it("leaves the in-memory owner store behavior unchanged", async () => {
    const store = new InMemoryIngestionOwnerStore();
    await store.transaction((state) => state.current.set("policy-handbook", "policy-handbook@1"));
    expect(store.snapshot().current).toEqual([["policy-handbook", "policy-handbook@1"]]);
  });
});
