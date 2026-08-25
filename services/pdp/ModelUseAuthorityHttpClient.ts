import type { ModelUseAuthorityPort, AuthorizeGenerateInput, AuthorizeModelUseInput } from "./ModelUseAuthority";
import { ModelUseAuthorityError } from "./ModelUseAuthority";
import type { SignedAuthorityReceipt } from "../security/authorityReceipt";
import { assertInternalOrigin, assertWorkloadToken, deadlineSignal, readBoundedJson, type FetchPort } from "../internal-http/internalHttp";

export class ModelUseAuthorityHttpClient implements ModelUseAuthorityPort {
  private readonly origin: URL;

  constructor(serviceUrl: string, private readonly workloadToken: string, private readonly fetcher: FetchPort = fetch) {
    this.origin = assertInternalOrigin(serviceUrl, "LENS_MODEL_USE_AUTHORITY_URL");
    assertWorkloadToken(workloadToken, "LENS_MODEL_USE_AUTHORITY_WORKLOAD_TOKEN");
  }

  async authorizeGenerate(input: AuthorizeGenerateInput, signal: AbortSignal): Promise<SignedAuthorityReceipt> {
    return this.post("/v1/model-use/authorize-generate", {
      request_id: input.requestId,
      request_digest: input.requestDigest,
      subject_ref: input.subjectRef,
      device_ref: input.deviceRef,
      session_ref: input.sessionRef,
      application_ref: input.applicationRef,
      workspace_ref: input.workspaceRef,
      purpose_ref: input.purposeRef,
      request_class: input.requestClass,
      deadline_at: input.deadlineAt,
    }, signal);
  }

  async authorizeModelUse(input: AuthorizeModelUseInput, signal: AbortSignal): Promise<SignedAuthorityReceipt> {
    return this.post("/v1/model-use/authorize-model-use", {
      request_id: input.requestId,
      turn_id: input.turnId,
      step_id: input.stepId,
      step_class: input.stepClass,
      request_digest: input.requestDigest,
      model_ref: input.modelRef,
      artifact_digest: input.artifactDigest,
      capability: input.capability,
      subject_ref: input.subjectRef,
      application_ref: input.applicationRef,
      workspace_ref: input.workspaceRef,
      purpose_ref: input.purposeRef,
      request_class: input.requestClass,
      deadline_at: input.deadlineAt,
    }, signal);
  }

  async ready(): Promise<boolean> {
    try {
      const response = await this.fetcher(new URL("/readyz", this.origin), { method: "GET", redirect: "error", signal: AbortSignal.timeout(2_000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async post(path: string, body: Record<string, unknown>, signal: AbortSignal): Promise<SignedAuthorityReceipt> {
    try {
      const response = await this.fetcher(new URL(path, this.origin), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "x-lens-authority-token": this.workloadToken },
        body: JSON.stringify(body),
        signal: deadlineSignal(signal, Date.now() + 5_000),
      });
      if (response.status === 403) throw new ModelUseAuthorityError("MODEL_INELIGIBLE", "Model use was denied.");
      if (!response.ok) throw new ModelUseAuthorityError("AUTHORITY_UNAVAILABLE", "Model-use authority is unavailable.");
      const payload = await readBoundedJson(response) as Record<string, unknown>;
      if (typeof payload.token !== "string" || !payload.claims || typeof payload.claims !== "object") {
        throw new ModelUseAuthorityError("AUTHORITY_UNAVAILABLE", "Model-use authority returned a malformed receipt.");
      }
      return payload as unknown as SignedAuthorityReceipt;
    } catch (error) {
      if (error instanceof ModelUseAuthorityError) throw error;
      if (signal.aborted) throw new ModelUseAuthorityError("AUTHORITY_UNAVAILABLE", "The request was cancelled.");
      throw new ModelUseAuthorityError("AUTHORITY_UNAVAILABLE", "Model-use authority is unavailable.");
    }
  }
}
