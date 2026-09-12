import { createHash, randomUUID } from "node:crypto";
import type { Sandbox } from "../tool-execution/ToolExecutionService";
import { canonicalJson } from "../security/canonicalJson";
import { parseMcpServerTargetRef, parseMcpToolAction, type McpRegistry } from "./McpRegistry";
import { computeSchemaDigest } from "./schemaDigest";
import type { McpCredentialResolver } from "./McpCredentialBroker";
import {
  asStringArray,
  buildCallRequest,
  buildListRequest,
  resolveJsonPath,
  type McpJsonRpcResponse,
  type McpToolCallResult,
  type McpToolsListResult,
} from "./wireProtocol";

const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const TRUNCATION_MARKER = "\n[truncated]";

/** Bounded, byte-safe truncation with an explicit marker — mirrors `corpusTool.ts`'s
 * byte-accurate UTF-8 slicing (never split a multi-byte character), but appends a marker so a
 * bounded result is distinguishable from a naturally short one. See M6 spec §6: "Result exceeds
 * maxOutputBytes -> Truncate with a marker, as M3 does. Never split into a second call." */
export function boundContent(content: string, maxOutputBytes: number): string {
  if (Buffer.byteLength(content, "utf8") <= maxOutputBytes) return content;
  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, "utf8");
  const budget = Math.max(0, maxOutputBytes - markerBytes);
  let truncated = Buffer.from(content, "utf8").subarray(0, budget).toString("utf8");
  while (Buffer.byteLength(truncated, "utf8") > budget) truncated = truncated.slice(0, -1);
  return `${truncated}${TRUNCATION_MARKER}`;
}

/** `sha256(canonicalJson(arguments))` — the same canonicalizer every signer/verifier in this
 * repo uses (`services/security/canonicalJson.ts`), which is also what `governanceBinding.ts`'s
 * `normalizedToolIntentDigest` builds its own digest from. M6b closes the M6a gap: `dispatch`
 * previously carried no arguments at all (`Sandbox.dispatch` only threaded `argumentsDigest`).
 * Exported so tests can compute the expected digest independently of the connector. */
export function computeArgumentsDigest(args: Record<string, unknown>): string {
  return `sha256:${createHash("sha256").update(canonicalJson(args)).digest("hex")}`;
}

async function postJsonRpc<T>(fetcher: typeof fetch, endpoint: string, secret: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(`MCP server responded with status ${response.status}.`);
  const payload = (await response.json()) as McpJsonRpcResponse<T>;
  if (payload.error) throw new Error(payload.error.message);
  if (payload.result === undefined) throw new Error("MCP server returned no result.");
  return payload.result;
}

export interface McpHttpConnectorOptions {
  registry: McpRegistry;
  credentials: McpCredentialResolver;
  fetcher?: typeof fetch;
  maxOutputBytes?: number;
  timeoutMs?: number;
}

/**
 * `Sandbox` implementation for MCP HTTP servers (M6 spec §4a/§4b). Every method below runs
 * fail-closed: an unknown server, a disabled/unavailable/drifted tool, a credential resolution
 * failure, a network error, or a schema mismatch all end in a thrown error and no side effect —
 * `ToolExecutionService.execute` turns any throw from `dispatch` into `DEPENDENCY_UNAVAILABLE`.
 *
 * Per call: (1) look up the pinned tool state — unavailable/drifted/disabled block before any
 * network attempt; (2) resolve the credentialRef to a secret, scoped to this dispatch's fence;
 * (3) re-fetch the live tool list and recompute the schema digest — a mismatch blocks the call,
 * transitions the tool to `drifted`, and never reaches step (4); (4) call the tool and bound its
 * output. Steps (3) and (4) are two separate HTTP calls by design: it is how "no request reached
 * the stub's tool handler" is provable when schema drift blocks the call.
 */
export class McpHttpConnector implements Sandbox {
  private readonly registry: McpRegistry;
  private readonly credentials: McpCredentialResolver;
  private readonly fetcher: typeof fetch;
  private readonly maxOutputBytes: number;
  private readonly timeoutMs: number;

  constructor(options: McpHttpConnectorOptions) {
    this.registry = options.registry;
    this.credentials = options.credentials;
    this.fetcher = options.fetcher ?? fetch;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async dispatch(input: {
    targetRef: string;
    action: string;
    credentialRef: string;
    executionFence: string;
    idempotencyKey: string;
    argumentsDigest: string;
    arguments?: Record<string, unknown>;
  }): Promise<{ status: "succeeded" | "unknown"; result?: { content: string; resourceRefs: readonly string[] } }> {
    // M6a gap, closed: when the caller supplies `arguments`, verify it against the digest the
    // fence was bound to BEFORE any network attempt. A mismatch means the exact intent the model
    // was authorized for no longer matches what is about to be sent — that is an integrity
    // failure, not a retryable error. See M6 spec's "M6a gap" note on argument transport.
    if (input.arguments !== undefined && computeArgumentsDigest(input.arguments) !== input.argumentsDigest) {
      throw new Error("MCP tool call arguments do not match the digest the fence was bound to.");
    }

    const serverId = parseMcpServerTargetRef(input.targetRef);
    const toolId = parseMcpToolAction(input.action);

    const server = await this.registry.getServer(serverId);
    if (!server || server.disabled) throw new Error("MCP server is unavailable.");

    // Fail closed on anything but a live, approved pin. No network attempt for unavailable,
    // drifted, or disabled tools, and none for a tool that was never approved.
    const pinned = await this.registry.getTool(serverId, toolId);
    if (!pinned || pinned.state !== "approved") throw new Error("MCP tool is not callable.");

    const secret = await this.credentials.resolve(input.credentialRef, input.executionFence);
    const signal = AbortSignal.timeout(this.timeoutMs);

    const listing = await postJsonRpc<McpToolsListResult>(this.fetcher, server.endpoint, secret, buildListRequest(randomUUID()), signal);
    const live = listing.tools.find((tool) => tool.name === toolId);
    if (!live || computeSchemaDigest(live.inputSchema) !== pinned.schemaDigest) {
      await this.registry.setToolState(serverId, toolId, "drifted");
      throw new Error("MCP tool schema drift detected; the tool has been marked drifted and blocked.");
    }

    const called = await postJsonRpc<McpToolCallResult>(this.fetcher, server.endpoint, secret, buildCallRequest(randomUUID(), toolId, input.arguments ?? {}), signal);
    const content = boundContent(called.content, this.maxOutputBytes);
    const resourceRefs = pinned.provenancePath ? asStringArray(resolveJsonPath(called, pinned.provenancePath)) : [];

    return { status: "succeeded", result: { content, resourceRefs } };
  }
}
