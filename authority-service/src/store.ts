import { DatabaseSync } from "node:sqlite";

export type AuthorityStorageProfile = "development" | "test" | "production";

export class AuthorityStorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class AuthorityStorageMigrationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export interface AdmissionRow {
  requestId: string;
  kind: "generation" | "release" | "route_override";
  turnId: string;
  inputDigest: string;
  ragProfileVersion: number;
  ragProfileDigest: string;
  receiptDigest: string;
  createdAt: number;
  /** Structured route_override provenance (item 4), stored as canonical JSON text. Present only for kind === "route_override". */
  routeOverrideJson?: string;
}

export interface ContextFenceRow {
  requestId: string;
  turnId: string;
  contextDigest: string;
  fenceRef: string;
  expiresAt: number;
  checkedAt: number;
  revoked: 0 | 1;
  createdAt: number;
}

export interface OutputBlobRow {
  outputRef: string;
  outputDigest: string;
  outputCiphertext: string;
  outputNonce: string;
  outputAuthTag: string;
  outputKeyVersion: string;
  classificationRef: string;
  guardReceipt: string;
  requestId: string;
  turnId: string;
  commitProof: string;
  createdAt: number;
}

export interface TerminalCommitRow {
  requestId: string;
  turnId: string;
  outputRef: string;
  outputDigest: string;
  releaseFence: string;
  releaseAuditReceipt: string;
  committed: 1;
  createdAt: number;
}

export interface TurnFailureRow {
  requestId: string;
  turnId: string;
  code: string;
  createdAt: number;
}

export interface DisclosureReservationRow {
  reservationRef: string;
  requestId: string;
  subjectRef: string;
  outputRef: string;
  outputDigest: string;
  classificationRef: string;
  status: "reserved" | "committed";
  releaseFence: string | null;
  expiresAt: number;
  createdAt: number;
}

export interface AuthorityStorePort {
  readonly storageProfile: AuthorityStorageProfile;
  readonly replicated: boolean;
  close(): Promise<void>;
  getAdmission(requestId: string, kind: "generation" | "release" | "route_override"): Promise<AdmissionRow | undefined>;
  insertAdmission(row: AdmissionRow): Promise<void>;
  getContextFence(requestId: string, turnId: string, contextDigest: string): Promise<ContextFenceRow | undefined>;
  upsertContextFence(row: ContextFenceRow): Promise<void>;
  revokeContextFence(requestId: string, turnId: string): Promise<number>;
  getOutputBlob(outputRef: string): Promise<OutputBlobRow | undefined>;
  insertOutputBlob(row: OutputBlobRow): Promise<void>;
  getTerminalCommit(requestId: string, turnId: string): Promise<TerminalCommitRow | undefined>;
  insertTerminalCommit(row: TerminalCommitRow): Promise<void>;
  insertTurnFailure(row: TurnFailureRow): Promise<void>;
  getDisclosureReservation(reservationRef: string): Promise<DisclosureReservationRow | undefined>;
  insertDisclosureReservation(row: DisclosureReservationRow): Promise<void>;
  commitDisclosureReservation(reservationRef: string, releaseFence: string): Promise<void>;
}

/**
 * A production adapter must be backed by replicated, failover-capable storage.
 * The interface deliberately exposes no SQLite-specific API so the production
 * implementation can be supplied without changing AuthorityService.
 */
