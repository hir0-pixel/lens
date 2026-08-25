import {
  CostAuthorityError,
  type ConsumeSubEnvelopeInput,
  type CostAuthorityPort,
  type FinalizeSubEnvelopeInput,
  type ReserveWorkflowBudgetInput,
  type WorkflowBudgetStatus,
} from "./CostAuthority";
import type { SignedAuthorityReceipt } from "../security/authorityReceipt";
import { assertInternalOrigin, assertWorkloadToken, deadlineSignal, readBoundedJson, type FetchPort } from "../internal-http/internalHttp";

export class CostAuthorityHttpClient implements CostAuthorityPort {
  private readonly origin: URL;

  constructor(serviceUrl: string, private readonly workloadToken: string, private readonly fetcher: FetchPort = fetch) {
    this.origin = assertInternalOrigin(serviceUrl, "LENS_COST_AUTHORITY_URL");
    assertWorkloadToken(workloadToken, "LENS_COST_AUTHORITY_WORKLOAD_TOKEN");
  }

  async reserveWorkflowBudget(input: ReserveWorkflowBudgetInput, signal: AbortSignal): Promise<{ reservationRef: string; revision: number }> {
    const payload = await this.post("/v1/cost/reservations", {
      request_id: input.requestId,
      turn_id: input.turnId,
      reservation_ref: input.reservationRef,
      idempotency_key: input.idempotencyKey,
      sub_envelopes: input.subEnvelopes,
      expires_at: input.expiresAt,
      workflow_profile_digest: input.workflowProfileDigest,
    }, signal) as Record<string, unknown>;
    if (typeof payload.reservation_ref !== "string" || typeof payload.revision !== "number") {
      throw new CostAuthorityError("UNAVAILABLE", "Cost authority returned a malformed reservation.");
    }
    return { reservationRef: payload.reservation_ref, revision: payload.revision };
  }

  async consumeSubEnvelope(input: ConsumeSubEnvelopeInput, signal: AbortSignal): Promise<SignedAuthorityReceipt> {
    return this.post("/v1/cost/consume", {
      reservation_ref: input.reservationRef,
      sub_envelope: input.subEnvelope,
      units: input.units,
      request_id: input.requestId,
      turn_id: input.turnId,
      step_id: input.stepId,
      idempotency_key: input.idempotencyKey,
      expires_at: input.expiresAt,
    }, signal) as Promise<SignedAuthorityReceipt>;
  }

  async finalizeSubEnvelope(input: FinalizeSubEnvelopeInput, signal: AbortSignal): Promise<void> {
    await this.post("/v1/cost/finalize", {
      reservation_ref: input.reservationRef,
      sub_envelope: input.subEnvelope,
      measured_units: input.measuredUnits,
      idempotency_key: input.idempotencyKey,
    }, signal);
  }

  async closeWorkflowBudget(reservationRef: string, signal: AbortSignal): Promise<void> {
    await this.post("/v1/cost/close", { reservation_ref: reservationRef }, signal);
  }

  async getWorkflowBudgetStatus(reservationRef: string, signal: AbortSignal): Promise<WorkflowBudgetStatus> {
    return this.post("/v1/cost/status", { reservation_ref: reservationRef }, signal) as Promise<WorkflowBudgetStatus>;
  }

  async ready(): Promise<boolean> {
    try {
      const response = await this.fetcher(new URL("/readyz", this.origin), { method: "GET", redirect: "error", signal: AbortSignal.timeout(2_000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async post(path: string, body: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    try {
      const response = await this.fetcher(new URL(path, this.origin), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "x-lens-cost-token": this.workloadToken },
        body: JSON.stringify(body),
        signal: deadlineSignal(signal, Date.now() + 5_000),
      });
      if (response.status === 409) throw new CostAuthorityError("CONFLICT", "Cost authority conflict.");
      if (response.status === 403) throw new CostAuthorityError("OVERSPEND", "Cost authority denied the operation.");
      if (!response.ok) throw new CostAuthorityError("UNAVAILABLE", "Cost authority is unavailable.");
      if (response.headers.get("content-length") === "0") return {};
      const payload = await readBoundedJson(response);
      return payload;
    } catch (error) {
      if (error instanceof CostAuthorityError) throw error;
      if (signal.aborted) throw new CostAuthorityError("UNAVAILABLE", "The request was cancelled.");
      throw new CostAuthorityError("UNAVAILABLE", "Cost authority is unavailable.");
    }
  }
}
