import type { SecretStore } from "../secrets/SecretStore";
import type { AgentAuthorityHttpClient } from "../agent-authority/AgentAuthorityHttpClient";

export interface McpCredentialIssueRecord {
  credentialRef: string;
  executionFence: string;
  secretRef: string;
  targetRef: string;
  expiresAt: number;
}

export interface McpSecretResolver {
  issue(record: McpCredentialIssueRecord): Promise<void>;
  resolve(credentialRef: string, executionFence: string): Promise<string>;
}

/** Dev/test-only in-process resolver — production must use `RemoteMcpSecretResolver`. */
export class LocalMcpSecretResolver implements McpSecretResolver {
  private readonly issued = new Map<string, McpCredentialIssueRecord>();

  constructor(private readonly secrets: SecretStore) {}

  async issue(record: McpCredentialIssueRecord): Promise<void> {
    this.issued.set(record.credentialRef, record);
  }

  async resolve(credentialRef: string, executionFence: string): Promise<string> {
    const entry = this.issued.get(credentialRef);
    if (!entry) throw new Error("Credential is unknown or already used.");
    this.issued.delete(credentialRef);
    if (entry.executionFence !== executionFence) throw new Error("Credential is not bound to this execution fence.");
    if (entry.expiresAt <= Date.now()) throw new Error("Credential has expired.");
    return this.secrets.get(entry.secretRef);
  }
}

export class RemoteMcpSecretResolver implements McpSecretResolver {
  constructor(private readonly client: AgentAuthorityHttpClient) {}

  issue(record: McpCredentialIssueRecord): Promise<void> {
    return this.client.issueMcpCredential(record);
  }

  resolve(credentialRef: string, executionFence: string): Promise<string> {
    return this.client.resolveMcpCredential(credentialRef, executionFence);
  }
}
