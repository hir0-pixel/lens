import { DatabaseSync } from "node:sqlite";
import type {
  IngestionJobRecord,
  IngestionOutboxRecord,
  IngestionOwnerMutableState,
  IngestionOwnerSnapshot,
  IngestionOwnerStore,
  VersionRecord,
} from "./IngestionService";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  job_id TEXT PRIMARY KEY,
  request_json TEXT NOT NULL,
  state TEXT NOT NULL,
  stage TEXT NOT NULL,
  resource_security_revision INTEGER,
  generation TEXT,
  profile_ref TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  attempts_by_stage_json TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  available_at_ms INTEGER NOT NULL,
  retry_budget_remaining INTEGER NOT NULL,
  quarantine_reason TEXT,
  dead_letter_reason TEXT,
  vectors_digest TEXT,
  expected_resource_security_revision INTEGER,
  job_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingestion_versions (
  version_ref TEXT PRIMARY KEY,
  request_json TEXT NOT NULL,
  state TEXT NOT NULL,
  stage TEXT NOT NULL,
  resource_security_revision INTEGER,
  generation TEXT,
  profile_ref TEXT NOT NULL,
  idempotency_key TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingestion_current (
  document_ref TEXT PRIMARY KEY,
  version_ref TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingestion_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  job_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingestion_outbox (
  event_id TEXT PRIMARY KEY,
  event_json TEXT NOT NULL,
  state TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ingestion_quarantine (
  job_id TEXT PRIMARY KEY,
  job_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingestion_dead_letters (
  job_id TEXT PRIMARY KEY,
  job_json TEXT NOT NULL
);
`;

type Row = Record<string, unknown>;

/** Durable owner state for ingestion jobs, queues, and transactional outbox records. */
export class SqliteIngestionOwnerStore implements IngestionOwnerStore {
  readonly db: DatabaseSync;

  constructor(path: string) {
    const db = new DatabaseSync(path);
    try {
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec(SCHEMA);
      this.migrateColumns(db);
    } catch (error) {
      db.close();
      throw error;
    }
    this.db = db;
  }

  /** `CREATE TABLE IF NOT EXISTS` does not add columns to older databases. */
  private migrateColumns(db: DatabaseSync): void {
    this.addMissingColumns(db, "ingestion_jobs", [
      ["request_json", "TEXT NOT NULL DEFAULT '{}'"],
      ["attempts_by_stage_json", "TEXT NOT NULL DEFAULT '{}'"],
      ["expected_resource_security_revision", "INTEGER"],
    ]);
    this.addMissingColumns(db, "ingestion_versions", [["request_json", "TEXT NOT NULL DEFAULT '{}'"], ["idempotency_key", "TEXT NOT NULL DEFAULT ''"]]);
    this.addMissingColumns(db, "ingestion_outbox", [["event_json", "TEXT NOT NULL DEFAULT '{}'"], ["attempts", "INTEGER NOT NULL DEFAULT 0"]]);
  }

  private addMissingColumns(db: DatabaseSync, table: string, columns: ReadonlyArray<readonly [string, string]>): void {
    const existing = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((row) => String(row.name)));
    for (const [name, definition] of columns) {
      if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition};`);
    }
  }

  close(): void {
    this.db.close();
  }

  async transaction<T>(work: (state: IngestionOwnerMutableState) => T): Promise<T> {
    const state = this.loadState();
    const result = work(state);
    this.replace(state);
    return result;
  }

  snapshot(): IngestionOwnerSnapshot {
    return this.snapshotFromState(this.loadState());
  }

  private loadState(): IngestionOwnerMutableState {
    return {
      jobs: new Map((this.db.prepare("SELECT * FROM ingestion_jobs ORDER BY job_id").all() as Row[]).map((row) => [row.job_id as string, this.jobFromRow(row)])),
      versions: new Map((this.db.prepare("SELECT * FROM ingestion_versions ORDER BY version_ref").all() as Row[]).map((row) => [row.version_ref as string, this.versionFromRow(row)])),
      current: new Map((this.db.prepare("SELECT document_ref, version_ref FROM ingestion_current ORDER BY document_ref").all() as Row[]).map((row) => [row.document_ref as string, row.version_ref as string])),
      idempotency: new Map((this.db.prepare("SELECT idempotency_key, job_id FROM ingestion_idempotency ORDER BY idempotency_key").all() as Row[]).map((row) => [row.idempotency_key as string, row.job_id as string])),
      outbox: new Map((this.db.prepare("SELECT * FROM ingestion_outbox ORDER BY event_id").all() as Row[]).map((row) => [row.event_id as string, this.outboxFromRow(row)])),
      quarantine: new Map((this.db.prepare("SELECT job_id, job_json FROM ingestion_quarantine ORDER BY job_id").all() as Row[]).map((row) => [row.job_id as string, JSON.parse(row.job_json as string) as IngestionJobRecord])),
      deadLetters: new Map((this.db.prepare("SELECT job_id, job_json FROM ingestion_dead_letters ORDER BY job_id").all() as Row[]).map((row) => [row.job_id as string, JSON.parse(row.job_json as string) as IngestionJobRecord])),
    };
  }

  private snapshotFromState(state: IngestionOwnerMutableState): IngestionOwnerSnapshot {
    return {
      jobs: [...state.jobs.values()].map(cloneJob),
      versions: [...state.versions.values()].map(cloneVersion),
      current: [...state.current.entries()],
      idempotency: [...state.idempotency.entries()],
      outbox: [...state.outbox.values()].map(cloneOutbox),
      quarantine: [...state.quarantine.values()].map(cloneJob),
      deadLetters: [...state.deadLetters.values()].map(cloneJob),
    };
  }

  private replace(state: IngestionOwnerMutableState): void {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      for (const table of ["ingestion_jobs", "ingestion_versions", "ingestion_current", "ingestion_idempotency", "ingestion_outbox", "ingestion_quarantine", "ingestion_dead_letters"]) this.db.exec(`DELETE FROM ${table};`);
      const insertJob = this.db.prepare("INSERT INTO ingestion_jobs (job_id, request_json, state, stage, resource_security_revision, generation, profile_ref, idempotency_key, attempts_by_stage_json, byte_size, created_at_ms, updated_at_ms, available_at_ms, retry_budget_remaining, quarantine_reason, dead_letter_reason, vectors_digest, expected_resource_security_revision, job_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const job of state.jobs.values()) this.insertJob(insertJob, job);
      const insertVersion = this.db.prepare("INSERT INTO ingestion_versions (version_ref, request_json, state, stage, resource_security_revision, generation, profile_ref, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      for (const version of state.versions.values()) insertVersion.run(version.request.versionRef, JSON.stringify(version.request), version.state, version.stage, version.resourceSecurityRevision ?? null, version.generation ?? null, version.profileRef, version.idempotencyKey);
      const insertCurrent = this.db.prepare("INSERT INTO ingestion_current (document_ref, version_ref) VALUES (?, ?)");
      for (const [documentRef, versionRef] of state.current) insertCurrent.run(documentRef, versionRef);
      const insertIdempotency = this.db.prepare("INSERT INTO ingestion_idempotency (idempotency_key, job_id) VALUES (?, ?)");
      for (const [key, jobId] of state.idempotency) insertIdempotency.run(key, jobId);
      const insertOutbox = this.db.prepare("INSERT INTO ingestion_outbox (event_id, event_json, state, attempts, byte_size, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const record of state.outbox.values()) insertOutbox.run(record.event.eventId, JSON.stringify(record.event), record.state, record.attempts, record.byteSize, record.createdAtMs, record.updatedAtMs);
      const insertQuarantine = this.db.prepare("INSERT INTO ingestion_quarantine (job_id, job_json) VALUES (?, ?)");
      for (const job of state.quarantine.values()) insertQuarantine.run(job.jobId, JSON.stringify(job));
      const insertDeadLetter = this.db.prepare("INSERT INTO ingestion_dead_letters (job_id, job_json) VALUES (?, ?)");
      for (const job of state.deadLetters.values()) insertDeadLetter.run(job.jobId, JSON.stringify(job));
      this.db.exec("COMMIT;");
    } catch (error) {
      try { this.db.exec("ROLLBACK;"); } catch { /* transaction was already closed */ }
      throw error;
    }
  }

  private insertJob(statement: ReturnType<DatabaseSync["prepare"]>, job: IngestionJobRecord): void {
    statement.run(job.jobId, JSON.stringify(job.request), job.state, job.stage, job.resourceSecurityRevision ?? null, job.generation ?? null, job.profileRef, job.idempotencyKey, JSON.stringify(job.attemptsByStage), job.byteSize, job.createdAtMs, job.updatedAtMs, job.availableAtMs, job.retryBudgetRemaining, job.quarantineReason ?? null, job.deadLetterReason ?? null, job.vectorsDigest ?? null, job.expectedResourceSecurityRevision ?? null, job.jobType);
  }

  private versionFromRow(row: Row): VersionRecord {
    return {
      request: JSON.parse(row.request_json as string),
      state: row.state as VersionRecord["state"],
      stage: row.stage as VersionRecord["stage"],
      resourceSecurityRevision: (row.resource_security_revision as number | null) ?? undefined,
      generation: (row.generation as string | null) ?? undefined,
      profileRef: row.profile_ref as string,
      idempotencyKey: row.idempotency_key as string,
    };
  }

  private jobFromRow(row: Row): IngestionJobRecord {
    return {
      ...this.versionFromRow(row),
      jobId: row.job_id as string,
      jobType: row.job_type as IngestionJobRecord["jobType"],
      attemptsByStage: JSON.parse(row.attempts_by_stage_json as string),
      byteSize: row.byte_size as number,
      createdAtMs: row.created_at_ms as number,
      updatedAtMs: row.updated_at_ms as number,
      availableAtMs: row.available_at_ms as number,
      retryBudgetRemaining: row.retry_budget_remaining as number,
      quarantineReason: (row.quarantine_reason as string | null) ?? undefined,
      deadLetterReason: (row.dead_letter_reason as string | null) ?? undefined,
      vectorsDigest: (row.vectors_digest as `sha256:${string}` | null) ?? undefined,
      expectedResourceSecurityRevision: (row.expected_resource_security_revision as number | null) ?? undefined,
    };
  }

  private outboxFromRow(row: Row): IngestionOutboxRecord {
    return {
      event: JSON.parse(row.event_json as string),
      state: row.state as IngestionOutboxRecord["state"],
      attempts: row.attempts as number,
      byteSize: row.byte_size as number,
      createdAtMs: row.created_at_ms as number,
      updatedAtMs: row.updated_at_ms as number,
    };
  }
}

function cloneRequest<T extends { parse: { chunks: readonly unknown[] } }>(request: T): T {
  return JSON.parse(JSON.stringify(request)) as T;
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
