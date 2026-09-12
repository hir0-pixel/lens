import { randomUUID } from "node:crypto";
import type { SecretStore } from "../secrets/SecretStore";
import { assertSecretRef } from "../secrets/SecretStore";
import {
  assertHttpTransport,
  McpRegistryError,
  type McpRegistry,
  type McpServerRecord,
  type McpToolRecord,
  type McpToolState,
  type ResultAuthorizationMode,
} from "./McpRegistry";
import { computeSchemaDigest } from "./schemaDigest";
import { buildListRequest, type McpJsonRpcResponse, type McpToolDescriptor, type McpToolsListResult } from "./wireProtocol";

export class McpAdminError extends Error {
  constructor(public readonly code: "INVALID_ARGUMENT" | "INVALID_TRANSPORT" | "NOT_FOUND" | "TOOL_NOT_DISCOVERED" | "DEPENDENCY_UNAVAILABLE", message: string) {
    super(message);
    this.name = "McpAdminError";
  }
}

export interface RegisterServerInput {
  endpoint: string;
  transport: string;
  secret: string;
}

export interface ApproveToolInput {
  serverId: string;
  toolId: string;
  resultAuthorization: ResultAuthorizationMode;
  provenancePath?: string;
}

/**
 * Admin-only surface backing `POST /api/admin/mcp-servers` and the approval routes (M6 spec
 * §M6a). Every method here returns only what the route is allowed to hand back to an admin's
 * browser: `{ id, state }` shapes, discovered tool names and digests — never `endpoint`, never
 * `secretRef`, never a raw schema large enough to be mistaken for one. Discovery never persists
 * anything; only `approveTool` writes a catalog row, which is what makes "unapproved tools do
 * not exist as far as the agent is concerned" true by construction (M6 spec §1).
 */
export class McpAdminService {
  constructor(
    private readonly registry: McpRegistry,
    private readonly secrets: SecretStore,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async registerServer(input: RegisterServerInput): Promise<{ id: string; state: "registered" }> {
    if (!input.secret || input.secret.length < 8) throw new McpAdminError("INVALID_ARGUMENT", "MCP server credential is invalid.");
    let endpointUrl: URL;
    try {
      endpointUrl = new URL(input.endpoint);
    } catch {
      throw new McpAdminError("INVALID_ARGUMENT", "MCP server endpoint must be an absolute URL.");
    }
    if (endpointUrl.protocol !== "http:" && endpointUrl.protocol !== "https:") {
      throw new McpAdminError("INVALID_ARGUMENT", "MCP server endpoint must be http(s).");
    }
    try {
      assertHttpTransport(input.transport);
    } catch (error) {
      if (error instanceof McpRegistryError) throw new McpAdminError("INVALID_TRANSPORT", error.message);
      throw error;
    }
    const secretRef = `mcps_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    assertSecretRef(secretRef);
    await this.secrets.put(secretRef, input.secret);
    const record = await this.registry.createServer({ endpoint: input.endpoint, secretRef, transport: "http" });
    return { id: record.id, state: "registered" };
  }

  /** Lists the server's live tools with a freshly computed digest. Nothing is persisted — this
   * is what the admin looks at before deciding what to approve. */
  async discoverTools(serverId: string): Promise<readonly { toolId: string; schemaDigest: `sha256:${string}` }[]> {
    const server = await this.registry.getServer(serverId);
    if (!server) throw new McpAdminError("NOT_FOUND", "MCP server not found.");
    const tools = await this.listLiveTools(server);
    return tools.map((tool) => ({ toolId: tool.name, schemaDigest: computeSchemaDigest(tool.inputSchema) }));
  }

  async approveTool(input: ApproveToolInput): Promise<{ id: string; state: McpToolState }> {
    const server = await this.registry.getServer(input.serverId);
    if (!server) throw new McpAdminError("NOT_FOUND", "MCP server not found.");
    const tools = await this.listLiveTools(server);
    const tool = tools.find((candidate) => candidate.name === input.toolId);
    if (!tool) throw new McpAdminError("TOOL_NOT_DISCOVERED", "Tool was not found on discovery; it cannot be approved.");
    const record: McpToolRecord = await this.registry.approveTool({
      serverId: input.serverId,
      toolId: input.toolId,
      schemaDigest: computeSchemaDigest(tool.inputSchema),
      resultAuthorization: input.resultAuthorization,
      provenancePath: input.provenancePath,
    });
    return { id: `${record.serverId}:${record.toolId}`, state: record.state };
  }

  async disableServer(serverId: string): Promise<{ id: string; state: "disabled" }> {
    const record: McpServerRecord = await this.registry.disableServer(serverId);
    return { id: record.id, state: "disabled" };
  }

  private async listLiveTools(server: McpServerRecord): Promise<readonly McpToolDescriptor[]> {
    try {
      const secret = await this.secrets.get(server.secretRef);
      const response = await this.fetcher(server.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify(buildListRequest(randomUUID())),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const payload = (await response.json()) as McpJsonRpcResponse<McpToolsListResult>;
      if (payload.error || !payload.result) throw new Error(payload.error?.message ?? "no result");
      return payload.result.tools;
    } catch {
      throw new McpAdminError("DEPENDENCY_UNAVAILABLE", "MCP server is unreachable.");
    }
  }
}
