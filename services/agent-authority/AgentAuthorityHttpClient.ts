import { assertInternalOrigin, assertInternalServiceUrl, assertWorkloadToken, deadlineSignal, readBoundedJson, type FetchPort } from "../internal-http/internalHttp";
import { syncInternalPost } from "../internal-http/syncInternalPost";

export class AgentAuthorityError extends Error {
  constructor(readonly code: "FORBIDDEN" | "UNAVAILABLE", message: string) {
    super(message);
  }
}

export interface McpCredentialIssueInput {
  credentialRef: string;
  executionFence: string;
  secretRef: string;
  targetRef: string;
  expiresAt: number;
}

export class AgentAuthorityHttpClient {
  private readonly origin: URL;

  constructor(serviceUrl: string, private readonly workloadToken: string, private readonly fetcher: FetchPort = fetch) {
    this.origin = assertInternalOrigin(serviceUrl, "LENS_AGENT_AUTHORITY_URL");
    assertWorkloadToken(workloadToken, "LENS_AGENT_AUTHORITY_WORKLOAD_TOKEN");
  }

  async issueMcpCredential(input: McpCredentialIssueInput, signal?: AbortSignal): Promise<void> {
    await this.post("/v1/mcp/credentials/issue", {
      credential_ref: input.credentialRef,
      execution_fence: input.executionFence,
      secret_ref: input.secretRef,
      target_ref: input.targetRef,
      expires_at: input.expiresAt,
    }, signal);
  }

  async resolveMcpCredential(credentialRef: string, executionFence: string, signal?: AbortSignal): Promise<string> {
    const payload = await this.post("/v1/mcp/credentials/resolve", {
      credential_ref: credentialRef,
      execution_fence: executionFence,
    }, signal) as Record<string, unknown>;
    if (typeof payload.secret !== "string" || payload.secret.length < 8) {
      throw new AgentAuthorityError("UNAVAILABLE", "Agent authority returned a malformed credential.");
    }
    return payload.secret;
  }

  consumeFence(fenceId: string): boolean {
    try {
      const response = syncInternalPost({
        url: this.origin.href,
        tokenHeader: "x-lens-agent-authority-token",
        token: this.workloadToken,
        path: "/v1/fences/consume",
        body: { fence_id: fenceId },
      });
      if (response.status !== 200) return false;
      return response.body.consumed === true;
    } catch {
      return false;
    }
  }

  async ready(): Promise<boolean> {
    try {
      const response = await this.fetcher(new URL("/readyz", this.origin), { method: "GET", redirect: "error", signal: AbortSignal.timeout(2_000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async post(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const url = assertInternalServiceUrl(new URL(path, this.origin).href, "LENS_AGENT_AUTHORITY_URL");
    try {
      const response = await this.fetcher(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-lens-agent-authority-token": this.workloadToken,
        },
        body: JSON.stringify(body),
        signal: deadlineSignal(signal, Date.now() + 5_000),
      });
      if (response.status === 403) throw new AgentAuthorityError("FORBIDDEN", "Agent authority denied the operation.");
      if (!response.ok) throw new AgentAuthorityError("UNAVAILABLE", "Agent authority is unavailable.");
      if (response.headers.get("content-length") === "0") return {};
      return readBoundedJson(response);
    } catch (error) {
      if (error instanceof AgentAuthorityError) throw error;
      throw new AgentAuthorityError("UNAVAILABLE", "Agent authority is unavailable.");
    }
  }
}
