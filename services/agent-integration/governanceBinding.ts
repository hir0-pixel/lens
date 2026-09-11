import { createHash } from "node:crypto";
import type {
  AgentHarnessTool,
  HookInvocation,
  Hooks,
} from "@earendil-works/pi-agent-core/node";
import type { JsonValue } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { PolicyDecisionPoint } from "../pdp/PolicyDecisionPoint";

const POLICY_BLOCK_REASON = "Not permitted";
const echoSchema = Type.Object({
  resourceRef: Type.String(),
  value: Type.String(),
});

export type ToolPolicyPort = Pick<
  PolicyDecisionPoint,
  "decideBatch" | "consumeFence"
>;

export interface ToolGovernanceScope {
  requestId: string;
  callerWorkloadRef: string;
  subjectRef: string;
  deviceRef: string;
  deadlineAt: number;
}

export interface ToolIntent {
  action: string;
  resourceRefs: readonly string[];
}

export interface ToolOutcome {
  runId: string;
  lane: string;
  toolCallId: string;
  toolName: string;
  isError: boolean;
}

interface ToolGovernanceLogBase {
  runId: string;
  toolCallId: string;
  toolName: string;
}

export type ToolGovernanceLogEvent = ToolGovernanceLogBase & (
  | { event: "decision_requested" | "fence_consumed" }
  | { event: "tool_blocked"; reason: typeof POLICY_BLOCK_REASON }
  | { event: "tool_completed"; isError: boolean }
);

export interface ToolGovernanceLogPort {
  emit(event: ToolGovernanceLogEvent): void;
}

export interface ToolGovernanceOptions {
  pdp: ToolPolicyPort;
  scope: ToolGovernanceScope;
  resolveIntent(event: HookInvocation<"before_tool">): ToolIntent;
  log: ToolGovernanceLogPort;
  recordOutcome(outcome: ToolOutcome): void | Promise<void>;
  now?: () => number;
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite JSON number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`
  ).join(",")}}`;
}

export function normalizedToolIntentDigest(
  toolName: string,
  args: Record<string, JsonValue>,
): `sha256:${string}` {
  const intent = canonicalJson({ toolName, args });
  return `sha256:${createHash("sha256").update(intent).digest("hex")}`;
}

export function bindToolGovernance(
  harness: { hooks: Hooks },
  options: ToolGovernanceOptions,
): () => void {
  const now = options.now ?? Date.now;
  const stopBeforeTool = harness.hooks.on("before_tool", (event) => {
    const metadata = {
      runId: event.runId,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
    };
    const emit = (logEvent: ToolGovernanceLogEvent) => {
      try {
        options.log.emit(logEvent);
        return true;
      } catch {
        return false;
      }
    };
    const block = () => {
      emit({ event: "tool_blocked", ...metadata, reason: POLICY_BLOCK_REASON });
      return { block: { reason: POLICY_BLOCK_REASON } } as const;
    };

    try {
      if (!emit({ event: "decision_requested", ...metadata })) return block();
      const intent = options.resolveIntent(event);
      const normalizedContextDigest = normalizedToolIntentDigest(event.toolName, event.args);
      if (now() >= options.scope.deadlineAt) return block();

      const decision = options.pdp.decideBatch({
        ...options.scope,
        action: intent.action,
        resourceRefs: intent.resourceRefs,
        normalizedContextDigest,
        useBoundary: "tool_boundary",
      });
      const fullyAllowed = decision.fence !== undefined
        && decision.allowed.length === intent.resourceRefs.length
        && decision.allowed.every((resourceRef, index) => resourceRef === intent.resourceRefs[index]);
      if (!fullyAllowed || now() >= options.scope.deadlineAt) {
        return block();
      }

      options.pdp.consumeFence(decision.fence!, {
        requestId: options.scope.requestId,
        callerWorkloadRef: options.scope.callerWorkloadRef,
        action: intent.action,
        resourceRefs: intent.resourceRefs,
        normalizedContextDigest,
        useBoundary: "tool_boundary",
      });
      if (!emit({ event: "fence_consumed", ...metadata })) return block();
      if (now() >= options.scope.deadlineAt) return block();
      return undefined;
    } catch {
      return block();
    }
  });

  const stopAfterTool = harness.hooks.on("after_tool", async (event) => {
    try {
      options.log.emit({
        event: "tool_completed",
        runId: event.runId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
      });
    } catch {
      // Outcome recording remains mandatory even when observability is unavailable.
    }
    await options.recordOutcome({
      runId: event.runId,
      lane: event.lane,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      isError: event.isError,
    });
    return undefined;
  });

  return () => {
    stopAfterTool();
    stopBeforeTool();
  };
}

export function createEchoTool(
  onExecute?: (input: { resourceRef: string; value: string }) => void | Promise<void>,
): AgentHarnessTool<undefined, typeof echoSchema> {
  return {
    name: "echo",
    label: "echo",
    description: "Return the supplied test input.",
    parameters: echoSchema,
    async execute(_toolCallId, input) {
      await onExecute?.(input);
      return {
        content: [{ type: "text", text: JSON.stringify(input) }],
        details: undefined,
      };
    },
  };
}