export interface ProductionAuthorityStorageAdapter {
  readonly profile: "production";
  readonly replicated: true;
  readonly store: AuthorityStorePort;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS audit_admissions (
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  input_digest TEXT NOT NULL,
  rag_profile_version INTEGER NOT NULL,
  rag_profile_digest TEXT NOT NULL,
  receipt_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  route_override_json TEXT,
  PRIMARY KEY (request_id, kind)
);

CREATE TABLE IF NOT EXISTS context_fences (
  request_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  context_digest TEXT NOT NULL,
  fence_ref TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  checked_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (request_id, turn_id, context_digest)
);

CREATE TABLE IF NOT EXISTS output_blobs (
  output_ref TEXT PRIMARY KEY,
  output_digest TEXT NOT NULL,
  output_ciphertext TEXT NOT NULL,
  output_nonce TEXT NOT NULL,
  output_auth_tag TEXT NOT NULL,
  output_key_version TEXT NOT NULL,
  classification_ref TEXT NOT NULL,
  guard_receipt TEXT NOT NULL,
  request_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  commit_proof TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS turn_state (
  request_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  output_ref TEXT NOT NULL,
  output_digest TEXT NOT NULL,
  release_fence TEXT NOT NULL,
  release_audit_receipt TEXT NOT NULL,
  committed INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (request_id, turn_id)
);

CREATE TABLE IF NOT EXISTS turn_failures (
  request_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS disclosure_reservations (
  reservation_ref TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  subject_ref TEXT NOT NULL,
  output_ref TEXT NOT NULL,
  output_digest TEXT NOT NULL,
  classification_ref TEXT NOT NULL,
  status TEXT NOT NULL,
  release_fence TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`;

export class AuthorityStore implements AuthorityStorePort {
  readonly storageProfile = "development" as const;
  readonly replicated = false as const;
  readonly db: DatabaseSync;

  constructor(path: string) {
    const db = new DatabaseSync(path);
    try {
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec(SCHEMA);
      this.migrateAuditAdmissionColumns(db);
      this.assertEncryptedOutputSchema(db);
    } catch (error) {
      db.close();
      throw error;
    }
    this.db = db;
  }

  /** `CREATE TABLE IF NOT EXISTS` does not add columns to an already-existing table. */
  private migrateAuditAdmissionColumns(db: DatabaseSync): void {
    const columns = new Set(
      (db.prepare("PRAGMA table_info(audit_admissions)").all() as Array<Record<string, unknown>>)
        .map((row) => String(row.name)),
    );
    if (!columns.has("route_override_json")) db.exec("ALTER TABLE audit_admissions ADD COLUMN route_override_json TEXT;");
    if (!columns.has("rag_profile_version")) db.exec("ALTER TABLE audit_admissions ADD COLUMN rag_profile_version INTEGER NOT NULL DEFAULT 0;");
    if (!columns.has("rag_profile_digest")) db.exec("ALTER TABLE audit_admissions ADD COLUMN rag_profile_digest TEXT NOT NULL DEFAULT 'sha256:0000000000000000000000000000000000000000000000000000000000000000';");
  }

  private assertEncryptedOutputSchema(db: DatabaseSync): void {
    const columns = new Set(
      (db.prepare("PRAGMA table_info(output_blobs)").all() as Array<Record<string, unknown>>)
        .map((row) => String(row.name)),
    );
    if (columns.has("output")) {
      throw new AuthorityStorageMigrationError(
        "Legacy plaintext output_blobs schema detected; migrate or archive the database before starting Authority.",
      );
    }
    for (const column of ["output_ciphertext", "output_nonce", "output_auth_tag", "output_key_version"]) {
      if (!columns.has(column)) {
        throw new AuthorityStorageMigrationError(`Encrypted output schema is incomplete; missing ${column}.`);
      }
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }

  // --- audit_admissions ---

  async getAdmission(requestId: string, kind: "generation" | "release" | "route_override"): Promise<AdmissionRow | undefined> {
    const row = this.db.prepare(
      "SELECT request_id, kind, turn_id, input_digest, rag_profile_version, rag_profile_digest, receipt_digest, created_at, route_override_json FROM audit_admissions WHERE request_id = ? AND kind = ?",
    ).get(requestId, kind) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      requestId: row.request_id as string,
      kind: row.kind as "generation" | "release" | "route_override",
      turnId: row.turn_id as string,
      inputDigest: row.input_digest as string,
      ragProfileVersion: row.rag_profile_version as number,
      ragProfileDigest: row.rag_profile_digest as string,
      receiptDigest: row.receipt_digest as string,
      createdAt: row.created_at as number,
      routeOverrideJson: (row.route_override_json as string | null) ?? undefined,
    };
  }

  async insertAdmission(row: AdmissionRow): Promise<void> {
    this.db.prepare(
      "INSERT INTO audit_admissions (request_id, kind, turn_id, input_digest, rag_profile_version, rag_profile_digest, receipt_digest, created_at, route_override_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(row.requestId, row.kind, row.turnId, row.inputDigest, row.ragProfileVersion, row.ragProfileDigest, row.receiptDigest, row.createdAt, row.routeOverrideJson ?? null);
  }

  // --- context_fences ---

  async getContextFence(requestId: string, turnId: string, contextDigest: string): Promise<ContextFenceRow | undefined> {
    const row = this.db.prepare(
      "SELECT request_id, turn_id, context_digest, fence_ref, expires_at, checked_at, revoked, created_at FROM context_fences WHERE request_id = ? AND turn_id = ? AND context_digest = ?",
    ).get(requestId, turnId, contextDigest) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      requestId: row.request_id as string,
      turnId: row.turn_id as string,
      contextDigest: row.context_digest as string,
      fenceRef: row.fence_ref as string,
      expiresAt: row.expires_at as number,
      checkedAt: row.checked_at as number,
      revoked: row.revoked as 0 | 1,
      createdAt: row.created_at as number,
    };
  }

  async upsertContextFence(row: ContextFenceRow): Promise<void> {
    this.db.prepare(
      `INSERT INTO context_fences (request_id, turn_id, context_digest, fence_ref, expires_at, checked_at, revoked, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(request_id, turn_id, context_digest) DO UPDATE SET
         fence_ref = excluded.fence_ref,
         expires_at = excluded.expires_at,
         checked_at = excluded.checked_at,
         revoked = excluded.revoked`,
    ).run(row.requestId, row.turnId, row.contextDigest, row.fenceRef, row.expiresAt, row.checkedAt, row.revoked, row.createdAt);
  }

  async revokeContextFence(requestId: string, turnId: string): Promise<number> {
    const result = this.db.prepare(
      "UPDATE context_fences SET revoked = 1 WHERE request_id = ? AND turn_id = ?",
    ).run(requestId, turnId);
    return Number(result.changes);
  }

  // --- output_blobs ---

  async getOutputBlob(outputRef: string): Promise<OutputBlobRow | undefined> {
    const row = this.db.prepare(
      "SELECT output_ref, output_digest, output_ciphertext, output_nonce, output_auth_tag, output_key_version, classification_ref, guard_receipt, request_id, turn_id, commit_proof, created_at FROM output_blobs WHERE output_ref = ?",
    ).get(outputRef) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      outputRef: row.output_ref as string,
      outputDigest: row.output_digest as string,
      outputCiphertext: row.output_ciphertext as string,
      outputNonce: row.output_nonce as string,
      outputAuthTag: row.output_auth_tag as string,
      outputKeyVersion: row.output_key_version as string,
      classificationRef: row.classification_ref as string,
      guardReceipt: row.guard_receipt as string,
      requestId: row.request_id as string,
      turnId: row.turn_id as string,
      commitProof: row.commit_proof as string,
      createdAt: row.created_at as number,
    };
  }

  async insertOutputBlob(row: OutputBlobRow): Promise<void> {
    this.db.prepare(
      `INSERT INTO output_blobs (output_ref, output_digest, output_ciphertext, output_nonce, output_auth_tag, output_key_version, classification_ref, guard_receipt, request_id, turn_id, commit_proof, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(output_ref) DO NOTHING`,
    ).run(row.outputRef, row.outputDigest, row.outputCiphertext, row.outputNonce, row.outputAuthTag, row.outputKeyVersion, row.classificationRef, row.guardReceipt, row.requestId, row.turnId, row.commitProof, row.createdAt);
  }

  // --- turn_state ---

  async getTerminalCommit(requestId: string, turnId: string): Promise<TerminalCommitRow | undefined> {
    const row = this.db.prepare(
      "SELECT request_id, turn_id, output_ref, output_digest, release_fence, release_audit_receipt, committed, created_at FROM turn_state WHERE request_id = ? AND turn_id = ?",
    ).get(requestId, turnId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      requestId: row.request_id as string,
      turnId: row.turn_id as string,
      outputRef: row.output_ref as string,
      outputDigest: row.output_digest as string,
      releaseFence: row.release_fence as string,
      releaseAuditReceipt: row.release_audit_receipt as string,
      committed: 1,
      createdAt: row.created_at as number,
    };
  }

  async insertTerminalCommit(row: TerminalCommitRow): Promise<void> {
    this.db.prepare(
      "INSERT INTO turn_state (request_id, turn_id, output_ref, output_digest, release_fence, release_audit_receipt, committed, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
    ).run(row.requestId, row.turnId, row.outputRef, row.outputDigest, row.releaseFence, row.releaseAuditReceipt, row.createdAt);
  }

  async insertTurnFailure(row: TurnFailureRow): Promise<void> {
    this.db.prepare(
      "INSERT INTO turn_failures (request_id, turn_id, code, created_at) VALUES (?, ?, ?, ?)",
    ).run(row.requestId, row.turnId, row.code, row.createdAt);
  }

  // --- disclosure_reservations ---

  async getDisclosureReservation(reservationRef: string): Promise<DisclosureReservationRow | undefined> {
    const row = this.db.prepare(
      "SELECT reservation_ref, request_id, subject_ref, output_ref, output_digest, classification_ref, status, release_fence, expires_at, created_at FROM disclosure_reservations WHERE reservation_ref = ?",
    ).get(reservationRef) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      reservationRef: row.reservation_ref as string,
      requestId: row.request_id as string,
      subjectRef: row.subject_ref as string,
      outputRef: row.output_ref as string,
      outputDigest: row.output_digest as string,
      classificationRef: row.classification_ref as string,
      status: row.status as "reserved" | "committed",
      releaseFence: (row.release_fence as string | null) ?? null,
      expiresAt: row.expires_at as number,
      createdAt: row.created_at as number,
    };
  }

  async insertDisclosureReservation(row: DisclosureReservationRow): Promise<void> {
    this.db.prepare(
      "INSERT INTO disclosure_reservations (reservation_ref, request_id, subject_ref, output_ref, output_digest, classification_ref, status, release_fence, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(row.reservationRef, row.requestId, row.subjectRef, row.outputRef, row.outputDigest, row.classificationRef, row.status, row.releaseFence, row.expiresAt, row.createdAt);
  }

  async commitDisclosureReservation(reservationRef: string, releaseFence: string): Promise<void> {
    this.db.prepare(
      "UPDATE disclosure_reservations SET status = 'committed', release_fence = ? WHERE reservation_ref = ?",
    ).run(releaseFence, reservationRef);
  }
}

export interface AuthorityStorageOptions {
  profile: AuthorityStorageProfile;
  sqlitePath?: string;
  productionAdapter?: ProductionAuthorityStorageAdapter;
}

export function createAuthorityStorage(options: AuthorityStorageOptions): AuthorityStorePort {
  if (options.profile === "development" || options.profile === "test") {
    if (!options.sqlitePath) {
      throw new AuthorityStorageConfigurationError(`${options.profile} Authority storage requires sqlitePath.`);
    }
    return new AuthorityStore(options.sqlitePath);
  }

  const adapter = options.productionAdapter;
  if (!adapter || adapter.profile !== "production" || adapter.replicated !== true || adapter.store.replicated !== true) {
    throw new AuthorityStorageConfigurationError(
      "Production Authority startup requires a replicated production storage adapter; SQLite is development/test-only.",
    );
  }
  return adapter.store;
}
