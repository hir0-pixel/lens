import { DatabaseSync } from "node:sqlite";
import type { IndexGenerationManifest } from "./indexGenerationManifest";

export interface PublicationGenerationRow {
  generationId: string;
  corpusRef: string;
  profileJson: string;
  ragProfileVersion: number;
  ragProfileDigest: `sha256:${string}`;
  candidateRefsJson: string;
  integrityDigest: `sha256:${string}`;
  state: IndexGenerationManifest["state"];
  activatedAt?: number;
}

export interface PublicationCorpusStateRow {
  corpusRef: string;
  activeGenerationId?: string;
  sequence: number;
  writer: number;
}

export interface PublicationPersistedState {
  generations: readonly IndexGenerationManifest[];
  searchable: ReadonlyMap<string, readonly string[]>;
  activeGenerationId?: string;
  retiredOrder: readonly string[];
  withdrawnVersions: readonly string[];
  sequence: number;
  writer: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS publication_generations (
  generation_id TEXT NOT NULL,
  corpus_ref TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  rag_profile_version INTEGER NOT NULL,
  rag_profile_digest TEXT NOT NULL,
  candidate_refs_json TEXT NOT NULL,
  integrity_digest TEXT NOT NULL,
  state TEXT NOT NULL,
  activated_at INTEGER,
  PRIMARY KEY (corpus_ref, generation_id)
);

CREATE TABLE IF NOT EXISTS publication_corpora (
  corpus_ref TEXT PRIMARY KEY,
  active_generation_id TEXT,
  sequence INTEGER NOT NULL,
  writer INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS publication_retired_order (
  corpus_ref TEXT NOT NULL,
  position INTEGER NOT NULL,
  generation_id TEXT NOT NULL,
  PRIMARY KEY (corpus_ref, position)
);

CREATE TABLE IF NOT EXISTS publication_withdrawn_versions (
  corpus_ref TEXT NOT NULL,
  version_ref TEXT NOT NULL,
  PRIMARY KEY (corpus_ref, version_ref)
);

CREATE TABLE IF NOT EXISTS publication_searchable_versions (
  corpus_ref TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  version_ref TEXT NOT NULL,
  PRIMARY KEY (corpus_ref, generation_id, position)
);
`;

/** Durable, per-corpus publication state. All replacements are one SQLite transaction. */
export class PublicationStore {
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
    const columns = new Set(
      (db.prepare("PRAGMA table_info(publication_corpora)").all() as Array<Record<string, unknown>>)
        .map((row) => String(row.name)),
    );
    if (!columns.has("writer")) db.exec("ALTER TABLE publication_corpora ADD COLUMN writer INTEGER NOT NULL DEFAULT 0;");
  }

  close(): void {
    this.db.close();
  }

  load(corpusRef: string): PublicationPersistedState {
    const corpus = this.db.prepare(
      "SELECT corpus_ref, active_generation_id, sequence, writer FROM publication_corpora WHERE corpus_ref = ?",
    ).get(corpusRef) as Record<string, unknown> | undefined;
    if (!corpus) {
      return { generations: [], searchable: new Map(), retiredOrder: [], withdrawnVersions: [], sequence: 0, writer: 0 };
    }
    const generations = (this.db.prepare(
      "SELECT generation_id, corpus_ref, profile_json, rag_profile_version, rag_profile_digest, candidate_refs_json, integrity_digest, state, activated_at FROM publication_generations WHERE corpus_ref = ? ORDER BY generation_id",
    ).all(corpusRef) as Array<Record<string, unknown>>).map((row): IndexGenerationManifest => ({
      generationId: row.generation_id as string,
      corpusRef: row.corpus_ref as string,
      profile: JSON.parse(row.profile_json as string),
      ragProfileVersion: row.rag_profile_version as number,
      ragProfileDigest: row.rag_profile_digest as `sha256:${string}`,
      candidateRefs: JSON.parse(row.candidate_refs_json as string),
      integrityDigest: row.integrity_digest as `sha256:${string}`,
      state: row.state as IndexGenerationManifest["state"],
      activatedAt: (row.activated_at as number | null) ?? undefined,
    }));
    const searchable = new Map<string, string[]>();
    for (const row of this.db.prepare(
      "SELECT generation_id, position, version_ref FROM publication_searchable_versions WHERE corpus_ref = ? ORDER BY generation_id, position",
    ).all(corpusRef) as Array<Record<string, unknown>>) {
      const generationId = row.generation_id as string;
      searchable.set(generationId, [...(searchable.get(generationId) ?? []), row.version_ref as string]);
    }
    return {
      generations,
      searchable,
      activeGenerationId: (corpus.active_generation_id as string | null) ?? undefined,
      retiredOrder: (this.db.prepare(
        "SELECT generation_id FROM publication_retired_order WHERE corpus_ref = ? ORDER BY position",
      ).all(corpusRef) as Array<Record<string, unknown>>).map((row) => row.generation_id as string),
      withdrawnVersions: (this.db.prepare(
        "SELECT version_ref FROM publication_withdrawn_versions WHERE corpus_ref = ? ORDER BY version_ref",
      ).all(corpusRef) as Array<Record<string, unknown>>).map((row) => row.version_ref as string),
      sequence: corpus.sequence as number,
      writer: corpus.writer as number,
    };
  }

  replace(corpusRef: string, state: PublicationPersistedState): void {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.db.prepare("DELETE FROM publication_generations WHERE corpus_ref = ?").run(corpusRef);
      this.db.prepare("DELETE FROM publication_retired_order WHERE corpus_ref = ?").run(corpusRef);
      this.db.prepare("DELETE FROM publication_withdrawn_versions WHERE corpus_ref = ?").run(corpusRef);
      this.db.prepare("DELETE FROM publication_searchable_versions WHERE corpus_ref = ?").run(corpusRef);
      this.db.prepare(
        `INSERT INTO publication_corpora (corpus_ref, active_generation_id, sequence, writer) VALUES (?, ?, ?, ?)
         ON CONFLICT(corpus_ref) DO UPDATE SET active_generation_id = excluded.active_generation_id, sequence = excluded.sequence, writer = excluded.writer`,
      ).run(corpusRef, state.activeGenerationId ?? null, state.sequence, state.writer);
      const insertGeneration = this.db.prepare(
        "INSERT INTO publication_generations (generation_id, corpus_ref, profile_json, rag_profile_version, rag_profile_digest, candidate_refs_json, integrity_digest, state, activated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const generation of state.generations) {
        insertGeneration.run(generation.generationId, corpusRef, JSON.stringify(generation.profile), generation.ragProfileVersion, generation.ragProfileDigest, JSON.stringify(generation.candidateRefs), generation.integrityDigest, generation.state, generation.activatedAt ?? null);
      }
      const insertRetired = this.db.prepare("INSERT INTO publication_retired_order (corpus_ref, position, generation_id) VALUES (?, ?, ?)");
      state.retiredOrder.forEach((generationId, position) => insertRetired.run(corpusRef, position, generationId));
      const insertWithdrawn = this.db.prepare("INSERT INTO publication_withdrawn_versions (corpus_ref, version_ref) VALUES (?, ?)");
      state.withdrawnVersions.forEach((versionRef) => insertWithdrawn.run(corpusRef, versionRef));
      const insertSearchable = this.db.prepare("INSERT INTO publication_searchable_versions (corpus_ref, generation_id, position, version_ref) VALUES (?, ?, ?, ?)");
      for (const [generationId, versionRefs] of state.searchable) {
        versionRefs.forEach((versionRef, position) => insertSearchable.run(corpusRef, generationId, position, versionRef));
      }
      this.db.exec("COMMIT;");
    } catch (error) {
      try { this.db.exec("ROLLBACK;"); } catch { /* transaction was already closed */ }
      throw error;
    }
  }
}
