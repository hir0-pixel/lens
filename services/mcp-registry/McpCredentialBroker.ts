import { randomUUID } from "node:crypto";
import type { CredentialBroker } from "../tool-execution/ToolExecutionService";
import type { SecretStore } from "../secrets/SecretStore";
import { parseMcpServerTargetRef, type McpRegistry } from "./McpRegistry";

const DEFAULT_TTL_MS = 30_000;

/** Narrower than `CredentialBroker` on purpose: only the connector holds this, and only the
 * connector may turn a `credentialRef` back into a secret value. Nothing in the orchestrator
 * process ever sees this interface. */
export interface McpCredentialResolver {
  resolve(credentialRef: string, executionFence: string): Promise<string>;
}

interface IssuedCredential {
  secretRef: string;
  targetRef: string;
  executionFence: string;
  subjectRef: string;
  expiresAt: number;
}

/**
 * Issues a `credentialRef` bound to the execution fence (Doc 014's design; see M6 spec §4a).
 * The orchestrator process holds only the ref returned by `issue`. `resolve` — the secret
 * value never crosses back through the `CredentialBroker` interface, so nothing that only
 * has a `CredentialBroker` reference can ever retrieve a secret; only the connector, which
 * is constructed with the `McpCredentialResolver` view of the same instance, can.
 *
 * Single-use and fence-bound: a `credentialRef` resolves at most once and only under the
 * fence it was issued for. That is deliberately stricter than the current
 * `ToolExecutionService`, which does not thread a signal/deadline into `Sandbox.dispatch` —
 * binding to the fence here means a captured `credentialRef` cannot be replayed against a
 * later, unrelated execution even though the interface doesn't force that.
 */
export class McpCredentialBroker implements CredentialBroker, McpCredentialResolver {
  private readonly issued = new Map<string, IssuedCredential>();

  constructor(
    private readonly registry: McpRegistry,
    private readonly secrets: SecretStore,
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async issue(input: { subjectRef: string; targetRef: string; action: string; executionFence: string }): Promise<{ credentialRef: string }> {
    const serverId = parseMcpServerTargetRef(input.targetRef);
    const server = await this.registry.getServer(serverId);
    if (!server || server.disabled) throw new Error("MCP server is unavailable.");
    const credentialRef = `mcpcred_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    this.issued.set(credentialRef, {
      secretRef: server.secretRef,
      targetRef: input.targetRef,
      executionFence: input.executionFence,
      subjectRef: input.subjectRef,
      expiresAt: this.now() + this.ttlMs,
    });
    return { credentialRef };
  }

  /** Resolves a credentialRef to the live secret value. Internal to the connector only — see
   * the class doc. Single-use: a second resolve of the same ref always fails closed. */
  async resolve(credentialRef: string, executionFence: string): Promise<string> {
    const entry = this.issued.get(credentialRef);
    if (!entry) throw new Error("Credential is unknown or already used.");
    this.issued.delete(credentialRef);
    if (entry.executionFence !== executionFence) throw new Error("Credential is not bound to this execution fence.");
    if (entry.expiresAt <= this.now()) throw new Error("Credential has expired.");
    return this.secrets.get(entry.secretRef);
  }
}
