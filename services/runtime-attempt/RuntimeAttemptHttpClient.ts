import type { AcceptAttemptInput, BeginDispatchAttemptInput, RuntimeAttemptRecord, RuntimeAttemptState, RuntimeAttemptStore, SchedulerLeaseBinding } from "./RuntimeAttemptStore";
import { RuntimeAttemptError } from "./RuntimeAttemptStore";
import { assertInternalOrigin, assertWorkloadToken, readBoundedJson, type FetchPort } from "../internal-http/internalHttp";

export class RuntimeAttemptHttpClient implements RuntimeAttemptStore {
  private readonly origin: URL;
  constructor(serviceUrl: string, private readonly workloadToken: string, private readonly fetcher: FetchPort = fetch) {
    this.origin = assertInternalOrigin(serviceUrl, "LENS_MODEL_RUNTIME_URL");
    assertWorkloadToken(workloadToken, "LENS_MODEL_RUNTIME_WORKLOAD_TOKEN");
  }

  async allocateGeneration(logicalAttemptId: string): Promise<number> {
    const record = await this.post("/v1/attempts/allocate-generation", { logical_attempt_id: logicalAttemptId });
    return Number((record as unknown as { generation?: number }).generation);
  }

  async listLogicalAttempts(logicalAttemptId: string): Promise<RuntimeAttemptRecord[]> {
    const record = await this.post("/v1/attempts/list-logical", { logical_attempt_id: logicalAttemptId });
    return ((record as unknown as { attempts?: RuntimeAttemptRecord[] }).attempts ?? []) as RuntimeAttemptRecord[];
  }

  async accept(input: AcceptAttemptInput): Promise<RuntimeAttemptRecord> {
    return this.post("/v1/attempts/accept", {
      reservation_id: input.reservationId,
      logical_attempt_id: input.logicalAttemptId,
      attempt_generation: input.attemptGeneration,
      request_id: input.requestId,
      turn_id: input.turnId,
      step_id: input.stepId,
      request_digest: input.requestDigest,
      model_ref: input.modelRef,
      artifact_digest: input.artifactDigest,
      endpoint_generation: input.endpointGeneration,
      deadline_at: input.deadlineAt,
    });
  }

  async beginDispatchAttempt(input: BeginDispatchAttemptInput): Promise<RuntimeAttemptRecord> {
    return this.post("/v1/attempts/begin-dispatch", {
      logical_attempt_id: input.logicalAttemptId,
      request_id: input.requestId,
      turn_id: input.turnId,
      step_id: input.stepId,
      request_digest: input.requestDigest,
      model_ref: input.modelRef,
      artifact_digest: input.artifactDigest,
      endpoint_generation: input.endpointGeneration,
      deadline_at: input.deadlineAt,
    });
  }

  async bindSchedulerLease(reservationId: string, lease: SchedulerLeaseBinding): Promise<RuntimeAttemptRecord> {
    return this.post("/v1/attempts/bind-lease", {
      reservation_id: reservationId,
      fence: lease.fence,
      endpoint_ref: lease.endpointRef,
      endpoint_generation: lease.endpointGeneration,
      request_digest: lease.requestDigest,
      expires_at: lease.expiresAt,
      lease_token: lease.leaseToken,
    });
  }

  async commitContactIntent(reservationId: string): Promise<RuntimeAttemptRecord> {
    return this.post("/v1/attempts/contact-intent", { reservation_id: reservationId });
  }

  async transitionTo(reservationId: string, to: RuntimeAttemptState): Promise<RuntimeAttemptRecord> {
    return this.post("/v1/attempts/transition", { reservation_id: reservationId, to });
  }

  async markNotStarted(reservationId: string, _proofNoContact: true): Promise<RuntimeAttemptRecord> {
    void _proofNoContact;
    return this.post("/v1/attempts/not-started", { reservation_id: reservationId });
  }

  async markOutcomeUnknown(reservationId: string): Promise<RuntimeAttemptRecord> {
    return this.post("/v1/attempts/unknown", { reservation_id: reservationId });
  }

  async completeWithUsage(): Promise<RuntimeAttemptRecord> {
    throw new RuntimeAttemptError("FORBIDDEN", "Sidecar usage is recorded only by the runtime adapter.");
  }

  async reconcileExpired(): Promise<number> {
    const record = await this.post("/v1/attempts/reconcile", {});
    return Number((record as unknown as { reconciled?: number }).reconciled ?? 0);
  }

  async getAttemptStatus(reservationId: string): Promise<RuntimeAttemptRecord> {
    return this.post("/v1/attempts/status", { reservation_id: reservationId });
  }

  async ready(): Promise<boolean> {
    try {
      const response = await this.fetcher(new URL("/readyz", this.origin), { method: "GET", redirect: "error", signal: AbortSignal.timeout(2_000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async post(path: string, body: Record<string, unknown>): Promise<RuntimeAttemptRecord> {
    const response = await this.fetcher(new URL(path, this.origin), {
      method: "POST",
      headers: { "content-type": "application/json", "x-lens-model-workload-token": this.workloadToken },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 404) throw new RuntimeAttemptError("NOT_FOUND", "No runtime attempt exists for this reservation.");
    if (response.status === 409) throw new RuntimeAttemptError("CONFLICT", "Runtime attempt conflict.");
    if (!response.ok) throw new RuntimeAttemptError("UNAVAILABLE", "RuntimeAttemptStore is unavailable.");
    return await readBoundedJson(response) as RuntimeAttemptRecord;
  }
}
