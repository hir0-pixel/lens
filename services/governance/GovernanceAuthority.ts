export type Classification = "public" | "internal" | "confidential" | "restricted";
export type PublicationState = "draft" | "active" | "superseded" | "withdrawn" | "deleted";
export type ProcessingState = "pending" | "indexed" | "quarantined";
export type IntegrityState = "unknown" | "valid" | "failed";
export type PreservationState = "normal" | "retained" | "legal_hold";

export class GovernanceError extends Error {
  constructor(readonly code: "INVALID_ARGUMENT" | "CONFLICT" | "STALE_AUTHORITY" | "FORBIDDEN" | "EVIDENCE_REQUIRED", message: string) {
    super(message);
  }
}

export interface ResourceSecurityFacts {
  documentVersionRef: string;
  resourceSecurityRevision: number;
  publication: PublicationState;
  processing: ProcessingState;
  integrity: IntegrityState;
  classification: Classification;
  aclDigest: `sha256:${string}`;
  retrievalEligible: boolean;
}

interface PreservationHead {
  revision: number;
  state: PreservationState;
  retentionPolicyRef?: string;
  holdRefs: ReadonlySet<string>;
}

export interface GovernanceOutboxEvent {
  eventId: string;
  eventType: "governance.resource-security.changed" | "governance.preservation.changed";
  documentVersionRef: string;
  revision: number;
}

export interface PrivilegedChangeFence {
  fenceId: string;
  actorRef: string;
  approverRef: string;
  expiresAt: number;
}

export interface RegisterVersionInput {
  documentVersionRef: string;
  classification: Classification;
  aclDigest: `sha256:${string}`;
}

export interface SecurityMutation {
  publication?: PublicationState;
  processing?: ProcessingState;
  integrity?: IntegrityState;
  classification?: Classification;
  aclDigest?: `sha256:${string}`;
}

export interface DisclosureReceipt {
  runRef: string;
  finalCounterDigest: `sha256:${string}`;
  terminal: boolean;
  pendingWork: boolean;
}

export interface DisclosureReservationRequest {
  reservationId: string;
  subjectRef: string;
  deviceRef: string;
  applicationRef: string;
  purposeRef: string;
  channel: string;
  resourceSetDigest: `sha256:${string}`;
  sourceClassifications: readonly Classification[];
  detectorClassification?: Classification;
  outputDigest: `sha256:${string}`;
  lineageDigest: `sha256:${string}`;
  units: number;
  ceiling: number;
  terminalReceipt: DisclosureReceipt;
  expiresAt: number;
}

export interface DisclosureReservation {
  reservationId: string;
  classification: Classification;
  outputDigest: `sha256:${string}`;
  lineageDigest: `sha256:${string}`;
  units: number;
  expiresAt: number;
  state: "reserved" | "committed" | "uncertain";
}

interface ExposureHead {
  committed: number;
  reserved: number;
}

const classificationRank: Record<Classification, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

function strongestClassification(values: readonly Classification[]): Classification {
  return values.reduce<Classification>((strongest, value) =>
    classificationRank[value] > classificationRank[strongest] ? value : strongest,
  "public");
}

function ensureDigest(value: string): asserts value is `sha256:${string}` {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new GovernanceError("INVALID_ARGUMENT", "A canonical digest is required.");
  }
}

/**
 * In-memory authority model for M03. Production persists these state changes
 * and their outbox records in one serializable transaction.
 */
export class GovernanceAuthority {
  private readonly resources = new Map<string, ResourceSecurityFacts>();
  private readonly preservation = new Map<string, PreservationHead>();
  private readonly reservations = new Map<string, DisclosureReservation>();
  private readonly reservationRequests = new Map<string, string>();
  private readonly exposure = new Map<string, ExposureHead>();
  readonly outbox: GovernanceOutboxEvent[] = [];

  constructor(private readonly now: () => number = () => Date.now()) {}

