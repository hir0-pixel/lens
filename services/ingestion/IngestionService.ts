export type IngestionState = "DISCOVERED" | "QUARANTINED" | "COMMITTED" | "WITHDRAWN" | "RECONCILIATION_REQUIRED";

export class IngestionError extends Error {
  constructor(readonly code: "INVALID_ARGUMENT" | "CONFLICT" | "QUARANTINED" | "STALE_AUTHORITY" | "DEPENDENCY_UNAVAILABLE", message: string) {
    super(message);
  }
}

export interface ParsedChunk {
  chunkRef: string;
  contentDigest: `sha256:${string}`;
  citationAnchor: string;
}

export interface AttestedParseResult {
  status: "accepted" | "quarantined";
  renditionDigest: `sha256:${string}`;
  chunks: readonly ParsedChunk[];
  quarantineReason?: string;
}

export interface IngestionRequest {
  sourceId: string;
  documentRef: string;
  version: string;
  versionRef: string;
  contentDigest: `sha256:${string}`;
  parse: AttestedParseResult;
}

export interface GovernancePort {
  registerVersion(input: Pick<IngestionRequest, "versionRef" | "contentDigest">): Promise<{ resourceSecurityRevision: number }>;
  activatePublishedVersion(input: { versionRef: string; expectedResourceSecurityRevision: number; indexGeneration: string }): Promise<{ resourceSecurityRevision: number }>;
  withdrawVersion(input: { versionRef: string; expectedResourceSecurityRevision: number }): Promise<void>;
}

export interface EmbeddingPort {
  embed(input: { versionRef: string; chunks: readonly ParsedChunk[] }): Promise<{ profileRef: string; vectorsDigest: `sha256:${string}` }>;
}

export interface IndexPort {
  writeGeneration(input: { generation: string; versionRef: string; chunks: readonly ParsedChunk[]; vectorsDigest: `sha256:${string}`; profileRef: string }): Promise<void>;
  commitGeneration(input: { documentRef: string; versionRef: string; generation: string; resourceSecurityRevision: number }): Promise<void>;
  removeGeneration(input: { documentRef: string; versionRef: string; generation: string }): Promise<void>;
}

export interface InvalidationEvent {
  eventId: string;
  type: "document.indexed" | "document.removed" | "document.version.superseded";
  documentRef: string;
  versionRef: string;
  resourceSecurityRevision: number;
}

interface VersionRecord {
  request: IngestionRequest;
  state: IngestionState;
  resourceSecurityRevision?: number;
  generation?: string;
}

/** M05 owner for immutable ingestion manifests and serving-index publication. */
export class IngestionService {
  private readonly versions = new Map<string, VersionRecord>();
  private readonly current = new Map<string, string>();
  private eventSequence = 0;
  readonly outbox: InvalidationEvent[] = [];

  constructor(
    private readonly governance: GovernancePort,
    private readonly embedding: EmbeddingPort,
    private readonly index: IndexPort,
  ) {}

