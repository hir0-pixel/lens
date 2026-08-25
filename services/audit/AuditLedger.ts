import { DatabaseSync } from "node:sqlite";

export type AuditErrorCode = "AUDIT_QUORUM_UNAVAILABLE" | "AUDIT_EVENT_ID_CONFLICT" | "AUDIT_PRODUCER_FORBIDDEN" | "AUDIT_EVENT_TOO_LARGE" | "AUDIT_INTENT_NOT_FOUND" | "AUDIT_OUTCOME_FORBIDDEN" | "AUDIT_DR_CHECKPOINT_STALE";
export class AuditAdmissionError extends Error { constructor(readonly code: AuditErrorCode, message: string) { super(message); } }
export interface AttestedProducer { workloadId: string; attested: boolean; }
export interface AuditIntent { eventId: string; partitionKey: string; eventType: string; requestId: string; action: string; intentDigest: string; byteLength: number; }
export interface AuditReceipt { eventId: string; partitionId: number; committedOffset: number; committedTerm: number; committedAt: string; receiptDigest: string; }
interface CommittedIntent extends AuditIntent, AuditReceipt { producerId: string; }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS audit_events (
  event_id TEXT PRIMARY KEY,
  partition_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  request_id TEXT NOT NULL,
  action TEXT NOT NULL,
  intent_digest TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  partition_id INTEGER NOT NULL,
  committed_offset INTEGER NOT NULL,
  committed_term INTEGER NOT NULL,
  committed_at TEXT NOT NULL,
  receipt_digest TEXT NOT NULL,
  producer_id TEXT NOT NULL
);
`;

/** Doc 021 model: producer identity is attested; only quorum receipts authorize protected work. */
export class AuditLedger {
  private readonly events = new Map<string, CommittedIntent>();
  private readonly offsets = new Map<number, number>();
  private readonly db: DatabaseSync | undefined;
  private quorumAvailable = true;
  private witnessHealthy = true;
  private checkpointAt: number;
  constructor(
    private readonly allowedEvents: Readonly<Record<string, readonly string[]>>,
    private readonly now = () => new Date(),
    private readonly partitionCount = 64,
    private readonly maxBytes = 65_536,
    private readonly checkpointMaxAgeMs = 60_000,
    persistencePath?: string,
  ) {
    this.checkpointAt = now().valueOf();
    this.db = undefined;
    if (persistencePath) {
      const db = new DatabaseSync(persistencePath);
      try {
        db.exec("PRAGMA journal_mode = WAL;");
        db.exec(SCHEMA);
        this.db = db;
        this.loadPersisted();
      } catch (error) {
        db.close();
        throw error;
      }
    }
  }
  setHealth(state: { quorumAvailable?: boolean; witnessHealthy?: boolean; checkpointAt?: number }): void { if (state.quorumAvailable !== undefined) this.quorumAvailable = state.quorumAvailable; if (state.witnessHealthy !== undefined) this.witnessHealthy = state.witnessHealthy; if (state.checkpointAt !== undefined) this.checkpointAt = state.checkpointAt; }
  close(): void { this.db?.close(); }
  appendIntent(producer: AttestedProducer, input: AuditIntent): AuditReceipt {
    const allowed = this.allowedEvents[producer.workloadId] ?? [];
    const baseEvent = input.eventType.endsWith(".outcome") ? input.eventType.slice(0, -".outcome".length) : input.eventType;
    if (!producer.attested || !allowed.includes(baseEvent)) throw new AuditAdmissionError("AUDIT_PRODUCER_FORBIDDEN", "Producer is not attested or allowlisted for this event type.");
    const prior = this.events.get(input.eventId);
    if (prior) { if (prior.intentDigest !== input.intentDigest || prior.partitionKey !== input.partitionKey || prior.eventType !== input.eventType || prior.requestId !== input.requestId || prior.action !== input.action || prior.byteLength !== input.byteLength) throw new AuditAdmissionError("AUDIT_EVENT_ID_CONFLICT", "Event identity was reused with different canonical content."); return this.receipt(prior); }
    if (!this.quorumAvailable) throw new AuditAdmissionError("AUDIT_QUORUM_UNAVAILABLE", "Audit write quorum is unavailable.");
    if (!this.witnessHealthy || this.now().valueOf() - this.checkpointAt > this.checkpointMaxAgeMs) throw new AuditAdmissionError("AUDIT_DR_CHECKPOINT_STALE", "Witness or DR completeness checkpoint is stale.");
    if (input.byteLength > this.maxBytes) throw new AuditAdmissionError("AUDIT_EVENT_TOO_LARGE", "Audit evidence exceeds the hard event limit.");
    const partitionId = this.partition(input.partitionKey); const priorOffset = this.offsets.get(partitionId) ?? 0; const committedOffset = priorOffset + 1; this.offsets.set(partitionId, committedOffset);
    const receipt: AuditReceipt = { eventId: input.eventId, partitionId, committedOffset, committedTerm: 3, committedAt: this.now().toISOString(), receiptDigest: `audit:${partitionId}:${committedOffset}:${input.intentDigest}` };
    const committed = { ...input, ...receipt, producerId: producer.workloadId };
    try { this.persist(committed); } catch (error) { this.offsets.set(partitionId, priorOffset); throw error; }
    this.events.set(input.eventId, committed); return receipt;
  }
  appendOutcome(producer: AttestedProducer, input: { eventId: string; intentEventId: string; ownerEventRef: string; ownerDigest: string }): AuditReceipt {
    const intent = this.events.get(input.intentEventId); if (!intent) throw new AuditAdmissionError("AUDIT_INTENT_NOT_FOUND", "Outcome has no compatible committed intent.");
    if (!producer.attested || producer.workloadId !== intent.producerId) throw new AuditAdmissionError("AUDIT_OUTCOME_FORBIDDEN", "Only the declared authoritative owner may append this outcome.");
    return this.appendIntent(producer, { eventId: input.eventId, partitionKey: intent.partitionKey, eventType: `${intent.eventType}.outcome`, requestId: intent.requestId, action: intent.action, intentDigest: `${intent.intentDigest}:${input.ownerEventRef}:${input.ownerDigest}`, byteLength: input.ownerEventRef.length + input.ownerDigest.length });
  }
  private loadPersisted(): void {
    for (const row of this.db!.prepare("SELECT event_id, partition_key, event_type, request_id, action, intent_digest, byte_length, partition_id, committed_offset, committed_term, committed_at, receipt_digest, producer_id FROM audit_events").all() as Array<Record<string, unknown>>) {
      const event: CommittedIntent = {
        eventId: row.event_id as string, partitionKey: row.partition_key as string, eventType: row.event_type as string, requestId: row.request_id as string, action: row.action as string,
        intentDigest: row.intent_digest as string, byteLength: row.byte_length as number, partitionId: row.partition_id as number, committedOffset: row.committed_offset as number,
        committedTerm: row.committed_term as number, committedAt: row.committed_at as string, receiptDigest: row.receipt_digest as string, producerId: row.producer_id as string,
      };
      this.events.set(event.eventId, event);
      this.offsets.set(event.partitionId, Math.max(this.offsets.get(event.partitionId) ?? 0, event.committedOffset));
    }
  }
  private persist(event: CommittedIntent): void {
    if (!this.db) return;
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.db.prepare("INSERT INTO audit_events (event_id, partition_key, event_type, request_id, action, intent_digest, byte_length, partition_id, committed_offset, committed_term, committed_at, receipt_digest, producer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        event.eventId, event.partitionKey, event.eventType, event.requestId, event.action, event.intentDigest, event.byteLength, event.partitionId, event.committedOffset, event.committedTerm, event.committedAt, event.receiptDigest, event.producerId,
      );
      this.db.exec("COMMIT;");
    } catch (error) {
      try { this.db.exec("ROLLBACK;"); } catch { /* transaction was already closed */ }
      throw error;
    }
  }
  private partition(key: string): number { let hash = 0; for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0; return hash % this.partitionCount; }
  private receipt(event: CommittedIntent): AuditReceipt { const { eventId, partitionId, committedOffset, committedTerm, committedAt, receiptDigest } = event; return { eventId, partitionId, committedOffset, committedTerm, committedAt, receiptDigest }; }
}
