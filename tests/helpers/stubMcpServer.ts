import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { McpJsonRpcRequest, McpJsonRpcResponse, McpToolDescriptor, McpToolCallResult } from "../../services/mcp-registry/wireProtocol";

const PLAIN_TOOL: McpToolDescriptor = {
  name: "echo",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, additionalProperties: false },
};

const RESOURCE_TOOL: McpToolDescriptor = {
  name: "lookup_ticket",
  inputSchema: { type: "object", properties: { ticketId: { type: "string" } }, additionalProperties: false },
};

export const STUB_PROVENANCE_PATH = "data.resourceRefs";

/**
 * A minimal HTTP MCP server for M6a's tests (M6 spec §M6a "Ships": "a stub MCP server ... that
 * serves two tools ... and can be told to change a schema mid-test"). Serves two tools:
 *   - `echo` — plain text content, no provenance.
 *   - `lookup_ticket` — content plus `data.resourceRefs`, the declared provenance JSON path.
 * `setSchema` lets a test mutate `echo`'s live inputSchema so the connector's next call
 * observes drift. `callCount`/`listCount` let a test prove a blocked call never reached the
 * tool handler. `down()`/`up()` simulate the server being unreachable.
 */
export class StubMcpServer {
  private server: Server | undefined;
  private tools: McpToolDescriptor[] = [PLAIN_TOOL, RESOURCE_TOOL];
  private unreachable = false;
  private oversizedEcho = false;
  private _listCount = 0;
  private _callCount = 0;
  private authorizationsSeen: string[] = [];
  private _lastCallArguments: Record<string, unknown> | undefined;

  get listCount(): number {
    return this._listCount;
  }

  get callCount(): number {
    return this._callCount;
  }

  get seenAuthorizations(): readonly string[] {
    return this.authorizationsSeen;
  }

  /** The `arguments` object of the most recent `tools/call` request — lets a test prove the
   * connector forwarded the caller's arguments to the server intact (M6b's argument transport). */
  get lastCallArguments(): Record<string, unknown> | undefined {
    return this._lastCallArguments;
  }

  setSchema(toolName: string, inputSchema: unknown): void {
    this.tools = this.tools.map((tool) => (tool.name === toolName ? { ...tool, inputSchema } : tool));
  }

  setOversizedEcho(enabled: boolean): void {
    this.oversizedEcho = enabled;
  }

  down(): void {
    this.unreachable = true;
  }

  up(): void {
    this.unreachable = false;
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      if (this.unreachable) {
        req.destroy();
        return;
      }
      const auth = req.headers.authorization;
      if (typeof auth === "string") this.authorizationsSeen.push(auth);
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const rpc = JSON.parse(body) as McpJsonRpcRequest;
          if (rpc.method === "tools/list") {
            this._listCount += 1;
            const response: McpJsonRpcResponse<{ tools: readonly McpToolDescriptor[] }> = {
              jsonrpc: "2.0",
              id: rpc.id,
              result: { tools: this.tools },
            };
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify(response));
            return;
          }
          if (rpc.method === "tools/call") {
            this._callCount += 1;
            this._lastCallArguments = rpc.params?.arguments;
            const name = rpc.params?.name;
            let result: McpToolCallResult;
            if (name === "echo") {
              result = { content: this.oversizedEcho ? "x".repeat(1024 * 1024) : "hello from the stub" };
            } else if (name === "lookup_ticket") {
              result = { content: "ticket TCK-1 found", data: { resourceRefs: ["doc:ticket-1", "doc:ticket-2"] } };
            } else {
              const response: McpJsonRpcResponse<never> = { jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Unknown tool." } };
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify(response));
              return;
            }
            const response: McpJsonRpcResponse<McpToolCallResult> = { jsonrpc: "2.0", id: rpc.id, result };
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify(response));
            return;
          }
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Unknown method." } }));
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: "unknown", error: { code: -32700, message: "Parse error." } }));
        }
      });
    });
    await new Promise<void>((resolvePromise) => this.server!.listen(0, "127.0.0.1", resolvePromise));
    const address = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolvePromise, reject) => this.server!.close((error) => (error ? reject(error) : resolvePromise())));
  }
}
