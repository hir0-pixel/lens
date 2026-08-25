import type { Classification } from "../governance/GovernanceAuthority";

export type IngestionStage =
  | "DISCOVERED"
  | "PARSING"
  | "CONTENT_VALIDATION"
  | "CLASSIFICATION_RESERVED"
  | "CHUNKING"
  | "EMBEDDING"
  | "INDEXING"
  | "VERIFYING"
  | "PUBLISHING";

export type IngestionState =
  | IngestionStage
  | "QUEUED"
  | "RUNNING"
  | "QUARANTINED"
  | "COMMITTED"
  | "WITHDRAWN"
  | "DEAD_LETTERED"
  | "RECONCILIATION_REQUIRED";

export class IngestionError extends Error {
  constructor(
    readonly code:
      | "INVALID_ARGUMENT"
      | "CONFLICT"
      | "QUARANTINED"
      | "STALE_AUTHORITY"
      | "DEPENDENCY_UNAVAILABLE"
      | "BACKPRESSURE"
      | "POISONED",
    message: string,
  ) {
    super(message);
  }
}

export interface ParsedChunk {
  chunkRef: string;
  contentDigest: `sha256:${string}`;
  text: string;
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
  classificationRef: Classification;
  aclDigest: `sha256:${string}`;
  profileRef?: string;
  contentBytes?: number;
}

export interface GovernancePort {
  registerVersion(input: Pick<IngestionRequest, "versionRef" | "contentDigest" | "classificationRef" | "aclDigest">): Promise<{ resourceSecurityRevision: number }>;
  activatePublishedVersion(input: { versionRef: string; expectedResourceSecurityRevision: number; indexGeneration: string }): Promise<{ resourceSecurityRevision: number }>;
  withdrawVersion(input: { versionRef: string; expectedResourceSecurityRevision: number }): Promise<void>;
  getCurrentResourceSecurityRevision?(versionRef: string): Promise<number>;
}

export interface EmbeddingPort {
  embed(input: { versionRef: string; chunks: readonly ParsedChunk[]; profileRef: string }): Promise<{ profileRef: string; vectorsDigest: `sha256:${string}`; vectors: readonly (readonly number[])[] }>;
}

export interface IndexPort {
  writeGeneration(input: { generation: string; versionRef: string; chunks: readonly ParsedChunk[]; vectorsDigest: `sha256:${string}`; vectors: readonly (readonly number[])[]; profileRef: string; classificationRef: Classification }): Promise<void>;
  verifyGeneration(input: { generation: string; versionRef: string; vectorsDigest: `sha256:${string}`; profileRef: string }): Promise<{ verified: boolean; reason?: string }>;
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

export interface EventBackbonePort {
  publish(event: InvalidationEvent): Promise<void>;
}

export interface IngestionBounds {
  maxQueuedJobs: number;
  maxActiveJobs: number;
  maxQueueBytes: number;
  maxJobAgeMs: number;
  maxRetryAttemptsPerStage: number;
  retryBackoffMs: number;
  maxDlqItems: number;
  maxDlqBytes: number;
  maxDlqAgeMs: number;
  maxQuarantineItems: number;
  maxQuarantineBytes: number;
  maxQuarantineAgeMs: number;
  maxDiskBytes: number;
  recoverySurgeMaxJobsPerDrain: number;
  maxOutboxEvents: number;
  maxOutboxBytes: number;
}

export interface VersionRecord {
  request: IngestionRequest;
  state: IngestionState;
  stage: IngestionStage;
  resourceSecurityRevision?: number;
  generation?: string;
  profileRef: string;
  idempotencyKey: string;
}

export interface IngestionJobRecord extends VersionRecord {
  jobId: string;
  jobType: "INGEST" | "DELETE";
  attemptsByStage: Partial<Record<IngestionStage, number>>;
  byteSize: number;
  createdAtMs: number;
  updatedAtMs: number;
  availableAtMs: number;
  retryBudgetRemaining: number;
  quarantineReason?: string;
  deadLetterReason?: string;
  vectorsDigest?: `sha256:${string}`;
  expectedResourceSecurityRevision?: number;
}

export interface IngestionOutboxRecord {
  event: InvalidationEvent;
  state: "PENDING" | "IN_FLIGHT" | "PUBLISHED" | "DEAD_LETTERED";
  attempts: number;
  byteSize: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface IngestionOwnerSnapshot {
  jobs: IngestionJobRecord[];
  versions: VersionRecord[];
  current: Array<[string, string]>;
  idempotency: Array<[string, string]>;
  outbox: IngestionOutboxRecord[];
  quarantine: IngestionJobRecord[];
  deadLetters: IngestionJobRecord[];
}

export interface DrainResult {
  processedJobs: number;
  publishedEvents: number;
}

export interface IngestionOwnerStore {
  transaction<T>(work: (state: IngestionOwnerMutableState) => T): Promise<T>;
  snapshot(): IngestionOwnerSnapshot;
}

export interface IngestionOwnerMutableState {
  jobs: Map<string, IngestionJobRecord>;
  versions: Map<string, VersionRecord>;
  current: Map<string, string>;
  idempotency: Map<string, string>;
  outbox: Map<string, IngestionOutboxRecord>;
  quarantine: Map<string, IngestionJobRecord>;
  deadLetters: Map<string, IngestionJobRecord>;
}

const DEFAULT_PROFILE_REF = "default-ingestion-profile";
const TERMINAL_STATES = new Set<IngestionState>(["QUARANTINED", "COMMITTED", "WITHDRAWN", "DEAD_LETTERED", "RECONCILIATION_REQUIRED"]);

class CleanedPublicationError extends Error {
  constructor(readonly original: unknown) {
    super(original instanceof Error ? original.message : "Publication failed after activation.");
  }
}

export const DEFAULT_INGESTION_BOUNDS: IngestionBounds = {
  maxQueuedJobs: 10_000,
  maxActiveJobs: 64,
  maxQueueBytes: 2 * 1024 * 1024 * 1024,
  maxJobAgeMs: 24 * 60 * 60 * 1000,
  maxRetryAttemptsPerStage: 5,
  retryBackoffMs: 1_000,
  maxDlqItems: 1_000,
  maxDlqBytes: 256 * 1024 * 1024,
  maxDlqAgeMs: 30 * 24 * 60 * 60 * 1000,
  maxQuarantineItems: 5_000,
  maxQuarantineBytes: 1024 * 1024 * 1024,
  maxQuarantineAgeMs: 90 * 24 * 60 * 60 * 1000,
  maxDiskBytes: 4 * 1024 * 1024 * 1024,
  recoverySurgeMaxJobsPerDrain: 32,
  maxOutboxEvents: 100_000,
  maxOutboxBytes: 512 * 1024 * 1024,
};

export class InMemoryIngestionOwnerStore implements IngestionOwnerStore {
  private readonly state: IngestionOwnerMutableState;

