import { createHash } from "node:crypto";
import type { Hooks } from "@earendil-works/pi-agent-core/node";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { PolicyDecisionPoint } from "../pdp/PolicyDecisionPoint";
import type { CorpusToolDetails } from "./corpusToolContract";
import type { ToolGovernanceScope } from "./governanceBinding";

export const CONTEXT_BLOCK_SYSTEM_PROMPT = "lens:context-authorization-blocked";
export const CONTEXT_BLOCK_REASON = "Not permitted";

export type ContextPolicyPort = Pick<PolicyDecisionPoint, "decideBatch">;

export interface ContextFilteredEvent {
  event: "context_filtered";
  total: number;
  kept: number;
  dropped: number;
}

export interface ContextBindingLogPort {
  emit(event: ContextFilteredEvent): void;
}

export interface ContextBindingOptions {
  pdp: ContextPolicyPort;
  scope: ToolGovernanceScope;
  log: ContextBindingLogPort;
}

function resourceRefs(message: AgentMessage): readonly string[] | undefined {
  if (message.role !== "toolResult") return undefined;
  const details = message.details as Partial<CorpusToolDetails> | undefined;
  if (!Array.isArray(details?.resourceRefs) || details.resourceRefs.length === 0) return [];
  return details.resourceRefs.every((ref): ref is string => typeof ref === "string" && ref.length > 0)
    ? details.resourceRefs
    : [];
}

export function bindContextAuthorization(
  harness: { hooks: Hooks },
  options: ContextBindingOptions,
): () => void {
  const stopTransform = harness.hooks.on("transform_context", (event) => {
    const toolResults = event.messages.filter((message) => message.role === "toolResult");
    const refsByMessage = new Map(toolResults.map((message) => [message, resourceRefs(message) ?? []]));
    const union = [...new Set([...refsByMessage.values()].flat())];

    try {
      const allowed = union.length === 0
        ? new Set<string>()
        : new Set(options.pdp.decideBatch({
            ...options.scope,
            action: "agent.context.use",
            resourceRefs: union,
            normalizedContextDigest: `sha256:${createHash("sha256").update(JSON.stringify(union)).digest("hex")}`,
            useBoundary: "generation_start",
          }).allowed);
      const messages = event.messages.filter((message) => {
        if (message.role !== "toolResult") return true;
        const refs = refsByMessage.get(message) ?? [];
        return refs.length > 0 && refs.every((ref) => allowed.has(ref));
      });
      options.log.emit({
        event: "context_filtered",
        total: toolResults.length,
        kept: messages.filter((message) => message.role === "toolResult").length,
        dropped: event.messages.length - messages.length,
      });
      return { messages };
    } catch {
      try {
        options.log.emit({ event: "context_filtered", total: toolResults.length, kept: 0, dropped: toolResults.length });
      } catch {
        // Failure remains closed when observability is unavailable.
      }
      return { messages: [], systemPrompt: CONTEXT_BLOCK_SYSTEM_PROMPT };
    }
  });

  return () => {
    stopTransform();
  };
}
