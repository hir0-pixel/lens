export class RecoveryError extends Error {
  constructor(readonly code: "INCIDENT_INVALID" | "CONTAINMENT_INCOMPLETE" | "RESTORE_INVALID" | "FENCE_INVALID" | "RECOVERY_INCOMPLETE" | "TRAFFIC_BLOCKED" | "CLEANUP_INVALID") { super(code); }
}

export interface IncidentDeclaration { incidentId: string; scopeDigest: string; signedDeclarationDigest: string; auditAdmissionReceipt: string; }
export interface IncidentAuthority { verify(input: IncidentDeclaration): { declarationEvidenceDigest: string; commanderRef: string }; }
export interface OwnerContainment { owner: string; action: "revoke" | "isolate" | "freeze" | "preserve_evidence"; targetDigest: string; }
export interface ContainmentPort { execute(input: IncidentDeclaration & OwnerContainment): { targetReceipt: string; targetEvidenceDigest: string }; }

export interface PrivilegedChangeFence {
  fenceId: string;
  fenceDigest: string;
  subjectRef: string;
  deviceRef: string;
  independentApproverRef: string;
  targetIdentity: "backup" | "traffic-gate" | "restore-cell";
  operation: "restore.select" | "traffic.reopen" | "restore.cleanup";
  canonicalPayloadDigest: string;
  expiresAt: number;
  nonce: string;
  auditAdmissionReceipt: string;
}

export interface RestoreProof {
  evidenceManifestDigest: string;
  independentReviewerRef: string;
  auditContinuous: boolean;
  secretsManifestCurrent: boolean;
  keyAndRevocationEpochsCurrent: boolean;
  recoveryShareQuorum: boolean;
  authorityHeadsRestored: boolean;
  currentArtifactsAdmitted: boolean;
  nodesReattested: boolean;
  abuseRegressionPassed: boolean;
  ambiguousPreFailoverWorkFrozen: boolean;
  ownerReconciliationComplete: boolean;
  restoreCellNoPublicRoute: boolean;
  restoreCellNoCorporateRoute: boolean;
  restoreCellNoProductionRoute: boolean;
  restoreCellNoExportRoute: boolean;
  plaintextZeroizedOrQuarantined: boolean;
  auditAdmissionReceipt: string;
}
export interface RecoveryVerifier { verify(input: { restoreId: string; recoveryManifestDigest: string; checkpointAgeSeconds: number }): RestoreProof; }
export interface TrafficGate { reopen(input: { restoreId: string; incidentId: string; proofAuditReceipt: string; evidenceManifestDigest: string; fence: PrivilegedChangeFence }): { targetReceipt: string; targetEvidenceDigest: string }; }
export interface RecoverySession { restoreId: string; incidentId: string; backupSetDigest: string; recoveryManifestDigest: string; checkpointAgeSeconds: number; selectorRef: string; approverRef: string; state: "CONTAINED" | "RESTORE_VERIFIED" | "TRAFFIC_REOPENED" | "CLOSED" | "QUARANTINED"; }

/** Coordinates recovery evidence; every mutation remains a separate owner target action. */
export class RecoveryCoordinator {
  private readonly incidents = new Map<string, IncidentDeclaration>();
  private readonly sessions = new Map<string, RecoverySession>();
  private readonly consumedFenceNonces = new Set<string>();
  private nextRestore = 0;

  constructor(private readonly incidentAuthority: IncidentAuthority, private readonly containment: ContainmentPort, private readonly verifier: RecoveryVerifier, private readonly traffic: TrafficGate, private readonly now = () => Date.now()) {}

  contain(incident: IncidentDeclaration, actions: OwnerContainment[]): void {
    if (!this.validIncident(incident) || actions.length === 0) throw new RecoveryError("INCIDENT_INVALID");
    const declaration = this.incidentAuthority.verify(incident);
    if (!this.digest(declaration.declarationEvidenceDigest) || !declaration.commanderRef) throw new RecoveryError("INCIDENT_INVALID");
    for (const action of actions) {
      if (!action.owner || !this.digest(action.targetDigest)) throw new RecoveryError("INCIDENT_INVALID");
      const receipt = this.containment.execute({ ...incident, ...action });
      if (!receipt.targetReceipt || !this.digest(receipt.targetEvidenceDigest)) throw new RecoveryError("CONTAINMENT_INCOMPLETE");
    }
    this.incidents.set(incident.incidentId, { ...incident });
  }

  beginRestore(input: { incidentId: string; backupSetDigest: string; recoveryManifestDigest: string; checkpointAgeSeconds: number; restoreIntentDigest: string; restoreFence: PrivilegedChangeFence; selectorRef: string; approverRef: string }): RecoverySession {
    if (!this.incidents.has(input.incidentId) || !this.digest(input.backupSetDigest) || !this.digest(input.recoveryManifestDigest) || !this.digest(input.restoreIntentDigest) || input.checkpointAgeSeconds < 0 || !input.selectorRef || !input.approverRef || input.selectorRef === input.approverRef) throw new RecoveryError("RESTORE_INVALID");
    this.consumeFence(input.restoreFence, "backup", "restore.select", input.restoreIntentDigest, input.selectorRef, input.approverRef);
    const session: RecoverySession = { restoreId: `restore-${++this.nextRestore}`, incidentId: input.incidentId, backupSetDigest: input.backupSetDigest, recoveryManifestDigest: input.recoveryManifestDigest, checkpointAgeSeconds: input.checkpointAgeSeconds, selectorRef: input.selectorRef, approverRef: input.approverRef, state: "CONTAINED" };
    this.sessions.set(session.restoreId, session); return { ...session };
  }

