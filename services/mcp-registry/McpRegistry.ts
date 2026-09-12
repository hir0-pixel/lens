import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { type McpDataFlowProfile, validateDataFlowProfile } from "./dataFlowProfile";

/**
 * Sovereignty constraint: HTTP transport only. Spawning a process (stdio) is code execution
 * and belongs in a future `microvm` isolation class (ADR-015-004, Phase 2). Registration must
 * reject anything else — see `assertHttpTransport`.
 */
export type McpTransport = "http";

/**
 * `approved`   — pinned schema matches the live server; callable.
 * `drifted`    — the live schema no longer matches the pinned digest; blocked until re-approval.
 * `unavailable`— the health probe could not reach the server; blocked without a network attempt.
 * `disabled`   — an admin turned the tool (or its server) off.
 */
export type McpToolState = "approved" | "drifted" | "unavailable" | "disabled";

export type ResultAuthorizationMode = "tool-gated" | "resource-gated";

export interface McpServerRecord {
  id: string;
  endpoint: string;
  secretRef: string;
  transport: McpTransport;
  disabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface McpServerWriteInput {
  endpoint: string;
  secretRef: string;
  transport: McpTransport;
}

export interface McpToolRecord {
  serverId: string;
  toolId: string;
  schemaDigest: `sha256:${string}`;
  dataFlowProfile: McpDataFlowProfile;
  resultAuthorization: ResultAuthorizationMode;
  provenancePath?: string;
  state: McpToolState;
  createdAt: number;
  updatedAt: number;
}

export interface McpToolApprovalInput {
  serverId: string;
  toolId: string;
  schemaDigest: `sha256:${string}`;
  dataFlowProfile: McpDataFlowProfile;
  resultAuthorization: ResultAuthorizationMode;
  provenancePath?: string;
}

export class McpRegistryError extends Error {
  constructor(public readonly code: "INVALID_TRANSPORT" | "NOT_FOUND" | "DATA_FLOW_PROFILE_REQUIRED", message: string) {
    super(message);
    this.name = "McpRegistryError";
  }
}

export function assertHttpTransport(transport: string): asserts transport is McpTransport {
  if (transport !== "http") {
    throw new McpRegistryError("INVALID_TRANSPORT", "Only the http transport is accepted. Stdio and other transports are rejected at registration.");
  }
}

export interface McpRegistry {
  createServer(input: McpServerWriteInput): Promise<McpServerRecord>;
  getServer(id: string): Promise<McpServerRecord | undefined>;
  listServers(): Promise<readonly McpServerRecord[]>;
  disableServer(id: string): Promise<McpServerRecord>;

