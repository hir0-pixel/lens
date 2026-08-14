export type AuditErrorCode = "AUDIT_QUORUM_UNAVAILABLE" | "AUDIT_EVENT_ID_CONFLICT" | "AUDIT_PRODUCER_FORBIDDEN" | "AUDIT_EVENT_TOO_LARGE" | "AUDIT_INTENT_NOT_FOUND" | "AUDIT_OUTCOME_FORBIDDEN" | "AUDIT_DR_CHECKPOINT_STALE";
export class AuditAdmissionError extends Error { constructor(readonly code: AuditErrorCode, message: string) { super(message); } }
export interface AttestedProducer { workloadId: string; attested: boolean; }
export interface AuditIntent { eventId: string; partitionKey: string; eventType: string; requestId: string; action: string; intentDigest: string; byteLength: number; }
export interface AuditReceipt { eventId: string; partitionId: number; committedOffset: number; committedTerm: number; committedAt: string; receiptDigest: string; }
interface CommittedIntent extends AuditIntent, AuditReceipt { producerId: string; }

/** Doc 021 model: producer identity is attested; only quorum receipts authorize protected work. */
export class AuditLedger {
  private readonly events = new Map<string, CommittedIntent>();
  private readonly offsets = new Map<number, number>();
  private quorumAvailable = true;
  private witnessHealthy = true;
  private checkpointAt: number;
  constructor(private readonly allowedEvents: Readonly<Record<string, readonly string[]>>, private readonly now = () => new Date(), private readonly partitionCount = 64, private readonly maxBytes = 65_536, private readonly checkpointMaxAgeMs = 60_000) { this.checkpointAt = now().valueOf(); }
  setHealth(state: { quorumAvailable?: boolean; witnessHealthy?: boolean; checkpointAt?: number }): void { if (state.quorumAvailable !== undefined) this.quorumAvailable = state.quorumAvailable; if (state.witnessHealthy !== undefined) this.witnessHealthy = state.witnessHealthy; if (state.checkpointAt !== undefined) this.checkpointAt = state.checkpointAt; }
  appendIntent(producer: AttestedProducer, input: AuditIntent): AuditReceipt {
    const allowed = this.allowedEvents[producer.workloadId] ?? [];
    const baseEvent = input.eventType.endsWith(".outcome") ? input.eventType.slice(0, -".outcome".length) : input.eventType;
    if (!producer.attested || !allowed.includes(baseEvent)) throw new AuditAdmissionError("AUDIT_PRODUCER_FORBIDDEN", "Producer is not attested or allowlisted for this event type.");
    const prior = this.events.get(input.eventId);
    if (prior) { if (prior.intentDigest !== input.intentDigest || prior.partitionKey !== input.partitionKey || prior.eventType !== input.eventType || prior.requestId !== input.requestId || prior.action !== input.action || prior.byteLength !== input.byteLength) throw new AuditAdmissionError("AUDIT_EVENT_ID_CONFLICT", "Event identity was reused with different canonical content."); return this.receipt(prior); }
    if (!this.quorumAvailable) throw new AuditAdmissionError("AUDIT_QUORUM_UNAVAILABLE", "Audit write quorum is unavailable.");
    if (!this.witnessHealthy || this.now().valueOf() - this.checkpointAt > this.checkpointMaxAgeMs) throw new AuditAdmissionError("AUDIT_DR_CHECKPOINT_STALE", "Witness or DR completeness checkpoint is stale.");
    if (input.byteLength > this.maxBytes) throw new AuditAdmissionError("AUDIT_EVENT_TOO_LARGE", "Audit evidence exceeds the hard event limit.");
    const partitionId = this.partition(input.partitionKey); const committedOffset = (this.offsets.get(partitionId) ?? 0) + 1; this.offsets.set(partitionId, committedOffset);
    const receipt: AuditReceipt = { eventId: input.eventId, partitionId, committedOffset, committedTerm: 3, committedAt: this.now().toISOString(), receiptDigest: `audit:${partitionId}:${committedOffset}:${input.intentDigest}` };
    this.events.set(input.eventId, { ...input, ...receipt, producerId: producer.workloadId }); return receipt;
  }
  appendOutcome(producer: AttestedProducer, input: { eventId: string; intentEventId: string; ownerEventRef: string; ownerDigest: string }): AuditReceipt {
    const intent = this.events.get(input.intentEventId); if (!intent) throw new AuditAdmissionError("AUDIT_INTENT_NOT_FOUND", "Outcome has no compatible committed intent.");
    if (!producer.attested || producer.workloadId !== intent.producerId) throw new AuditAdmissionError("AUDIT_OUTCOME_FORBIDDEN", "Only the declared authoritative owner may append this outcome.");
    return this.appendIntent(producer, { eventId: input.eventId, partitionKey: intent.partitionKey, eventType: `${intent.eventType}.outcome`, requestId: intent.requestId, action: intent.action, intentDigest: `${intent.intentDigest}:${input.ownerEventRef}:${input.ownerDigest}`, byteLength: input.ownerEventRef.length + input.ownerDigest.length });
  }
  private partition(key: string): number { let hash = 0; for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0; return hash % this.partitionCount; }
  private receipt(event: CommittedIntent): AuditReceipt { const { eventId, partitionId, committedOffset, committedTerm, committedAt, receiptDigest } = event; return { eventId, partitionId, committedOffset, committedTerm, committedAt, receiptDigest }; }
}
