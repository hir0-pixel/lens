import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createMcpServersRouter } from "../src/routes/mcpServers";
import { __resetConfig } from "../src/config";
import { MemorySecretStore } from "../../services/secrets/SecretStore";
import { SqliteMcpRegistry } from "../../services/mcp-registry/McpRegistry";
import { McpAdminService } from "../../services/mcp-registry/adminService";
import { StubMcpServer } from "../../tests/helpers/stubMcpServer";

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "s".repeat(48);
process.env.ADMIN_SUBJECTS = "admin";

function fakeAuth(session: "none" | "user" | "admin") {
  return { getTrustedSession: async () => (session === "none" ? { authenticated: false } : { authenticated: true, subject: session }) } as never;
}

function harness(session: "none" | "user" | "admin", fetcher: typeof fetch) {
  const secrets = new MemorySecretStore();
  const registry = new SqliteMcpRegistry(":memory:");
  const admin = new McpAdminService(registry, secrets, fetcher);
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(createMcpServersRouter({ auth: fakeAuth(session), admin }));
  return { client: request(app), registry, secrets };
}

describe("mcp admin routes", () => {
  let stub: StubMcpServer;
  let endpoint: string;

  beforeEach(async () => {
    __resetConfig();
    stub = new StubMcpServer();
    endpoint = await stub.start();
  });

  it("mcp.admin-only: unauthenticated and non-admin registration are refused", async () => {
    const anon = await harness("none", fetch).client.post("/admin/mcp-servers").send({ endpoint, transport: "http", secret: "s".repeat(20) });
    expect(anon.status).toBe(401);

    const nonAdmin = await harness("user", fetch).client.post("/admin/mcp-servers").send({ endpoint, transport: "http", secret: "s".repeat(20) });
    expect(nonAdmin.status).toBe(403);

    await stub.stop();
  });

  it("mcp.http-only: a stdio or unknown transport is rejected at registration", async () => {
    const { client } = harness("admin", fetch);
    const stdio = await client.post("/admin/mcp-servers").send({ endpoint, transport: "stdio", secret: "s".repeat(20) });
    expect(stdio.status).toBe(400);
    expect(stdio.body.error).toBe("INVALID_TRANSPORT");

    const unknown = await client.post("/admin/mcp-servers").send({ endpoint, transport: "websocket", secret: "s".repeat(20) });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe("INVALID_TRANSPORT");

    const ok = await client.post("/admin/mcp-servers").send({ endpoint, transport: "http", secret: "s".repeat(20) });
    expect(ok.status).toBe(201);

    await stub.stop();
  });

  it("mcp.no-secret-in-responses: registration, discovery, and approval never echo the endpoint or secret_ref", async () => {
    const { client, registry } = harness("admin", fetch);
    const secretValue = "top-secret-mcp-credential-value";
    const registered = await client.post("/admin/mcp-servers").send({ endpoint, transport: "http", secret: secretValue });
    expect(registered.status).toBe(201);
    expect(registered.body).toEqual({ id: expect.stringMatching(/^mcp_/), state: "registered" });
    expect(JSON.stringify(registered.body)).not.toContain(endpoint);
    expect(JSON.stringify(registered.body)).not.toContain(secretValue);

    const stored = await registry.getServer(registered.body.id);
    expect(stored?.secretRef).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain(secretValue);

    const discovered = await client.post(`/admin/mcp-servers/${registered.body.id}/discover`).send();
    expect(discovered.status).toBe(200);
    expect(discovered.body.tools.map((tool: { toolId: string }) => tool.toolId).sort()).toEqual(["echo", "lookup_ticket"]);
    expect(JSON.stringify(discovered.body)).not.toContain(endpoint);
    expect(JSON.stringify(discovered.body)).not.toContain(secretValue);
    expect(JSON.stringify(discovered.body)).not.toContain(stored?.secretRef);

    const approved = await client.post(`/admin/mcp-servers/${registered.body.id}/tools/echo/approve`).send({ resultAuthorization: "tool-gated" });
    expect(approved.status).toBe(201);
    expect(approved.body.state).toBe("approved");
    expect(JSON.stringify(approved.body)).not.toContain(endpoint);
    expect(JSON.stringify(approved.body)).not.toContain(secretValue);
    expect(JSON.stringify(approved.body)).not.toContain(stored?.secretRef);

    await stub.stop();
  });

  it("mcp.unapproved-tool-absent: a discovered-but-unapproved tool is not in the catalog", async () => {
    const { client, registry } = harness("admin", fetch);
    const registered = await client.post("/admin/mcp-servers").send({ endpoint, transport: "http", secret: "s".repeat(20) });
    // discover both tools, approve only one
    await client.post(`/admin/mcp-servers/${registered.body.id}/discover`).send();
    await client.post(`/admin/mcp-servers/${registered.body.id}/tools/echo/approve`).send({ resultAuthorization: "tool-gated" });

    const approvedTools = await registry.listApprovedToolsForServer(registered.body.id);
    expect(approvedTools.map((tool) => tool.toolId)).toEqual(["echo"]);

    const unapproved = await registry.getTool(registered.body.id, "lookup_ticket");
    expect(unapproved).toBeUndefined();

    await stub.stop();
  });
});
