import { randomUUID } from "node:crypto";
import type { CredentialBroker } from "../tool-execution/ToolExecutionService";
import type { McpRegistry } from "./McpRegistry";
import { parseMcpServerTargetRef } from "./McpRegistry";
import type { McpSecretResolver } from "./McpSecretResolver";
import { LocalMcpSecretResolver } from "./McpSecretResolver";
import type { SecretStore } from "../secrets/SecretStore";

const DEFAULT_TTL_MS = 30_000;

/** Narrower than `CredentialBroker` on purpose: only the connector holds this, and only the
 * connector may turn a `credentialRef` back into a secret value. Nothing in the orchestrator
 * process ever sees this interface. */
export interface McpCredentialResolver {
  resolve(credentialRef: string, executionFence: string): Promise<string>;
}

function isSecretStore(value: SecretStore | McpSecretResolver): value is SecretStore {
  return !("issue" in value);
}

/**
 * Issues a `credentialRef` bound to the execution fence (Doc 014's design; see M6 spec §4a).
 * The orchestrator process holds only the ref returned by `issue`. Production wiring passes an
 * HTTP-backed resolver; unit tests pass a local `SecretStore`.
 */
export class McpCredentialBroker implements CredentialBroker, McpCredentialResolver {
  private readonly secretResolver: McpSecretResolver;

  constructor(
    private readonly registry: McpRegistry,
    secretsOrResolver: SecretStore | McpSecretResolver,
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.secretResolver = isSecretStore(secretsOrResolver)
      ? new LocalMcpSecretResolver(secretsOrResolver)
      : secretsOrResolver;
  }

  async issue(input: { subjectRef: string; targetRef: string; action: string; executionFence: string }): Promise<{ credentialRef: string }> {
    const serverId = parseMcpServerTargetRef(input.targetRef);
    const server = await this.registry.getServer(serverId);
    if (!server || server.disabled) throw new Error("MCP server is unavailable.");
    const credentialRef = `mcpcred_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const expiresAt = this.now() + this.ttlMs;
    await this.secretResolver.issue({
      credentialRef,
      secretRef: server.secretRef,
      targetRef: input.targetRef,
      executionFence: input.executionFence,
      expiresAt,
    });
    return { credentialRef };
  }

  async resolve(credentialRef: string, executionFence: string): Promise<string> {
    return this.secretResolver.resolve(credentialRef, executionFence);
  }
}