  registerVersion(input: RegisterVersionInput): ResourceSecurityFacts {
    ensureDigest(input.aclDigest);
    if (!input.documentVersionRef || this.resources.has(input.documentVersionRef)) {
      throw new GovernanceError("CONFLICT", "The document version cannot be registered.");
    }
    const facts: ResourceSecurityFacts = {
      documentVersionRef: input.documentVersionRef,
      resourceSecurityRevision: 1,
      publication: "draft",
      processing: "pending",
      integrity: "unknown",
      classification: input.classification,
      aclDigest: input.aclDigest,
      retrievalEligible: false,
    };
    this.resources.set(input.documentVersionRef, facts);
    this.preservation.set(input.documentVersionRef, { revision: 1, state: "normal", holdRefs: new Set() });
    this.writeOutbox("governance.resource-security.changed", facts.documentVersionRef, facts.resourceSecurityRevision);
    return { ...facts };
  }

  mutateSecurity(documentVersionRef: string, mutation: SecurityMutation, fence: PrivilegedChangeFence): ResourceSecurityFacts {
    this.validateFence(fence);
    const current = this.requireResource(documentVersionRef);
    if (mutation.aclDigest) ensureDigest(mutation.aclDigest);
    if (mutation.classification && classificationRank[mutation.classification] < classificationRank[current.classification]) {
      throw new GovernanceError("FORBIDDEN", "Classification cannot be lowered by this operation.");
    }
    const next = { ...current, ...mutation };
    if (next.publication === "active" && (next.processing !== "indexed" || next.integrity !== "valid")) {
      throw new GovernanceError("STALE_AUTHORITY", "The version is not eligible for publication.");
    }
    next.resourceSecurityRevision += 1;
    next.retrievalEligible = next.publication === "active" && next.processing === "indexed" && next.integrity === "valid";
    this.resources.set(documentVersionRef, next);
    this.writeOutbox("governance.resource-security.changed", documentVersionRef, next.resourceSecurityRevision);
    return { ...next };
  }

  setPreservation(documentVersionRef: string, state: PreservationState, holdRef: string | undefined, fence: PrivilegedChangeFence): number {
    this.validateFence(fence);
    this.requireResource(documentVersionRef);
    const current = this.preservation.get(documentVersionRef);
    if (!current) throw new GovernanceError("STALE_AUTHORITY", "Preservation state is unavailable.");
    const holdRefs = new Set(current.holdRefs);
    if (state === "legal_hold") {
      if (!holdRef) throw new GovernanceError("INVALID_ARGUMENT", "A legal hold reference is required.");
      holdRefs.add(holdRef);
    }
    const next: PreservationHead = { revision: current.revision + 1, state, holdRefs };
    this.preservation.set(documentVersionRef, next);
    this.writeOutbox("governance.preservation.changed", documentVersionRef, next.revision);
    return next.revision;
  }

  canPurge(documentVersionRef: string): boolean {
    const head = this.preservation.get(documentVersionRef);
    return head?.state === "normal" && head.holdRefs.size === 0;
  }

  getResourceSecurityFacts(refs: readonly string[], requiredMinimums: Readonly<Record<string, number>> = {}): ResourceSecurityFacts[] {
    if (refs.length === 0 || refs.length > 1000) {
      throw new GovernanceError("INVALID_ARGUMENT", "The resource batch is outside its limit.");
    }
    return refs.map((ref) => {
      const facts = this.requireResource(ref);
      if (requiredMinimums[ref] !== undefined && requiredMinimums[ref] !== facts.resourceSecurityRevision) {
        throw new GovernanceError("STALE_AUTHORITY", "The resource security revision changed.");
      }
      return { ...facts };
    });
  }

  reserveDisclosure(request: DisclosureReservationRequest): DisclosureReservation {
    this.validateReservationRequest(request);
    const canonical = JSON.stringify(request);
    const existing = this.reservations.get(request.reservationId);
    if (existing) {
      if (this.reservationRequests.get(request.reservationId) !== canonical) {
        throw new GovernanceError("CONFLICT", "The reservation identifier was reused with different content.");
      }
      return { ...existing };
    }
    const classification = strongestClassification([
      ...request.sourceClassifications,
      ...(request.detectorClassification ? [request.detectorClassification] : []),
    ]);
    const key = this.exposureKey(request, classification);
    const head = this.exposure.get(key) ?? { committed: 0, reserved: 0 };
    if (head.committed + head.reserved + request.units > request.ceiling) {
      throw new GovernanceError("FORBIDDEN", "The disclosure exposure ceiling would be exceeded.");
    }
    head.reserved += request.units;
    this.exposure.set(key, head);
    const reservation: DisclosureReservation = {
      reservationId: request.reservationId,
      classification,
      outputDigest: request.outputDigest,
      lineageDigest: request.lineageDigest,
      units: request.units,
      expiresAt: request.expiresAt,
      state: "reserved",
    };
    this.reservations.set(request.reservationId, reservation);
    this.reservationRequests.set(request.reservationId, canonical);
    return { ...reservation };
  }

