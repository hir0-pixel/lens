import { describe, expect, it } from "vitest";
import {
  DEFAULT_INGESTION_BOUNDS,
  InMemoryIngestionOwnerStore,
  IngestionError,
  IngestionService,
  type EmbeddingPort,
  type EventBackbonePort,
  type GovernancePort,
  type IndexPort,
  type IngestionBounds,
  type IngestionRequest,
  type InvalidationEvent,
} from "../../services/ingestion";

const digest = (char: string): `sha256:${string}` => `sha256:${char.repeat(64)}`;

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
  parse: {
    status: "accepted",
    renditionDigest: digest("b"),
    chunks: [{ chunkRef: "chunk-1", contentDigest: digest("c"), citationAnchor: "p1" }],
  },
  ...overrides,
});

class FakeGovernance implements GovernancePort {
  registrations = 0;
  activations = 0;
  withdrawals = 0;

  async registerVersion(): Promise<{ resourceSecurityRevision: number }> {
    this.registrations += 1;
    return { resourceSecurityRevision: 10 };
  }

  async activatePublishedVersion(): Promise<{ resourceSecurityRevision: number }> {
    this.activations += 1;
    return { resourceSecurityRevision: 11 };
  }

  async withdrawVersion(): Promise<void> {
    this.withdrawals += 1;
  }
}

class FakeEmbedding implements EmbeddingPort {
  calls = 0;
  fail = false;

  async embed(): Promise<{ profileRef: string; vectorsDigest: `sha256:${string}` }> {
    this.calls += 1;
    if (this.fail) throw new Error("embedding backend unavailable");
    return { profileRef: "enterprise-rag-v1", vectorsDigest: digest("d") };
  }
}

class FakeIndex implements IndexPort {
  writes = 0;
  verifies = 0;
  commits = 0;
  removals = 0;
  verified = true;

  async writeGeneration(): Promise<void> {
    this.writes += 1;
  }

  async verifyGeneration(): Promise<{ verified: boolean; reason?: string }> {
    this.verifies += 1;
    return this.verified ? { verified: true } : { verified: false, reason: "missing searchable copy" };
  }

  async commitGeneration(): Promise<void> {
    this.commits += 1;
  }

  async removeGeneration(): Promise<void> {
    this.removals += 1;
  }
}

class FakeBackbone implements EventBackbonePort {
  published: InvalidationEvent[] = [];

  async publish(event: InvalidationEvent): Promise<void> {
    this.published.push(event);
  }
}

const service = (options: { store?: InMemoryIngestionOwnerStore; governance?: FakeGovernance; embedding?: FakeEmbedding; index?: FakeIndex; backbone?: FakeBackbone; limits?: Partial<IngestionBounds> } = {}) => {
  const governance = options.governance ?? new FakeGovernance();
  const embedding = options.embedding ?? new FakeEmbedding();
  const index = options.index ?? new FakeIndex();
  const backbone = options.backbone ?? new FakeBackbone();
  const ingestion = new IngestionService(governance, embedding, index, options.store ?? new InMemoryIngestionOwnerStore(), backbone, bounds(options.limits));
  return { ingestion, governance, embedding, index, backbone };
};

