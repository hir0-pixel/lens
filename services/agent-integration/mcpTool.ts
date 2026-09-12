import { createHash } from "node:crypto";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core/node";
import { Type, type TSchema } from "typebox";
import { canonicalJson } from "../security/canonicalJson";
import type { ToolCatalogEntry as RuntimeToolCatalogEntry } from "../agent-runtime/AgentRuntime";
import {
  ToolExecutionService,
  type CredentialBroker,
  type Sandbox,
  type ToolCatalogEntry as ExecutionToolCatalogEntry,
} from "../tool-execution/ToolExecutionService";
import { mcpServerTargetRef, mcpToolAction } from "../mcp-registry/McpRegistry";

export type McpResultAuthorizationMode = "tool-gated" | "resource-gated";

/**
 * Everything `createMcpTool` needs for one approved MCP tool. Mirrors what an admin approval
 * (M6a's `McpAdminService.approveTool`) would have pinned: the raw input schema (so a typebox
 * schema can be derived for the harness), its digest (so `AgentRuntime`'s catalog entry carries
 * the same identity the connector re-checks per call), the result-authorization mode (M6 spec
 * §4c), and the admin's risk classification.
 */
export interface McpToolDescriptor {
  toolId: string;
  /** Catalog version. Bumped by an admin re-approval after schema drift; "1" otherwise. */
  version: string;
  serverId: string;
  inputSchema: unknown;
  schemaDigest: `sha256:${string}`;
  resultAuthorization: McpResultAuthorizationMode;
  /** M1 intent-time resource refs for a `resource-gated` tool (the corpus/resource class it
   * operates against). Ignored for `tool-gated`, which always uses the synthetic `tool:` ref. */
  declaredResourceRefs?: readonly string[];
  risk: "read" | "reversible_write" | "high_risk";
  /** `high_risk` forces true regardless of this value. */
  requiresApproval?: boolean;
  label?: string;
  description?: string;
}

export interface McpToolDetails {
  toolId: string;
  resourceRefs: readonly string[];
}

export interface McpToolScope {
  requestId: string;
  subjectRef: string;
}

