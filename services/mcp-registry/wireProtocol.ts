/**
 * The wire shape spoken between the connector/admin service and an MCP HTTP server. Modelled on
 * MCP's JSON-RPC 2.0 `tools/list` and `tools/call` methods, narrowed to what this module needs:
 * HTTP transport only, one request/response pair per call, no streaming. A single POST to the
 * server's endpoint carries the JSON-RPC envelope.
 */
export interface McpToolDescriptor {
  name: string;
  inputSchema: unknown;
}

export interface McpJsonRpcRequest {
  jsonrpc: "2.0";
  id: string;
  method: "tools/list" | "tools/call";
  params?: { name?: string; arguments?: Record<string, unknown> };
}

export interface McpToolsListResult {
  tools: readonly McpToolDescriptor[];
}

/** `data` carries arbitrary structured output a resource-gated tool can point a provenance
 * JSON path into (e.g. "data.resourceRefs"). Tool-gated tools may omit it entirely. */
export interface McpToolCallResult {
  content: string;
  data?: unknown;
}

export interface McpJsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: string;
  result?: T;
  error?: { code: number; message: string };
}

export function buildListRequest(id: string): McpJsonRpcRequest {
  return { jsonrpc: "2.0", id, method: "tools/list" };
}

export function buildCallRequest(id: string, name: string, args: Record<string, unknown> = {}): McpJsonRpcRequest {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

/** Resolves a dot-separated path ("data.resourceRefs") into a plain object/array structure.
 * Returns undefined if any segment is missing — callers treat that as "no provenance", which
 * is fail-closed by construction (an absent or malformed path yields an empty resourceRefs). */
export function resolveJsonPath(root: unknown, path: string): unknown {
  let cursor: unknown = root;
  for (const segment of path.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

export function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}