  verifyRestore(restoreId: string): RecoverySession {
    const session = this.requireSession(restoreId);
    if (session.state !== "CONTAINED" || !this.completeProof(session, this.verifier.verify({ restoreId, recoveryManifestDigest: session.recoveryManifestDigest, checkpointAgeSeconds: session.checkpointAgeSeconds }))) throw new RecoveryError("RECOVERY_INCOMPLETE");
    session.state = "RESTORE_VERIFIED"; return { ...session };
  }

  reopenTraffic(input: { restoreId: string; reopenIntentDigest: string; reopenFence: PrivilegedChangeFence }): RecoverySession {
    const session = this.requireSession(input.restoreId);
    if (session.state !== "RESTORE_VERIFIED" || !this.digest(input.reopenIntentDigest)) throw new RecoveryError("TRAFFIC_BLOCKED");
    const proof = this.verifier.verify({ restoreId: input.restoreId, recoveryManifestDigest: session.recoveryManifestDigest, checkpointAgeSeconds: session.checkpointAgeSeconds });
    if (!this.completeProof(session, proof)) throw new RecoveryError("TRAFFIC_BLOCKED");
    this.consumeFence(input.reopenFence, "traffic-gate", "traffic.reopen", input.reopenIntentDigest, session.selectorRef, session.approverRef);
    const target = this.traffic.reopen({ restoreId: input.restoreId, incidentId: session.incidentId, proofAuditReceipt: proof.auditAdmissionReceipt, evidenceManifestDigest: proof.evidenceManifestDigest, fence: { ...input.reopenFence } });
    if (!target.targetReceipt || !this.digest(target.targetEvidenceDigest)) throw new RecoveryError("TRAFFIC_BLOCKED");
    session.state = "TRAFFIC_REOPENED"; return { ...session };
  }

  closeRestore(input: { restoreId: string; cleanupIntentDigest: string; cleanupFence: PrivilegedChangeFence; signedAcceptanceDigest: string; zeroized: boolean; quarantined: boolean }): RecoverySession {
    const session = this.requireSession(input.restoreId);
    if (session.state !== "TRAFFIC_REOPENED" || !this.digest(input.cleanupIntentDigest) || !this.digest(input.signedAcceptanceDigest) || (!input.zeroized && !input.quarantined)) throw new RecoveryError("CLEANUP_INVALID");
    this.consumeFence(input.cleanupFence, "restore-cell", "restore.cleanup", input.cleanupIntentDigest, session.selectorRef, session.approverRef);
    session.state = input.quarantined ? "QUARANTINED" : "CLOSED"; return { ...session };
  }

  private completeProof(session: RecoverySession, proof: RestoreProof): boolean {
    return session.checkpointAgeSeconds <= 60 && this.digest(proof.evidenceManifestDigest) && !!proof.independentReviewerRef && proof.independentReviewerRef !== session.selectorRef && proof.auditContinuous && proof.secretsManifestCurrent && proof.keyAndRevocationEpochsCurrent && proof.recoveryShareQuorum && proof.authorityHeadsRestored && proof.currentArtifactsAdmitted && proof.nodesReattested && proof.abuseRegressionPassed && proof.ambiguousPreFailoverWorkFrozen && proof.ownerReconciliationComplete && proof.restoreCellNoPublicRoute && proof.restoreCellNoCorporateRoute && proof.restoreCellNoProductionRoute && proof.restoreCellNoExportRoute && proof.plaintextZeroizedOrQuarantined && !!proof.auditAdmissionReceipt;
  }
  private consumeFence(fence: PrivilegedChangeFence, target: PrivilegedChangeFence["targetIdentity"], operation: PrivilegedChangeFence["operation"], payloadDigest: string, subjectRef: string, approverRef: string): void {
    if (!fence.fenceId || !this.digest(fence.fenceDigest) || fence.subjectRef !== subjectRef || fence.independentApproverRef !== approverRef || fence.independentApproverRef === fence.subjectRef || !fence.deviceRef || fence.targetIdentity !== target || fence.operation !== operation || fence.canonicalPayloadDigest !== payloadDigest || fence.expiresAt <= this.now() || !fence.nonce || this.consumedFenceNonces.has(fence.nonce) || !fence.auditAdmissionReceipt) throw new RecoveryError("FENCE_INVALID");
    this.consumedFenceNonces.add(fence.nonce);
  }
  private requireSession(restoreId: string): RecoverySession { const session = this.sessions.get(restoreId); if (!session) throw new RecoveryError("RESTORE_INVALID"); return session; }
  private validIncident(value: IncidentDeclaration): boolean { return !!value.incidentId && this.digest(value.scopeDigest) && this.digest(value.signedDeclarationDigest) && !!value.auditAdmissionReceipt; }
  private digest(value: string): boolean { return /^sha256:[A-Za-z0-9._-]+$/.test(value); }
}