export interface CreateMcpToolOptions {
  /** Issues the per-call credentialRef; never sees the secret (M6 spec §4a). */
  broker: CredentialBroker;
  /** The MCP HTTP connector (or a stub standing in for it in tests). */
  sandbox: Sandbox;
  scope: McpToolScope;
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function computeArgumentsDigest(args: Record<string, unknown>): `sha256:${string}` {
  return sha256(canonicalJson(args));
}

export function mcpToolResourceRef(toolId: string, version: string): string {
  return `tool:${toolId}@${version}`;
}

/** The `resolveIntent` dispatch-table entry for an approved MCP tool (M6 spec §M6b "Ships").
 * Static per tool — it does not depend on call arguments, exactly like `resolveSearchCorpusIntent`
 * ignores its args too; the model's actual arguments are authorized separately, downstream, via
 * the `argumentsDigest` check in the M6a connector. */
export function resolveMcpToolIntent(descriptor: McpToolDescriptor): { action: string; resourceRefs: readonly string[] } {
  return {
    action: mcpToolAction(descriptor.toolId),
    resourceRefs: descriptor.resultAuthorization === "tool-gated"
      ? [mcpToolResourceRef(descriptor.toolId, descriptor.version)]
      : (descriptor.declaredResourceRefs ?? []),
  };
}

/** `AgentRuntime.ToolCatalogEntry` for the approved tool, registered at the canonical
 * construction site alongside `searchCorpusCatalogEntry` (M6 spec §M6b "Ships"). */
export function mcpRuntimeCatalogEntry(descriptor: McpToolDescriptor): RuntimeToolCatalogEntry {
  const dataFlow = `mcp.tool:${descriptor.toolId}->bounded-content;resourceRefs->details`;
  return Object.freeze({
    toolId: descriptor.toolId,
    version: descriptor.version,
    targetProfileDigest: sha256(mcpServerTargetRef(descriptor.serverId)),
    risk: descriptor.risk,
    requiresApproval: descriptor.risk === "high_risk" ? true : (descriptor.requiresApproval ?? false),
    idempotentReplay: false,
    schemaDigest: descriptor.schemaDigest,
    dataFlowProfileDigest: sha256(dataFlow),
  });
}

function mcpExecutionCatalogEntry(descriptor: McpToolDescriptor): ExecutionToolCatalogEntry {
  return {
    name: descriptor.toolId,
    version: descriptor.version,
    targetRef: mcpServerTargetRef(descriptor.serverId),
    action: mcpToolAction(descriptor.toolId),
    risk: descriptor.risk === "read" ? "read" : "write",
    requiresApproval: descriptor.risk === "high_risk" ? true : (descriptor.requiresApproval ?? false),
    externalCapable: false,
  };
}

/**
 * `AgentHarnessTool` factory per approved MCP catalog entry (M6 spec §M6b "Ships"), mirroring
 * `corpusTool.ts`: bounded output (bounding itself happens in the M6a connector, which is the
 * only thing that ever sees the raw result), `details` carrying `resourceRefs` per the entry's
 * `resultAuthorization` mode, no raw logging.
 *
 * Executes through `ToolExecutionService.execute` -> the connector, never a direct HTTP call.
 * `ToolExecutionService.execute` only ever returns a `ToolState` (never the Sandbox's `result`
 * payload — that shape is unchanged from before M6a), so this wraps the given `Sandbox` in a
 * thin capturing decorator that stashes each dispatch's `result` under its own `idempotencyKey`
 * and reads it back immediately after `execute` resolves. Keys are unique per call
 * (`requestId:toolCallId`), so concurrent calls through a shared `ToolExecutionService` never
 * cross-contaminate results.
 */
export function createMcpTool(
  descriptor: McpToolDescriptor,
  options: CreateMcpToolOptions,
): AgentHarnessTool<undefined, TSchema, McpToolDetails> {
  const captured = new Map<string, { content: string; resourceRefs: readonly string[] } | undefined>();
  const capturingSandbox: Sandbox = {
    async dispatch(input) {
      const outcome = await options.sandbox.dispatch(input);
      captured.set(input.idempotencyKey, outcome.result);
      return outcome;
    },
  };
  const service = new ToolExecutionService([mcpExecutionCatalogEntry(descriptor)], options.broker, capturingSandbox);
  const parameters = Type.Unsafe<Record<string, unknown>>(descriptor.inputSchema as TSchema);

  return {
    name: descriptor.toolId,
    label: descriptor.label ?? descriptor.toolId,
    description: descriptor.description ?? `Call the ${descriptor.toolId} tool.`,
    parameters,
    replay: descriptor.risk === "read" ? "safe" : "never",
    async execute(toolCallId, input) {
      const args = (input ?? {}) as Record<string, unknown>;
      const idempotencyKey = `${options.scope.requestId}:${toolCallId}`;
      const state = await service.execute({
        idempotencyKey,
        subjectRef: options.scope.subjectRef,
        toolName: descriptor.toolId,
        toolVersion: descriptor.version,
        argumentsDigest: computeArgumentsDigest(args),
        executionFence: `mcp-fence:${idempotencyKey}`,
        arguments: args,
      });
      const result = captured.get(idempotencyKey);
      captured.delete(idempotencyKey);
      if (state !== "SUCCEEDED" || !result) throw new Error("MCP tool call did not complete.");
      const resourceRefs = descriptor.resultAuthorization === "tool-gated"
        ? [mcpToolResourceRef(descriptor.toolId, descriptor.version)]
        : result.resourceRefs;
      return {
        content: [{ type: "text", text: result.content }],
        details: { toolId: descriptor.toolId, resourceRefs },
      };
    },
  };
}
