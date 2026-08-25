import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { ConversationTurnRecord } from "./router";
import type { ConversationHistoryPort, TerminalEvidence } from "./conversationHistory";

const DEFAULT_MAX_TURNS = 12;
const DEFAULT_MAX_BYTES = 16 * 1024;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const KEY_BYTES = 32;
const NONCE_BYTES = 12;

/**
 * The BFF performs live IdP introspection and the Orchestrator HTTP boundary
 * verifies the resulting request-bound assertion before history is reached.
 * This optional port is only an additional policy hook; it must never be
 * represented as an independent liveness authority when it is absent.
 */
export interface SessionValidatorPort {
  isActive(input: { subjectRef: string; sessionRef: string }, signal: AbortSignal): Promise<boolean>;
}

/**
 * The HTTP boundary is the authoritative request proof gate. This port does
 * not claim to provide independent session liveness or revocation state.
 */
export class FailClosedSessionValidator implements SessionValidatorPort {
  async isActive(): Promise<boolean> {
    return false;
  }
}

export interface DurableConversationHistoryOptions {
  dbPath: string;
  /** 64 hex chars (32 bytes). Required — there is no plaintext fallback. */
  encryptionKeyHex: string;
  sessionValidator?: SessionValidatorPort;
  maxTurns?: number;
  maxBytes?: number;
  ttlMs?: number;
  now?: () => number;
}

function parseKey(hex: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("encryptionKeyHex must be exactly 64 hex characters (32 bytes) for AES-256-GCM.");
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== KEY_BYTES) throw new Error("Derived encryption key must be 32 bytes.");
  return key;
}

/**
 * Durable, encrypted development/test conversation history, backed by SQLite
 * (Node's built-in `node:sqlite`). SQLite WAL is explicitly not a production
 * cross-host or cross-replica storage contract; production must inject a
 * replicated ConversationHistoryPort through orchestrator main.
 *
 * What is encrypted and what is not: `subject_ref`/`session_ref`/
 * `conversation_ref`/`role` are stored in cleartext — they are the ownership
 * key the query planner and the ownership check both need, and they are
 * opaque identifiers, not conversation content. Only the turn `text` column
 * is AES-256-GCM encrypted (unique random 96-bit nonce per row, stored
 * alongside its auth tag); that is the only field carrying user/document
 * content. Nothing here is ever written to `console.*`.
 */