  commitDisclosure(reservationId: string, outputDigest: `sha256:${string}`, releaseFenceRef: string): DisclosureReservation {
    ensureDigest(outputDigest);
    if (!releaseFenceRef) throw new GovernanceError("EVIDENCE_REQUIRED", "A release fence is required.");
    const reservation = this.reservations.get(reservationId);
    if (!reservation || reservation.outputDigest !== outputDigest) {
      throw new GovernanceError("CONFLICT", "The disclosure reservation does not match the output.");
    }
    if (reservation.state === "committed") return { ...reservation };
    if (reservation.state === "uncertain" || reservation.expiresAt <= this.now()) {
      throw new GovernanceError("STALE_AUTHORITY", "The disclosure reservation is not releasable.");
    }
    const request = this.reservationRequests.get(reservationId);
    if (!request) throw new GovernanceError("STALE_AUTHORITY", "The disclosure reservation is unavailable.");
    const key = this.exposureKey(JSON.parse(request) as DisclosureReservationRequest, reservation.classification);
    const head = this.exposure.get(key);
    if (!head) throw new GovernanceError("STALE_AUTHORITY", "The exposure ledger is unavailable.");
    head.reserved -= reservation.units;
    head.committed += reservation.units;
    reservation.state = "committed";
    return { ...reservation };
  }

  markDisclosureUncertain(reservationId: string): void {
    const reservation = this.reservations.get(reservationId);
    if (reservation?.state === "reserved") reservation.state = "uncertain";
  }

  private validateFence(fence: PrivilegedChangeFence): void {
    if (!fence.fenceId || !fence.actorRef || !fence.approverRef || fence.actorRef === fence.approverRef || fence.expiresAt <= this.now()) {
      throw new GovernanceError("FORBIDDEN", "An independent, active privileged change fence is required.");
    }
  }

  private validateReservationRequest(request: DisclosureReservationRequest): void {
    ensureDigest(request.resourceSetDigest);
    ensureDigest(request.outputDigest);
    ensureDigest(request.lineageDigest);
    ensureDigest(request.terminalReceipt.finalCounterDigest);
    if (!request.reservationId || !request.subjectRef || !request.deviceRef || !request.applicationRef || !request.purposeRef || !request.channel || request.units <= 0 || request.ceiling < request.units || request.expiresAt <= this.now()) {
      throw new GovernanceError("INVALID_ARGUMENT", "The disclosure reservation is invalid.");
    }
    if (request.sourceClassifications.length === 0 || !request.terminalReceipt.terminal || request.terminalReceipt.pendingWork || !request.terminalReceipt.runRef) {
      throw new GovernanceError("EVIDENCE_REQUIRED", "Terminal lineage evidence is required.");
    }
  }

  private exposureKey(request: DisclosureReservationRequest, classification: Classification): string {
    return [request.subjectRef, request.deviceRef, request.applicationRef, request.purposeRef, request.channel, request.resourceSetDigest, classification].join(":");
  }

  private requireResource(ref: string): ResourceSecurityFacts {
    const facts = this.resources.get(ref);
    if (!facts) throw new GovernanceError("STALE_AUTHORITY", "The resource security facts are unavailable.");
    return facts;
  }

  private writeOutbox(eventType: GovernanceOutboxEvent["eventType"], documentVersionRef: string, revision: number): void {
    this.outbox.push({ eventId: `${eventType}:${documentVersionRef}:${revision}`, eventType, documentVersionRef, revision });
  }
}