  async ingest(request: IngestionRequest): Promise<VersionRecord> {
    this.validateRequest(request);
    const existing = this.versions.get(request.versionRef);
    if (existing) {
      if (existing.request.contentDigest !== request.contentDigest || existing.request.version !== request.version) {
        throw new IngestionError("CONFLICT", "The immutable version reference was reused.");
      }
      if (existing.state === "RECONCILIATION_REQUIRED") {
        throw new IngestionError("DEPENDENCY_UNAVAILABLE", "The previous publication attempt requires reconciliation.");
      }
      return this.copy(existing);
    }
    if (request.parse.status === "quarantined") {
      const record: VersionRecord = { request, state: "QUARANTINED" };
      this.versions.set(request.versionRef, record);
      throw new IngestionError("QUARANTINED", "The version was quarantined by the isolated parser.");
    }

    const record: VersionRecord = { request, state: "DISCOVERED" };
    this.versions.set(request.versionRef, record);
    let generation: string | undefined;
    let activatedRevision: number | undefined;
    try {
      const registered = await this.governance.registerVersion(request);
      const embedding = await this.embedding.embed({ versionRef: request.versionRef, chunks: request.parse.chunks });
      generation = `index:${request.versionRef}:${embedding.vectorsDigest}`;
      await this.index.writeGeneration({ generation, versionRef: request.versionRef, chunks: request.parse.chunks, vectorsDigest: embedding.vectorsDigest, profileRef: embedding.profileRef });
      const published = await this.governance.activatePublishedVersion({ versionRef: request.versionRef, expectedResourceSecurityRevision: registered.resourceSecurityRevision, indexGeneration: generation });
      activatedRevision = published.resourceSecurityRevision;
      await this.index.commitGeneration({ documentRef: request.documentRef, versionRef: request.versionRef, generation, resourceSecurityRevision: published.resourceSecurityRevision });
      const prior = this.current.get(request.documentRef);
      record.state = "COMMITTED";
      record.resourceSecurityRevision = published.resourceSecurityRevision;
      record.generation = generation;
      this.current.set(request.documentRef, request.versionRef);
      this.emit("document.indexed", record);
      if (prior && prior !== request.versionRef) this.emit("document.version.superseded", record);
      return this.copy(record);
    } catch (error) {
      if (activatedRevision !== undefined && generation) {
        try {
          await this.governance.withdrawVersion({ versionRef: request.versionRef, expectedResourceSecurityRevision: activatedRevision });
          await this.index.removeGeneration({ documentRef: request.documentRef, versionRef: request.versionRef, generation });
        } catch {
          record.state = "RECONCILIATION_REQUIRED";
          throw new IngestionError("DEPENDENCY_UNAVAILABLE", "Publication cleanup could not be completed safely.");
        }
      }
      this.versions.delete(request.versionRef);
      throw error;
    }
  }

  async withdraw(versionRef: string): Promise<void> {
    const record = this.requireCommitted(versionRef);
    await this.governance.withdrawVersion({ versionRef, expectedResourceSecurityRevision: record.resourceSecurityRevision! });
    await this.index.removeGeneration({ documentRef: record.request.documentRef, versionRef, generation: record.generation! });
    record.state = "WITHDRAWN";
    if (this.current.get(record.request.documentRef) === versionRef) this.current.delete(record.request.documentRef);
    this.emit("document.removed", record);
  }

  async rollback(documentRef: string, targetVersionRef: string): Promise<void> {
    const target = this.requireCommitted(targetVersionRef);
    if (target.request.documentRef !== documentRef) throw new IngestionError("INVALID_ARGUMENT", "The rollback target belongs to another document.");
    await this.index.commitGeneration({ documentRef, versionRef: targetVersionRef, generation: target.generation!, resourceSecurityRevision: target.resourceSecurityRevision! });
    this.current.set(documentRef, targetVersionRef);
    this.emit("document.indexed", target);
  }

  currentVersion(documentRef: string): string | undefined {
    return this.current.get(documentRef);
  }

  private validateRequest(request: IngestionRequest): void {
    if (!request.sourceId || !request.documentRef || !request.version || !request.versionRef || !/^sha256:[a-f0-9]{64}$/.test(request.contentDigest) || !/^sha256:[a-f0-9]{64}$/.test(request.parse.renditionDigest)) {
      throw new IngestionError("INVALID_ARGUMENT", "The immutable version is invalid.");
    }
    if (request.parse.status === "accepted" && request.parse.chunks.length === 0) {
      throw new IngestionError("INVALID_ARGUMENT", "Accepted content requires immutable chunks.");
    }
  }

  private requireCommitted(versionRef: string): VersionRecord {
    const record = this.versions.get(versionRef);
    if (!record || record.state !== "COMMITTED" || !record.generation || record.resourceSecurityRevision === undefined) {
      throw new IngestionError("STALE_AUTHORITY", "The requested version is not committed.");
    }
    return record;
  }

  private emit(type: InvalidationEvent["type"], record: VersionRecord): void {
    this.outbox.push({ eventId: `ingestion-${++this.eventSequence}`, type, documentRef: record.request.documentRef, versionRef: record.request.versionRef, resourceSecurityRevision: record.resourceSecurityRevision ?? 0 });
  }

  private copy(record: VersionRecord): VersionRecord {
    return { ...record, request: { ...record.request, parse: { ...record.request.parse, chunks: [...record.request.parse.chunks] } } };
  }
}