  approveTool(input: McpToolApprovalInput): Promise<McpToolRecord>;
  getTool(serverId: string, toolId: string): Promise<McpToolRecord | undefined>;
  listApprovedToolsForServer(serverId: string): Promise<readonly McpToolRecord[]>;
  listAllTools(): Promise<readonly McpToolRecord[]>;
  setToolState(serverId: string, toolId: string, state: McpToolState): Promise<McpToolRecord>;
}

function serverRowToRecord(row: Record<string, unknown>): McpServerRecord {
  return {
    id: String(row.id),
    endpoint: String(row.endpoint),
    secretRef: String(row.secret_ref),
    transport: row.transport as McpTransport,
    disabled: Number(row.disabled) === 1,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function parseStoredDataFlowProfile(raw: unknown): McpDataFlowProfile {
  if (raw === null || raw === undefined || typeof raw !== "string" || raw.length === 0) {
    throw new McpRegistryError("DATA_FLOW_PROFILE_REQUIRED", "MCP tool dataFlowProfile is required.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new McpRegistryError("DATA_FLOW_PROFILE_REQUIRED", "MCP tool dataFlowProfile is invalid.");
  }
  if (!validateDataFlowProfile(parsed)) {
    throw new McpRegistryError("DATA_FLOW_PROFILE_REQUIRED", "MCP tool dataFlowProfile is invalid.");
  }
  return parsed;
}

function toolRowToRecord(row: Record<string, unknown>): McpToolRecord {
  return {
    serverId: String(row.server_id),
    toolId: String(row.tool_id),
    schemaDigest: String(row.schema_digest) as `sha256:${string}`,
    dataFlowProfile: parseStoredDataFlowProfile(row.data_flow_profile),
    resultAuthorization: row.result_authorization as ResultAuthorizationMode,
    provenancePath: row.provenance_path === null || row.provenance_path === undefined ? undefined : String(row.provenance_path),
    state: row.state as McpToolState,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/** Durable MCP registry. SQLite locally; the schema is intentionally simple enough to carry
 * over to Postgres for multi-replica deployment without a redesign, following the same rule
 * every other durable store in this repo follows (see `SqliteProviderRegistry`). At an
 * estimated 200 tools x ~2 KB, no sharding or cache is warranted at this scale (see M6 spec §2). */
export class SqliteMcpRegistry implements McpRegistry {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      endpoint TEXT NOT NULL,
      secret_ref TEXT NOT NULL,
      transport TEXT NOT NULL,
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS mcp_tools (
      server_id TEXT NOT NULL,
      tool_id TEXT NOT NULL,
      schema_digest TEXT NOT NULL,
      data_flow_profile TEXT NOT NULL,
      result_authorization TEXT NOT NULL,
      provenance_path TEXT,
      state TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (server_id, tool_id)
    )`);
    const columns = new Set(
      (this.db.prepare("PRAGMA table_info(mcp_tools)").all() as Array<Record<string, unknown>>)
        .map((row) => String(row.name)),
    );
    if (!columns.has("data_flow_profile")) {
      // Existing rows receive NULL/empty and fail closed at read time until re-approved.
      this.db.exec("ALTER TABLE mcp_tools ADD COLUMN data_flow_profile TEXT");
    }
  }

  async createServer(input: McpServerWriteInput): Promise<McpServerRecord> {
    assertHttpTransport(input.transport);
    const now = Date.now();
    const id = `mcp_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    this.db.prepare(
      `INSERT INTO mcp_servers (id, endpoint, secret_ref, transport, disabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    ).run(id, input.endpoint, input.secretRef, input.transport, now, now);
    const created = await this.getServer(id);
    if (!created) throw new Error("MCP server persist failed.");
    return created;
  }

  async getServer(id: string): Promise<McpServerRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? serverRowToRecord(row) : undefined;
  }

  async listServers(): Promise<readonly McpServerRecord[]> {
    const rows = this.db.prepare("SELECT * FROM mcp_servers").all() as Record<string, unknown>[];
    return rows.map(serverRowToRecord);
  }

  async disableServer(id: string): Promise<McpServerRecord> {
    const current = await this.getServer(id);
    if (!current) throw new McpRegistryError("NOT_FOUND", "MCP server not found.");
    const now = Date.now();
    this.db.prepare("UPDATE mcp_servers SET disabled = 1, updated_at = ? WHERE id = ?").run(now, id);
    this.db.prepare("UPDATE mcp_tools SET state = 'disabled', updated_at = ? WHERE server_id = ?").run(now, id);
    const updated = await this.getServer(id);
    if (!updated) throw new Error("MCP server persist failed.");
    return updated;
  }

  async approveTool(input: McpToolApprovalInput): Promise<McpToolRecord> {
    if (!validateDataFlowProfile(input.dataFlowProfile)) {
      throw new McpRegistryError("DATA_FLOW_PROFILE_REQUIRED", "MCP tool approval requires a valid dataFlowProfile.");
    }
    const now = Date.now();
    const dataFlowProfileJson = JSON.stringify(input.dataFlowProfile);
    this.db.prepare(
      `INSERT INTO mcp_tools (server_id, tool_id, schema_digest, data_flow_profile, result_authorization, provenance_path, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?)
       ON CONFLICT(server_id, tool_id) DO UPDATE SET
         schema_digest = excluded.schema_digest,
         data_flow_profile = excluded.data_flow_profile,
         result_authorization = excluded.result_authorization,
         provenance_path = excluded.provenance_path,
         state = 'approved',
         updated_at = excluded.updated_at`,
    ).run(input.serverId, input.toolId, input.schemaDigest, dataFlowProfileJson, input.resultAuthorization, input.provenancePath ?? null, now, now);
    const tool = await this.getTool(input.serverId, input.toolId);
    if (!tool) throw new Error("MCP tool persist failed.");
    return tool;
  }

  async getTool(serverId: string, toolId: string): Promise<McpToolRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM mcp_tools WHERE server_id = ? AND tool_id = ?").get(serverId, toolId) as Record<string, unknown> | undefined;
    return row ? toolRowToRecord(row) : undefined;
  }

  async listApprovedToolsForServer(serverId: string): Promise<readonly McpToolRecord[]> {
    const rows = this.db.prepare("SELECT * FROM mcp_tools WHERE server_id = ? AND state = 'approved'").all(serverId) as Record<string, unknown>[];
    return rows.map(toolRowToRecord);
  }

  async listAllTools(): Promise<readonly McpToolRecord[]> {
    const rows = this.db.prepare("SELECT * FROM mcp_tools").all() as Record<string, unknown>[];
    return rows.map(toolRowToRecord);
  }

  async setToolState(serverId: string, toolId: string, state: McpToolState): Promise<McpToolRecord> {
    const current = await this.getTool(serverId, toolId);
    if (!current) throw new McpRegistryError("NOT_FOUND", "MCP tool not found.");
    const now = Date.now();
    this.db.prepare("UPDATE mcp_tools SET state = ?, updated_at = ? WHERE server_id = ? AND tool_id = ?").run(state, now, serverId, toolId);
    const updated = await this.getTool(serverId, toolId);
    if (!updated) throw new Error("MCP tool persist failed.");
    return updated;
  }
}

export function mcpServerTargetRef(serverId: string): string {
  return `mcp:${serverId}`;
}

export function parseMcpServerTargetRef(targetRef: string): string {
  if (!targetRef.startsWith("mcp:")) throw new Error("Not an MCP target ref.");
  return targetRef.slice("mcp:".length);
}

export function mcpToolAction(toolId: string): string {
  return `agent.tool.mcp.${toolId}`;
}

export function parseMcpToolAction(action: string): string {
  const prefix = "agent.tool.mcp.";
  if (!action.startsWith(prefix)) throw new Error("Not an MCP tool action.");
  return action.slice(prefix.length);
}
