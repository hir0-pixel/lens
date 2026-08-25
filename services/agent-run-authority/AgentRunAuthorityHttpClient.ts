import {
  AgentRunAuthorityError,
  type AgentRunAuthorityPort,
  type AgentRunStatus,
  type BeginAgentRunInput,
  type ReserveAgentStepInput,
} from "./AgentRunAuthority";
import type { SignedAuthorityReceipt } from "../security/authorityReceipt";
import type { ClaimStore } from "../security/replayClaimStore";
import { assertInternalOrigin, assertWorkloadToken, deadlineSignal, readBoundedJson, type FetchPort } from "../internal-http/internalHttp";

export class AgentRunAuthorityHttpClient implements AgentRunAuthorityPort, ClaimStore {
  private readonly origin: URL;

  constructor(serviceUrl: string, private readonly workloadToken: string, private readonly fetcher: FetchPort = fetch) {
    this.origin = assertInternalOrigin(serviceUrl, "LENS_AGENT_RUN_AUTHORITY_URL");
    assertWorkloadToken(workloadToken, "LENS_AGENT_RUN_AUTHORITY_WORKLOAD_TOKEN");
  }

  async beginAgentRun(input: BeginAgentRunInput, signal: AbortSignal): Promise<{ runId: string; envelopeRevision: number }> {
    const payload = await this.post("/v1/agent-runs/begin", {
      request_id: input.requestId,
      turn_id: input.turnId,
      run_id: input.runId,
      workflow_reservation_ref: input.workflowReservationRef,
      workflow_profile_digest: input.workflowProfileDigest,
      idempotency_key: input.idempotencyKey,
      expires_at: input.expiresAt,
    }, signal) as Record<string, unknown>;
    if (typeof payload.run_id !== "string" || typeof payload.envelope_revision !== "number") {
      throw new AgentRunAuthorityError("UNAVAILABLE", "Agent-run authority returned a malformed run.");
    }
    return { runId: payload.run_id, envelopeRevision: payload.envelope_revision };
  }

  async reserveAgentStep(input: ReserveAgentStepInput, signal: AbortSignal): Promise<SignedAuthorityReceipt> {
    return this.post("/v1/agent-runs/steps/reserve", {
      run_id: input.runId,
      request_id: input.requestId,
      turn_id: input.turnId,
      step_id: input.stepId,
      step_class: input.stepClass,
      step_index: input.stepIndex,
      model_ref: input.modelRef,
      artifact_digest: input.artifactDigest,
      capability: input.capability,
      workflow_reservation_ref: input.workflowReservationRef,
      sub_envelope: input.subEnvelope,
      model_authorization_digest: input.modelAuthorizationDigest,
      idempotency_key: input.idempotencyKey,
      deadline_at: input.deadlineAt,
    }, signal) as Promise<SignedAuthorityReceipt>;
  }

  async consumeAgentStep(runId: string, stepId: string, receiptId: string, signal: AbortSignal): Promise<void> {
    await this.post("/v1/agent-runs/steps/consume", { run_id: runId, step_id: stepId, receipt_id: receiptId }, signal);
  }

  async finalizeAgentStep(runId: string, stepId: string, signal: AbortSignal): Promise<void> {
    await this.post("/v1/agent-runs/steps/finalize", { run_id: runId, step_id: stepId }, signal);
  }

  async closeAgentRun(runId: string, signal: AbortSignal): Promise<void> {
    await this.post("/v1/agent-runs/close", { run_id: runId }, signal);
  }

  async getAgentRunStatus(runId: string, signal: AbortSignal): Promise<AgentRunStatus> {
    return this.post("/v1/agent-runs/status", { run_id: runId }, signal) as Promise<AgentRunStatus>;
  }

  async claim(kind: string, claimId: string, requestId: string, now: number): Promise<boolean> {
    const payload = await this.post("/v1/claims", { kind, claim_id: claimId, request_id: requestId, now }, new AbortController().signal) as { claimed?: boolean };
    return payload.claimed === true;
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
        headers: { "content-type": "application/json", accept: "application/json", "x-lens-agent-run-token": this.workloadToken },
        body: JSON.stringify(body),
        signal: deadlineSignal(signal, Date.now() + 5_000),
      });
      if (response.status === 409) throw new AgentRunAuthorityError("CONFLICT", "Agent-run authority conflict.");
      if (response.status === 403) throw new AgentRunAuthorityError("FORBIDDEN", "Agent-run authority denied the operation.");
      if (!response.ok) throw new AgentRunAuthorityError("UNAVAILABLE", "Agent-run authority is unavailable.");
      const payload = await readBoundedJson(response);
      return payload;
    } catch (error) {
      if (error instanceof AgentRunAuthorityError) throw error;
      if (signal.aborted) throw new AgentRunAuthorityError("UNAVAILABLE", "The request was cancelled.");
      throw new AgentRunAuthorityError("UNAVAILABLE", "Agent-run authority is unavailable.");
    }
  }
}