export class DurableConversationHistory implements ConversationHistoryPort {
  readonly replicated = false as const;
  private readonly db: DatabaseSync;
  private readonly key: Buffer;
  private readonly maxTurns: number;
  private readonly maxBytes: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: DurableConversationHistoryOptions) {
    this.key = parseKey(options.encryptionKeyHex);
    this.maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? (() => Date.now());
    this.db = new DatabaseSync(options.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_ref TEXT NOT NULL,
        session_ref TEXT NOT NULL,
        conversation_ref TEXT NOT NULL,
        role TEXT NOT NULL,
        ciphertext BLOB NOT NULL,
        nonce BLOB NOT NULL,
        auth_tag BLOB NOT NULL,
        byte_length INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversation_turns_owner
      ON conversation_turns(subject_ref, conversation_ref, id);
      CREATE TABLE IF NOT EXISTS memory_turns (
        request_id TEXT PRIMARY KEY,
        subject_ref TEXT NOT NULL,
        conversation_ref TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        input_digest TEXT NOT NULL,
        output_digest TEXT,
        terminal_evidence TEXT,
        input_ciphertext BLOB NOT NULL,
        input_nonce BLOB NOT NULL,
        input_auth_tag BLOB NOT NULL,
        finalized INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  private encrypt(text: string): { ciphertext: Buffer; nonce: Buffer; authTag: Buffer } {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
    return { ciphertext, nonce, authTag: cipher.getAuthTag() };
  }

  private decrypt(ciphertext: Buffer, nonce: Buffer, authTag: Buffer): string {
    const decipher = createDecipheriv("aes-256-gcm", this.key, nonce);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }

  async get(
    input: { subjectRef: string; conversationRef: string; limit: number; sessionRef?: string },
    signal?: AbortSignal,
  ): Promise<readonly ConversationTurnRecord[]> {
    void signal;
    const limit = Math.max(0, Math.min(input.limit, this.maxTurns));
    if (limit === 0) return [];
    const now = this.now();
    const rows = this.db
      .prepare(
        `SELECT role, ciphertext, nonce, auth_tag FROM conversation_turns
         WHERE subject_ref = ? AND conversation_ref = ? AND expires_at > ?
         ORDER BY id DESC LIMIT ?`,
      )
      .all(input.subjectRef, input.conversationRef, now, limit) as {
      role: string;
      ciphertext: Uint8Array;
      nonce: Uint8Array;
      auth_tag: Uint8Array;
    }[];
    return rows
      .reverse()
      .map((row) => ({
        role: row.role as ConversationTurnRecord["role"],
        text: this.decrypt(Buffer.from(row.ciphertext), Buffer.from(row.nonce), Buffer.from(row.auth_tag)),
      }));
  }

  async beginTurn(input: { requestId: string; subjectRef: string; sessionRef: string; conversationRef: string; turnId: string; inputDigest: `sha256:${string}`; inputText: string }): Promise<{ turnId: string; sequence: number }> {
    const existing = this.db.prepare("SELECT turn_id, input_digest FROM memory_turns WHERE request_id = ?").get(input.requestId) as { turn_id: string; input_digest: string } | undefined;
    if (existing && (existing.input_digest !== input.inputDigest || existing.turn_id !== input.turnId)) throw new Error("MEMORY_BEGIN_CONFLICT");
    if (!existing) {
      const encrypted = this.encrypt(input.inputText);
      this.db.prepare("INSERT INTO memory_turns (request_id, subject_ref, conversation_ref, turn_id, input_digest, input_ciphertext, input_nonce, input_auth_tag, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(input.requestId, input.subjectRef, input.conversationRef, input.turnId, input.inputDigest, encrypted.ciphertext, encrypted.nonce, encrypted.authTag, this.now());
    }
    return { turnId: input.turnId, sequence: 1 };
  }

  async finalizeTurn(input: { requestId: string; subjectRef: string; sessionRef: string; conversationRef: string; turnId: string; inputDigest: `sha256:${string}`; output: string; outputDigest: `sha256:${string}`; terminalEvidence: TerminalEvidence }): Promise<void> {
    const existing = this.db.prepare("SELECT subject_ref, conversation_ref, turn_id, input_digest, input_ciphertext, input_nonce, input_auth_tag, output_digest, terminal_evidence, finalized FROM memory_turns WHERE request_id = ?").get(input.requestId) as { subject_ref: string; conversation_ref: string; turn_id: string; input_digest: string; input_ciphertext: Uint8Array; input_nonce: Uint8Array; input_auth_tag: Uint8Array; output_digest?: string; terminal_evidence?: string; finalized: number } | undefined;
    if (!existing || existing.subject_ref !== input.subjectRef || existing.conversation_ref !== input.conversationRef || existing.turn_id !== input.turnId || existing.input_digest !== input.inputDigest) throw new Error("MEMORY_FINALIZE_CONFLICT");
    // Stored as canonical JSON text — the column is a storage detail, not
    // the contract; ConversationHistoryPort.finalizeTurn takes and returns a
    // structured TerminalEvidence object, never an opaque string.
    const terminalEvidenceJson = JSON.stringify(input.terminalEvidence);
    if (existing.finalized === 1) {
      if (existing.output_digest !== input.outputDigest || existing.terminal_evidence !== terminalEvidenceJson) throw new Error("MEMORY_FINALIZE_CONFLICT");
      return;
    }
    this.db.prepare("UPDATE memory_turns SET output_digest = ?, terminal_evidence = ?, finalized = 1 WHERE request_id = ? AND finalized = 0").run(input.outputDigest, terminalEvidenceJson, input.requestId);
    await this.append({ subjectRef: input.subjectRef, sessionRef: input.sessionRef, conversationRef: input.conversationRef, turn: { role: "user", text: this.decrypt(Buffer.from(existing.input_ciphertext), Buffer.from(existing.input_nonce), Buffer.from(existing.input_auth_tag)) } });
    await this.append({ subjectRef: input.subjectRef, sessionRef: input.sessionRef, conversationRef: input.conversationRef, turn: { role: "assistant", text: input.output } });
  }

  async append(input: { subjectRef: string; sessionRef: string; conversationRef: string; turn: ConversationTurnRecord }): Promise<void> {
    const { ciphertext, nonce, authTag } = this.encrypt(input.turn.text);
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO conversation_turns
         (subject_ref, session_ref, conversation_ref, role, ciphertext, nonce, auth_tag, byte_length, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.subjectRef,
        input.sessionRef,
        input.conversationRef,
        input.turn.role,
        ciphertext,
        nonce,
        authTag,
        Buffer.byteLength(input.turn.text, "utf8"),
        now,
        now + this.ttlMs,
      );
    this.enforceBounds(input.subjectRef, input.sessionRef, input.conversationRef);
  }

  private enforceBounds(subjectRef: string, _sessionRef: string, conversationRef: string): void {
    this.db
      .prepare(
        `DELETE FROM conversation_turns
         WHERE subject_ref = ? AND conversation_ref = ?
         AND id NOT IN (
           SELECT id FROM conversation_turns
           WHERE subject_ref = ? AND conversation_ref = ?
           ORDER BY id DESC LIMIT ?
         )`,
      )
      .run(subjectRef, conversationRef, subjectRef, conversationRef, this.maxTurns);

    const rows = this.db
      .prepare(
        `SELECT id, byte_length FROM conversation_turns
         WHERE subject_ref = ? AND conversation_ref = ?
         ORDER BY id DESC`,
      )
      .all(subjectRef, conversationRef) as { id: number; byte_length: number }[];
    let total = rows.reduce((sum, row) => sum + row.byte_length, 0);
    const toDrop: number[] = [];
    for (let i = rows.length - 1; i >= 0 && total > this.maxBytes && rows.length - toDrop.length > 1; i--) {
      toDrop.push(rows[i].id);
      total -= rows[i].byte_length;
    }
    if (toDrop.length > 0) {
      const placeholders = toDrop.map(() => "?").join(",");
      this.db.prepare(`DELETE FROM conversation_turns WHERE id IN (${placeholders})`).run(...toDrop);
    }
  }

  /** Retention control: explicit, immediate, user-initiated deletion of a whole conversation. */
  deleteConversation(input: { subjectRef: string; conversationRef: string; sessionRef?: string }): number {
    const result = this.db
      .prepare(`DELETE FROM conversation_turns WHERE subject_ref = ? AND conversation_ref = ?`)
      .run(input.subjectRef, input.conversationRef);
    return Number(result.changes);
  }

  /** Retention control: sweep rows past their TTL. Intended to run on an interval from main.ts. */
  purgeExpired(now: number = this.now()): number {
    const result = this.db.prepare(`DELETE FROM conversation_turns WHERE expires_at <= ?`).run(now);
    return Number(result.changes);
  }
}