describe("Track 4 durable bounded ingestion", () => {
  it("replays a durable queued job after restart and publishes exactly one committed generation", async () => {
    const store = new InMemoryIngestionOwnerStore();
    const first = service({ store });
    await first.ingestion.enqueueIngest(request());

    const restartedStore = new InMemoryIngestionOwnerStore(store.snapshot());
    const restarted = service({ store: restartedStore });
    await restarted.ingestion.drain();

    expect(await restarted.ingestion.currentVersion("policy-handbook")).toBe("policy-handbook@2026-08-21");
    expect(restarted.index.writes).toBe(1);
    expect(restarted.index.commits).toBe(1);
    expect(restarted.backbone.published.map((event) => event.type)).toEqual(["document.indexed"]);
  });

  it("deduplicates duplicate delivery by source/version/profile and rejects conflicting reuse", async () => {
    const { ingestion, governance } = service();
    await ingestion.enqueueIngest(request());
    await ingestion.enqueueIngest(request({ versionRef: "policy-handbook@2026-08-21" }));
    await ingestion.drain();

    expect(governance.registrations).toBe(1);
    expect(ingestion.snapshot().jobs).toHaveLength(1);
    await expect(ingestion.enqueueIngest(request({ contentDigest: digest("e") }))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("quarantines poison parser output without retrying or publishing", async () => {
    const { ingestion, governance, index, backbone } = service();
    await ingestion.enqueueIngest(
      request({
        parse: { status: "quarantined", renditionDigest: digest("b"), chunks: [], quarantineReason: "malware signature" },
      }),
    );
    await ingestion.drain();

    const stored = await ingestion.version("policy-handbook@2026-08-21");
    expect(stored?.state).toBe("QUARANTINED");
    expect(ingestion.snapshot().quarantine).toHaveLength(1);
    expect(governance.registrations).toBe(0);
    expect(index.commits).toBe(0);
    expect(backbone.published).toHaveLength(0);
  });

  it("enforces bounded admission and recovery-surge throttling", async () => {
    const store = new InMemoryIngestionOwnerStore();
    const { ingestion, index } = service({ store, limits: { maxQueuedJobs: 2, recoverySurgeMaxJobsPerDrain: 1 } });
    await ingestion.enqueueIngest(request({ documentRef: "a", versionRef: "a@1", version: "1" }));
    await ingestion.enqueueIngest(request({ documentRef: "b", versionRef: "b@1", version: "2", contentDigest: digest("e") }));
    await expect(ingestion.enqueueIngest(request({ documentRef: "c", versionRef: "c@1", version: "3", contentDigest: digest("f") }))).rejects.toMatchObject({ code: "BACKPRESSURE" });

    const firstDrain = await ingestion.drain();
    expect(firstDrain.processedJobs).toBe(1);
    expect(index.commits).toBe(1);
    expect(await ingestion.currentVersion("b")).toBeUndefined();

    const secondDrain = await ingestion.drain();
    expect(secondDrain.processedJobs).toBe(1);
    expect(index.commits).toBe(2);
  });

  it("moves exhausted transient failures into a bounded dead-letter queue", async () => {
    const embedding = new FakeEmbedding();
    embedding.fail = true;
    const { ingestion } = service({ embedding, limits: { maxRetryAttemptsPerStage: 2 } });
    await ingestion.enqueueIngest(request());
    await ingestion.drain();
    await ingestion.drain();

    const stored = await ingestion.version("policy-handbook@2026-08-21");
    expect(stored?.state).toBe("DEAD_LETTERED");
    expect(ingestion.snapshot().deadLetters).toHaveLength(1);
  });

  it("deletes the active version through the owner job and emits a removal event", async () => {
    const { ingestion, governance, index, backbone } = service();
    await ingestion.ingest(request());
    await ingestion.withdraw("policy-handbook@2026-08-21");

    expect(await ingestion.currentVersion("policy-handbook")).toBeUndefined();
    expect((await ingestion.version("policy-handbook@2026-08-21"))?.state).toBe("WITHDRAWN");
    expect(governance.withdrawals).toBe(1);
    expect(index.removals).toBe(1);
    expect(backbone.published.map((event) => event.type)).toEqual(["document.indexed", "document.removed"]);
  });

  it("never publishes or activates a generation that fails verification", async () => {
    const index = new FakeIndex();
    index.verified = false;
    const { ingestion, governance, backbone } = service({ index });
    await ingestion.enqueueIngest(request());
    await ingestion.drain();

    const stored = await ingestion.version("policy-handbook@2026-08-21");
    expect(stored?.state).toBe("QUARANTINED");
    expect(governance.activations).toBe(0);
    expect(index.commits).toBe(0);
    expect(backbone.published).toHaveLength(0);
  });

  it("fails closed when retry output cannot fit the configured DLQ bound", async () => {
    const embedding = new FakeEmbedding();
    embedding.fail = true;
    const { ingestion } = service({ embedding, limits: { maxRetryAttemptsPerStage: 1, maxDlqItems: 0 } });
    await ingestion.enqueueIngest(request());

    await expect(ingestion.drain()).rejects.toBeInstanceOf(IngestionError);
  });
});
