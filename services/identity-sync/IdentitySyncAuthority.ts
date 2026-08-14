export type IdentityState = "active" | "disabled" | "recompute_pending" | "source_conflict" | "tombstoned";
export class IdentityReadError extends Error { constructor(readonly code: "subject_unknown" | "subject_disabled" | "recompute_pending" | "source_conflict" | "facts_stale" | "revision_not_available" | "batch_id_conflict") { super(code); } }
export interface IdentityAuditPort { admitSyncBatch(digest: string): { receiptDigest: string }; }
export interface SubjectMutation { subjectRef: string; accountState: "active" | "disabled"; facts: Readonly<Record<string, string>>; groups: readonly string[]; sourceVersion: number; tombstone?: boolean; }
interface Subject { subjectRef: string; revision: number; state: IdentityState; facts: Readonly<Record<string, string>>; groups: readonly string[]; sourceVersion: number; updatedAt: number; }
/** Doc 002 projection owner. It returns facts or typed failures, never an authorization decision. */
export class IdentitySyncAuthority {
  private readonly subjects = new Map<string, Subject>(); private readonly batches = new Map<string, { cursor: number; digest: string }>(); private cursor = 0;
  readonly outbox: { eventId: string; subjectRef: string; revision: number; auditReceipt: string }[] = [];
  constructor(private readonly audit: IdentityAuditPort, private readonly now = () => Date.now(), private readonly fanoutLimit = 10_000) {}
  applyBatch(batch: { batchId: string; cursor: number; sourceRef: string; mutations: readonly SubjectMutation[] }): number {
    const digest = `${batch.sourceRef}:${batch.cursor}:${batch.mutations.map((value) => `${value.subjectRef}:${value.sourceVersion}`).join("|")}`; const prior = this.batches.get(batch.batchId); if (prior) { if (prior.digest !== digest) throw new IdentityReadError("batch_id_conflict"); return prior.cursor; } if (batch.cursor <= this.cursor) throw new IdentityReadError("revision_not_available");
    const receipt = this.audit.admitSyncBatch(digest);
    for (const mutation of batch.mutations) { const existing = this.subjects.get(mutation.subjectRef); if (existing && mutation.sourceVersion <= existing.sourceVersion) continue; const revision = (existing?.revision ?? 0) + 1; const state: IdentityState = batch.mutations.length > this.fanoutLimit ? "recompute_pending" : mutation.tombstone ? "tombstoned" : mutation.accountState === "disabled" ? "disabled" : "active"; this.subjects.set(mutation.subjectRef, { subjectRef: mutation.subjectRef, revision, state, facts: { ...mutation.facts }, groups: [...mutation.groups], sourceVersion: mutation.sourceVersion, updatedAt: this.now() }); this.outbox.push({ eventId: `identity:${mutation.subjectRef}:${revision}`, subjectRef: mutation.subjectRef, revision, auditReceipt: receipt.receiptDigest }); }
    this.cursor = batch.cursor; this.batches.set(batch.batchId, { cursor: batch.cursor, digest }); return batch.cursor;
  }
  readSnapshot(subjectRef: string, maximumSourceAgeMs: number, minimumRevision?: number): { subjectRef: string; subjectSecurityRevision: number; facts: Readonly<Record<string, string>>; groups: readonly string[]; sourceAgeMs: number } {
    const subject = this.subjects.get(subjectRef); if (!subject) throw new IdentityReadError("subject_unknown"); if (subject.state === "disabled" || subject.state === "tombstoned") throw new IdentityReadError("subject_disabled"); if (subject.state === "recompute_pending") throw new IdentityReadError("recompute_pending"); if (subject.state === "source_conflict") throw new IdentityReadError("source_conflict"); const age = this.now() - subject.updatedAt; if (age > maximumSourceAgeMs) throw new IdentityReadError("facts_stale"); if (minimumRevision !== undefined && subject.revision < minimumRevision) throw new IdentityReadError("revision_not_available"); return { subjectRef, subjectSecurityRevision: subject.revision, facts: { ...subject.facts }, groups: [...subject.groups], sourceAgeMs: age };
  }
}