  constructor(snapshot?: IngestionOwnerSnapshot) {
    this.state = {
      jobs: new Map(snapshot?.jobs.map((job) => [job.jobId, cloneJob(job)]) ?? []),
      versions: new Map(snapshot?.versions.map((record) => [record.request.versionRef, cloneVersion(record)]) ?? []),
      current: new Map(snapshot?.current ?? []),
      idempotency: new Map(snapshot?.idempotency ?? []),
      outbox: new Map(snapshot?.outbox.map((record) => [record.event.eventId, cloneOutbox(record)]) ?? []),
      quarantine: new Map(snapshot?.quarantine.map((job) => [job.jobId, cloneJob(job)]) ?? []),
      deadLetters: new Map(snapshot?.deadLetters.map((job) => [job.jobId, cloneJob(job)]) ?? []),
    };
  }

  async transaction<T>(work: (state: IngestionOwnerMutableState) => T): Promise<T> {
    return work(this.state);
  }

  snapshot(): IngestionOwnerSnapshot {
    return {
      jobs: [...this.state.jobs.values()].map(cloneJob),
      versions: [...this.state.versions.values()].map(cloneVersion),
      current: [...this.state.current.entries()],
      idempotency: [...this.state.idempotency.entries()],
      outbox: [...this.state.outbox.values()].map(cloneOutbox),
      quarantine: [...this.state.quarantine.values()].map(cloneJob),
      deadLetters: [...this.state.deadLetters.values()].map(cloneJob),
    };
  }
}

/** M05 owner for durable bounded ingestion jobs, transactional outbox, and safe serving-index publication. */
export class IngestionService {
  constructor(
    private readonly governance: GovernancePort,
    private readonly embedding: EmbeddingPort,
    private readonly index: IndexPort,
    private readonly store: IngestionOwnerStore = new InMemoryIngestionOwnerStore(),
    private readonly eventBackbone?: EventBackbonePort,
    private readonly bounds: IngestionBounds = DEFAULT_INGESTION_BOUNDS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get outbox(): InvalidationEvent[] {
    return this.snapshot().outbox.map((record) => ({ ...record.event }));
  }

  async enqueueIngest(request: IngestionRequest): Promise<IngestionJobRecord> {
    this.validateRequest(request);
    const normalized = this.normalizeRequest(request);
    const idempotencyKey = this.idempotencyKey(normalized);
    const jobId = `ingest:${idempotencyKey}`;
    const byteSize = this.estimateBytes(normalized);
    const now = this.now();

    return this.store.transaction((state) => {
      this.evictExpired(state, now);
      const existingJobId = state.idempotency.get(idempotencyKey);
      if (existingJobId) {
        const existing = state.jobs.get(existingJobId) ?? state.quarantine.get(existingJobId) ?? state.deadLetters.get(existingJobId);
        if (!existing) throw new IngestionError("STALE_AUTHORITY", "The idempotency owner record is missing.");
        this.assertSameImmutableInput(existing.request, normalized);
        return cloneJob(existing);
      }

      const existingVersion = state.versions.get(normalized.versionRef);
      if (existingVersion) {
        this.assertSameImmutableInput(existingVersion.request, normalized);
        return cloneJob(this.versionToJob(existingVersion, jobId, byteSize, now));
      }

      this.assertBoundedAdmission(state, byteSize, now);
      const job = this.newJob({ jobId, jobType: "INGEST", request: normalized, idempotencyKey, byteSize, now });
      state.jobs.set(job.jobId, job);
      state.versions.set(normalized.versionRef, this.toVersion(job));
      state.idempotency.set(idempotencyKey, job.jobId);
      return cloneJob(job);
    });
  }

  async enqueueWithdraw(versionRef: string): Promise<IngestionJobRecord> {
    const now = this.now();
    return this.store.transaction((state) => {
      this.evictExpired(state, now);
      const version = state.versions.get(versionRef);
      if (!version || version.state !== "COMMITTED" || !version.generation || version.resourceSecurityRevision === undefined) {
        throw new IngestionError("STALE_AUTHORITY", "The requested version is not committed.");
      }
      const jobId = `delete:${versionRef}`;
      const existing = state.jobs.get(jobId) ?? state.deadLetters.get(jobId);
      if (existing) return cloneJob(existing);
      this.assertBoundedAdmission(state, this.estimateBytes(version.request), now);
      const job = this.newJob({
        jobId,
        jobType: "DELETE",
        request: version.request,
        idempotencyKey: `delete:${versionRef}`,
        byteSize: this.estimateBytes(version.request),
        now,
      });
      job.stage = "PUBLISHING";
      job.state = "QUEUED";
      job.resourceSecurityRevision = version.resourceSecurityRevision;
      job.generation = version.generation;
      state.jobs.set(job.jobId, job);
      return cloneJob(job);
    });
  }

  async ingest(request: IngestionRequest): Promise<VersionRecord> {
    await this.enqueueIngest(request);
    await this.drain();
    const record = await this.version(request.versionRef);
    if (!record) throw new IngestionError("DEPENDENCY_UNAVAILABLE", "The ingestion job did not persist a version record.");
    if (record.state === "QUARANTINED") throw new IngestionError("QUARANTINED", "The version was quarantined.");
    if (record.state === "DEAD_LETTERED") throw new IngestionError("DEPENDENCY_UNAVAILABLE", "The ingestion job exhausted its retry budget.");
    if (record.state !== "COMMITTED") throw new IngestionError("DEPENDENCY_UNAVAILABLE", "The ingestion job has not reached a committed state.");
    return record;
  }

  async withdraw(versionRef: string): Promise<void> {
    await this.enqueueWithdraw(versionRef);
    const maxAttempts = this.bounds.maxRetryAttemptsPerStage * 2 + 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await this.drain();
      const record = await this.version(versionRef);
      if (record?.state === "WITHDRAWN") return;
      if (attempt + 1 >= maxAttempts) break;
      const job = this.snapshot().jobs.find((candidate) => candidate.jobId === `delete:${versionRef}`);
      if (!job || job.state !== "QUEUED") break;
      const waitMs = Math.max(0, job.availableAtMs - this.now());
      if (waitMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
    throw new IngestionError("DEPENDENCY_UNAVAILABLE", "The deletion job has not reached a withdrawn state.");
  }

  async rollback(documentRef: string, targetVersionRef: string): Promise<void> {
    const target = await this.version(targetVersionRef);
    if (!target || target.state !== "COMMITTED" || !target.generation || target.resourceSecurityRevision === undefined) {
      throw new IngestionError("STALE_AUTHORITY", "The requested version is not committed.");
    }
    if (target.request.documentRef !== documentRef) throw new IngestionError("INVALID_ARGUMENT", "The rollback target belongs to another document.");
    await this.index.commitGeneration({ documentRef, versionRef: targetVersionRef, generation: target.generation, resourceSecurityRevision: target.resourceSecurityRevision });
    await this.store.transaction((state) => {
      state.current.set(documentRef, targetVersionRef);
      this.appendOutbox(state, "document.indexed", target);
    });
  }

  async runNextJob(): Promise<boolean> {
    const job = await this.reserveNextJob();
    if (!job) return false;
    if (job.jobType === "DELETE") return this.processDeletion(job);
    return this.processIngestion(job);
  }

  async drain(limit = this.bounds.recoverySurgeMaxJobsPerDrain): Promise<DrainResult> {
    let processedJobs = 0;
    const jobLimit = Math.max(0, Math.min(limit, this.bounds.recoverySurgeMaxJobsPerDrain));
    for (let i = 0; i < jobLimit; i += 1) {
      const processed = await this.runNextJob();
      if (!processed) break;
      processedJobs += 1;
    }
    const publishedEvents = await this.publishOutbox(this.bounds.recoverySurgeMaxJobsPerDrain);
    return { processedJobs, publishedEvents };
  }

  async publishOutbox(limit = this.bounds.recoverySurgeMaxJobsPerDrain): Promise<number> {
    if (!this.eventBackbone) return 0;
    const records = await this.store.transaction((state) => {
      const pending = [...state.outbox.values()]
        .filter((record) => record.state === "PENDING")
        .sort((a, b) => a.createdAtMs - b.createdAtMs)
        .slice(0, Math.max(0, limit))
        .map(cloneOutbox);
      for (const record of pending) {
        const stored = state.outbox.get(record.event.eventId);
        if (stored) {
          stored.state = "IN_FLIGHT";
          stored.attempts += 1;
          stored.updatedAtMs = this.now();
        }
      }
      return pending;
    });

    let published = 0;
    for (const record of records) {
      try {
        await this.eventBackbone.publish(record.event);
        await this.store.transaction((state) => {
          const stored = state.outbox.get(record.event.eventId);
          if (stored) {
            stored.state = "PUBLISHED";
            stored.updatedAtMs = this.now();
          }
        });
        published += 1;
      } catch {
        await this.store.transaction((state) => {
          const stored = state.outbox.get(record.event.eventId);
          if (!stored) return;
          stored.state = stored.attempts >= this.bounds.maxRetryAttemptsPerStage ? "DEAD_LETTERED" : "PENDING";
          stored.updatedAtMs = this.now();
        });
      }
    }
    return published;
  }

  currentVersion(documentRef: string): string | undefined {
    return this.snapshot().current.find(([candidate]) => candidate === documentRef)?.[1];
  }

  async version(versionRef: string): Promise<VersionRecord | undefined> {
    return this.store.transaction((state) => {
      const record = state.versions.get(versionRef);
      return record ? cloneVersion(record) : undefined;
    });
  }

  snapshot(): IngestionOwnerSnapshot {
    return this.store.snapshot();
  }

  private async reserveNextJob(): Promise<IngestionJobRecord | undefined> {
    const now = this.now();
    return this.store.transaction((state) => {
      this.evictExpired(state, now);
      const active = [...state.jobs.values()].filter((job) => job.state === "RUNNING").length;
      if (active >= this.bounds.maxActiveJobs) return undefined;
      const job = [...state.jobs.values()]
        .filter((candidate) => candidate.state === "QUEUED" && candidate.availableAtMs <= now)
        .sort((a, b) => a.createdAtMs - b.createdAtMs)[0];
      if (!job) return undefined;
      if (now - job.createdAtMs > this.bounds.maxJobAgeMs) {
        this.deadLetter(state, job, "JOB_AGE_EXCEEDED", now);
        return undefined;
      }
      job.state = "RUNNING";
      job.updatedAtMs = now;
      return cloneJob(job);
    });
  }

  private async processIngestion(job: IngestionJobRecord): Promise<boolean> {
    try {
      if (job.request.parse.status === "quarantined") {
        await this.quarantine(job, job.request.parse.quarantineReason ?? "PARSER_REJECTED");
        return true;
      }
      await this.advance(job, "PARSING", () => this.assertAcceptedParse(job.request));
      await this.advance(job, "CONTENT_VALIDATION", () => this.assertDigestSet(job.request));
      const registered = await this.advance(job, "CLASSIFICATION_RESERVED", () => this.governance.registerVersion(job.request));
      await this.advance(job, "CHUNKING", () => this.assertChunks(job.request));
      const embedding = await this.advance(job, "EMBEDDING", () => this.embedding.embed({ versionRef: job.request.versionRef, chunks: job.request.parse.chunks, profileRef: job.profileRef }));
      const generation = this.generationRef(job.request.versionRef, embedding.profileRef, embedding.vectorsDigest);
      await this.advance(job, "INDEXING", () => this.index.writeGeneration({ generation, versionRef: job.request.versionRef, chunks: job.request.parse.chunks, vectorsDigest: embedding.vectorsDigest, vectors: embedding.vectors, profileRef: embedding.profileRef, classificationRef: job.request.classificationRef }));
      const verification = await this.advance(job, "VERIFYING", () => this.verifyGeneration({ generation, versionRef: job.request.versionRef, vectorsDigest: embedding.vectorsDigest, profileRef: embedding.profileRef }));
      if (!verification.verified) {
        await this.quarantine({ ...job, generation, vectorsDigest: embedding.vectorsDigest, profileRef: embedding.profileRef }, verification.reason ?? "UNVERIFIABLE_GENERATION");
        return true;
      }
      const published = await this.advance(job, "PUBLISHING", () => this.governance.activatePublishedVersion({ versionRef: job.request.versionRef, expectedResourceSecurityRevision: registered.resourceSecurityRevision, indexGeneration: generation }));
      try {
        await this.index.commitGeneration({ documentRef: job.request.documentRef, versionRef: job.request.versionRef, generation, resourceSecurityRevision: published.resourceSecurityRevision });
      } catch (error) {
        try {
          await this.governance.withdrawVersion({ versionRef: job.request.versionRef, expectedResourceSecurityRevision: published.resourceSecurityRevision });
          await this.index.removeGeneration({ documentRef: job.request.documentRef, versionRef: job.request.versionRef, generation });
          await this.removeFailedJob(job);
        } catch {
          await this.markReconciliationRequired(job, generation, published.resourceSecurityRevision);
          throw new IngestionError("DEPENDENCY_UNAVAILABLE", "Publication cleanup could not be completed safely.");
        }
        throw new CleanedPublicationError(error);
      }
      await this.store.transaction((state) => {
        const stored = this.requireJob(state, job.jobId);
        const prior = state.current.get(job.request.documentRef);
        stored.state = "COMMITTED";
        stored.stage = "PUBLISHING";
        stored.resourceSecurityRevision = published.resourceSecurityRevision;
        stored.generation = generation;
        stored.profileRef = embedding.profileRef;
        stored.vectorsDigest = embedding.vectorsDigest;
        stored.updatedAtMs = this.now();
        state.versions.set(job.request.versionRef, this.toVersion(stored));
        state.current.set(job.request.documentRef, job.request.versionRef);
        this.appendOutbox(state, "document.indexed", stored);
        if (prior && prior !== job.request.versionRef) this.appendOutbox(state, "document.version.superseded", stored);
      });
      return true;
    } catch (error) {
      if (error instanceof CleanedPublicationError) throw error.original;
      if (error instanceof IngestionError && error.code === "STALE_AUTHORITY") {
        await this.removeFailedJob(job);
        throw error;
      }
      await this.recordFailure(job, error);
      return true;
    }
  }

  private async processDeletion(job: IngestionJobRecord): Promise<boolean> {
    try {
      if (!job.generation || job.resourceSecurityRevision === undefined) throw new IngestionError("STALE_AUTHORITY", "Deletion requires a committed generation.");
      await this.governance.withdrawVersion({ versionRef: job.request.versionRef, expectedResourceSecurityRevision: job.resourceSecurityRevision });
      await this.index.removeGeneration({ documentRef: job.request.documentRef, versionRef: job.request.versionRef, generation: job.generation });
      await this.store.transaction((state) => {
        const stored = this.requireJob(state, job.jobId);
        stored.state = "WITHDRAWN";
        stored.updatedAtMs = this.now();
        state.versions.set(job.request.versionRef, this.toVersion(stored));
        if (state.current.get(job.request.documentRef) === job.request.versionRef) state.current.delete(job.request.documentRef);
        this.appendOutbox(state, "document.removed", stored);
        state.jobs.delete(job.jobId);
      });
      return true;
    } catch (error) {
      if (this.isStaleAuthority(error) && this.governance.getCurrentResourceSecurityRevision) {
        try {
          const revision = await this.governance.getCurrentResourceSecurityRevision(job.request.versionRef);
          await this.store.transaction((state) => {
            const stored = this.requireJob(state, job.jobId);
            stored.resourceSecurityRevision = revision;
            state.versions.set(stored.request.versionRef, this.toVersion(stored));
          });
        } catch {
          // Keep the original failure when governance cannot be read safely.
        }
      }
      await this.recordFailure(job, error);
      return true;
    }
  }

  private async advance<T>(job: IngestionJobRecord, stage: IngestionStage, work: () => T | Promise<T>): Promise<T> {
    await this.store.transaction((state) => {
      const stored = this.requireJob(state, job.jobId);
      stored.stage = stage;
      stored.state = "RUNNING";
      stored.attemptsByStage[stage] = (stored.attemptsByStage[stage] ?? 0) + 1;
      stored.updatedAtMs = this.now();
      state.versions.set(stored.request.versionRef, this.toVersion(stored));
    });
    return work();
  }

  private async recordFailure(job: IngestionJobRecord, error: unknown): Promise<void> {
    const now = this.now();
    await this.store.transaction((state) => {
      const stored = this.requireJob(state, job.jobId);
      if (this.isPoison(error)) {
        this.quarantineSync(state, stored, error instanceof IngestionError ? error.message : "POISONED", now);
        return;
      }
      const attempts = stored.attemptsByStage[stored.stage] ?? 0;
      if (attempts >= this.bounds.maxRetryAttemptsPerStage || stored.retryBudgetRemaining <= 0) {
        this.deadLetter(state, stored, error instanceof Error ? error.message : "UNKNOWN_FAILURE", now);
        return;
      }
      stored.retryBudgetRemaining -= 1;
      stored.state = "QUEUED";
      stored.availableAtMs = now + this.bounds.retryBackoffMs;
      stored.updatedAtMs = now;
      state.versions.set(stored.request.versionRef, this.toVersion(stored));
    });
  }

  private async removeFailedJob(job: IngestionJobRecord): Promise<void> {
    await this.store.transaction((state) => {
      state.jobs.delete(job.jobId);
      state.versions.delete(job.request.versionRef);
      state.idempotency.delete(job.idempotencyKey);
      if (state.current.get(job.request.documentRef) === job.request.versionRef) state.current.delete(job.request.documentRef);
    });
  }

  private async markReconciliationRequired(job: IngestionJobRecord, generation: string, resourceSecurityRevision: number): Promise<void> {
    await this.store.transaction((state) => {
      const stored = this.requireJob(state, job.jobId);
      stored.state = "RECONCILIATION_REQUIRED";
      stored.generation = generation;
      stored.resourceSecurityRevision = resourceSecurityRevision;
      stored.updatedAtMs = this.now();
      state.versions.set(job.request.versionRef, this.toVersion(stored));
    });
  }

  private async quarantine(job: IngestionJobRecord, reason: string): Promise<void> {
    await this.store.transaction((state) => {
      const stored = state.jobs.get(job.jobId) ?? job;
      this.quarantineSync(state, stored, reason, this.now());
    });
  }

  private quarantineSync(state: IngestionOwnerMutableState, job: IngestionJobRecord, reason: string, now: number): void {
    if (!this.canFitCollection([...state.quarantine.values()], job.byteSize, this.bounds.maxQuarantineItems, this.bounds.maxQuarantineBytes, now, this.bounds.maxQuarantineAgeMs)) {
      this.deadLetter(state, job, "QUARANTINE_BOUNDS_EXCEEDED", now);
      return;
    }
    job.state = "QUARANTINED";
    job.quarantineReason = reason;
    job.updatedAtMs = now;
    state.jobs.delete(job.jobId);
    state.quarantine.set(job.jobId, cloneJob(job));
    state.versions.set(job.request.versionRef, this.toVersion(job));
  }

  private deadLetter(state: IngestionOwnerMutableState, job: IngestionJobRecord, reason: string, now: number): void {
    if (!this.canFitCollection([...state.deadLetters.values()], job.byteSize, this.bounds.maxDlqItems, this.bounds.maxDlqBytes, now, this.bounds.maxDlqAgeMs)) {
      throw new IngestionError("BACKPRESSURE", "The ingestion dead-letter queue is full.");
    }
    job.state = "DEAD_LETTERED";
    job.deadLetterReason = reason;
    job.updatedAtMs = now;
    state.jobs.delete(job.jobId);
    state.deadLetters.set(job.jobId, cloneJob(job));
    state.versions.set(job.request.versionRef, this.toVersion(job));
  }

  private appendOutbox(state: IngestionOwnerMutableState, type: InvalidationEvent["type"], record: VersionRecord): void {
    const event: InvalidationEvent = {
      eventId: this.eventId(type, record),
      type,
      documentRef: record.request.documentRef,
      versionRef: record.request.versionRef,
      resourceSecurityRevision: record.resourceSecurityRevision ?? 0,
    };
    if (state.outbox.has(event.eventId)) return;
    const outboxRecord: IngestionOutboxRecord = {
      event,
      state: "PENDING",
      attempts: 0,
      byteSize: this.estimateEventBytes(event),
      createdAtMs: this.now(),
      updatedAtMs: this.now(),
    };
    const active = [...state.outbox.values()].filter((candidate) => candidate.state !== "PUBLISHED");
    const activeBytes = active.reduce((sum, candidate) => sum + candidate.byteSize, 0);
    if (active.length + 1 > this.bounds.maxOutboxEvents || activeBytes + outboxRecord.byteSize > this.bounds.maxOutboxBytes) {
      throw new IngestionError("BACKPRESSURE", "The ingestion outbox is full.");
    }
    state.outbox.set(event.eventId, outboxRecord);
  }

  private assertBoundedAdmission(state: IngestionOwnerMutableState, byteSize: number, now: number): void {
    const queued = [...state.jobs.values()].filter((job) => !TERMINAL_STATES.has(job.state));
    const queueBytes = queued.reduce((sum, job) => sum + job.byteSize, 0);
    const diskBytes = this.totalDiskBytes(state);
    if (queued.length + 1 > this.bounds.maxQueuedJobs || queueBytes + byteSize > this.bounds.maxQueueBytes || diskBytes + byteSize > this.bounds.maxDiskBytes) {
      throw new IngestionError("BACKPRESSURE", "The ingestion owner store is at its bounded capacity.");
    }
    const expired = queued.find((job) => now - job.createdAtMs > this.bounds.maxJobAgeMs);
    if (expired) throw new IngestionError("BACKPRESSURE", "An expired ingestion job must be drained before accepting more work.");
  }

  private evictExpired(state: IngestionOwnerMutableState, now: number): void {
    for (const job of [...state.quarantine.values()]) {
      if (now - job.updatedAtMs > this.bounds.maxQuarantineAgeMs) state.quarantine.delete(job.jobId);
    }
    for (const job of [...state.deadLetters.values()]) {
      if (now - job.updatedAtMs > this.bounds.maxDlqAgeMs) state.deadLetters.delete(job.jobId);
    }
  }

  private canFitCollection(collection: IngestionJobRecord[], nextBytes: number, maxItems: number, maxBytes: number, now: number, maxAgeMs: number): boolean {
    const live = collection.filter((job) => now - job.updatedAtMs <= maxAgeMs);
    const bytes = live.reduce((sum, job) => sum + job.byteSize, 0);
    return live.length + 1 <= maxItems && bytes + nextBytes <= maxBytes && this.totalCollectionBytes(collection) + nextBytes <= this.bounds.maxDiskBytes;
  }

  private totalDiskBytes(state: IngestionOwnerMutableState): number {
    return this.totalCollectionBytes([...state.jobs.values()]) + this.totalCollectionBytes([...state.quarantine.values()]) + this.totalCollectionBytes([...state.deadLetters.values()]) + [...state.outbox.values()].reduce((sum, record) => sum + record.byteSize, 0);
  }

  private totalCollectionBytes(collection: IngestionJobRecord[]): number {
    return collection.reduce((sum, job) => sum + job.byteSize, 0);
  }

  private normalizeRequest(request: IngestionRequest): IngestionRequest {
    return { ...request, profileRef: request.profileRef ?? DEFAULT_PROFILE_REF, parse: { ...request.parse, chunks: [...request.parse.chunks] } };
  }

  private validateRequest(request: IngestionRequest): void {
    if (!request.sourceId || !request.documentRef || !request.version || !request.versionRef || !isSha256(request.contentDigest) || !isSha256(request.aclDigest) || !isSha256(request.parse.renditionDigest)) {
      throw new IngestionError("INVALID_ARGUMENT", "The immutable version is invalid.");
    }
    if (request.contentBytes !== undefined && (!Number.isSafeInteger(request.contentBytes) || request.contentBytes < 0)) {
      throw new IngestionError("INVALID_ARGUMENT", "Content bytes must be a non-negative safe integer.");
    }
    if (request.parse.status === "accepted" && request.parse.chunks.length === 0) {
      throw new IngestionError("INVALID_ARGUMENT", "Accepted content requires immutable chunks.");
    }
  }

  private assertAcceptedParse(request: IngestionRequest): void {
    if (request.parse.status !== "accepted") throw new IngestionError("QUARANTINED", request.parse.quarantineReason ?? "The parser quarantined the document.");
  }

  private assertDigestSet(request: IngestionRequest): void {
    if (!isSha256(request.contentDigest) || !isSha256(request.parse.renditionDigest)) throw new IngestionError("POISONED", "The document digests are invalid.");
  }

  private assertChunks(request: IngestionRequest): void {
    if (request.parse.chunks.length === 0) throw new IngestionError("POISONED", "The document contains no accepted chunks.");
    for (const chunk of request.parse.chunks) {
      if (!chunk.chunkRef || !chunk.citationAnchor || !chunk.text || !isSha256(chunk.contentDigest)) throw new IngestionError("POISONED", "A chunk failed immutable reference validation.");
    }
  }

  private verifyGeneration(input: { generation: string; versionRef: string; vectorsDigest: `sha256:${string}`; profileRef: string }): Promise<{ verified: boolean; reason?: string }> {
    if (typeof this.index.verifyGeneration === "function") return this.index.verifyGeneration(input);
    return Promise.resolve({ verified: true });
  }

  private assertSameImmutableInput(a: IngestionRequest, b: IngestionRequest): void {
    if (a.sourceId !== b.sourceId || a.version !== b.version || a.profileRef !== b.profileRef || a.versionRef !== b.versionRef || a.documentRef !== b.documentRef || a.contentDigest !== b.contentDigest) {
      throw new IngestionError("CONFLICT", "The source/version/profile idempotency identity was reused with different immutable content.");
    }
  }

  private isPoison(error: unknown): boolean {
    return error instanceof IngestionError && (error.code === "QUARANTINED" || error.code === "POISONED" || error.code === "INVALID_ARGUMENT");
  }

  private isStaleAuthority(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "STALE_AUTHORITY";
  }

  private requireJob(state: IngestionOwnerMutableState, jobId: string): IngestionJobRecord {
    const job = state.jobs.get(jobId);
    if (!job) throw new IngestionError("STALE_AUTHORITY", "The durable ingestion job is missing.");
    return job;
  }

  private newJob(input: { jobId: string; jobType: "INGEST" | "DELETE"; request: IngestionRequest; idempotencyKey: string; byteSize: number; now: number }): IngestionJobRecord {
    return {
      jobId: input.jobId,
      jobType: input.jobType,
      request: input.request,
      state: "QUEUED",
      stage: "DISCOVERED",
      profileRef: input.request.profileRef ?? DEFAULT_PROFILE_REF,
      idempotencyKey: input.idempotencyKey,
      attemptsByStage: {},
      byteSize: input.byteSize,
      createdAtMs: input.now,
      updatedAtMs: input.now,
      availableAtMs: input.now,
      retryBudgetRemaining: this.bounds.maxRetryAttemptsPerStage * 2,
    };
  }

  private versionToJob(version: VersionRecord, jobId: string, byteSize: number, now: number): IngestionJobRecord {
    return {
      ...cloneVersion(version),
      jobId,
      jobType: "INGEST",
      attemptsByStage: {},
      byteSize,
      createdAtMs: now,
      updatedAtMs: now,
      availableAtMs: now,
      retryBudgetRemaining: 0,
    };
  }

  private toVersion(job: IngestionJobRecord): VersionRecord {
    return {
      request: cloneRequest(job.request),
      state: job.state,
      stage: job.stage,
      resourceSecurityRevision: job.resourceSecurityRevision,
      generation: job.generation,
      profileRef: job.profileRef,
      idempotencyKey: job.idempotencyKey,
    };
  }

  private idempotencyKey(request: IngestionRequest): string {
    return `${request.sourceId}:${request.version}:${request.profileRef ?? DEFAULT_PROFILE_REF}`;
  }

  private generationRef(versionRef: string, profileRef: string, vectorsDigest: `sha256:${string}`): string {
    return `index:${versionRef}:${profileRef}:${vectorsDigest}`;
  }

  private eventId(type: InvalidationEvent["type"], record: VersionRecord): string {
    return `ingestion:${type}:${record.request.documentRef}:${record.request.versionRef}:${record.resourceSecurityRevision ?? 0}:${record.generation ?? "none"}`;
  }

  private estimateBytes(request: IngestionRequest): number {
    return request.contentBytes ?? Math.max(1, JSON.stringify(request).length + request.parse.chunks.length * 1024);
  }

  private estimateEventBytes(event: InvalidationEvent): number {
    return Math.max(1, JSON.stringify(event).length);
  }
}

function isSha256(value: string): value is `sha256:${string}` {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}

function cloneRequest(request: IngestionRequest): IngestionRequest {
  return { ...request, parse: { ...request.parse, chunks: request.parse.chunks.map((chunk) => ({ ...chunk })) } };
}

function cloneVersion(record: VersionRecord): VersionRecord {
  return { ...record, request: cloneRequest(record.request) };
}

function cloneJob(job: IngestionJobRecord): IngestionJobRecord {
  return { ...job, request: cloneRequest(job.request), attemptsByStage: { ...job.attemptsByStage } };
}

function cloneOutbox(record: IngestionOutboxRecord): IngestionOutboxRecord {
  return { ...record, event: { ...record.event } };
}
