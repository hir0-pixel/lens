import type { SecretStore } from "../secrets/SecretStore";
import type { McpRegistry } from "./McpRegistry";
import { buildListRequest, type McpJsonRpcResponse, type McpToolsListResult } from "./wireProtocol";

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Probes every registered, non-disabled server with a single `tools/list` call. A server that
 * fails to answer has every one of its currently-`approved` tools marked `unavailable` — calls
 * to them then block in the connector before any network attempt (M6 spec §6, "Health"). A
 * server that answers again has its `unavailable` tools (only those — never `drifted` or
 * `disabled`, which need an explicit admin action) restored to `approved`.
 *
 * This function performs one probe pass; scheduling it on an interval is a deployment concern
 * (left to the process that constructs the registry) and outside M6a's tested surface.
 */
export async function probeMcpServerHealth(options: {
  registry: McpRegistry;
  secrets: SecretStore;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<void> {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const servers = await options.registry.listServers();
  for (const server of servers) {
    if (server.disabled) continue;
    let reachable = false;
    try {
      const secret = await options.secrets.get(server.secretRef);
      const response = await fetcher(server.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify(buildListRequest("health-probe")),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        const payload = (await response.json()) as McpJsonRpcResponse<McpToolsListResult>;
        reachable = payload.error === undefined && payload.result !== undefined;
      }
    } catch {
      reachable = false;
    }
    const tools = await options.registry.listAllTools();
    for (const tool of tools) {
      if (tool.serverId !== server.id) continue;
      if (!reachable && tool.state === "approved") {
        await options.registry.setToolState(server.id, tool.toolId, "unavailable");
      } else if (reachable && tool.state === "unavailable") {
        await options.registry.setToolState(server.id, tool.toolId, "approved");
      }
    }
  }
}
