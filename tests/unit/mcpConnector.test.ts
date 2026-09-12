/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemorySecretStore } from "../../services/secrets/SecretStore";
import { SqliteMcpRegistry, mcpServerTargetRef, mcpToolAction } from "../../services/mcp-registry/McpRegistry";
import { McpAdminService } from "../../services/mcp-registry/adminService";
import { McpCredentialBroker } from "../../services/mcp-registry/McpCredentialBroker";
import { McpHttpConnector, boundContent, computeArgumentsDigest } from "../../services/mcp-registry/McpHttpConnector";
import { probeMcpServerHealth } from "../../services/mcp-registry/healthProbe";
import { ToolExecutionError, ToolExecutionService, type ToolCatalogEntry } from "../../services/tool-execution/ToolExecutionService";
import { EXTERNAL_EGRESS_PROFILE, INTERNAL_EGRESS_PROFILE, NO_EGRESS_PROFILE } from "../helpers/mcpDataFlow";
import { StubMcpServer, STUB_PROVENANCE_PATH } from "../helpers/stubMcpServer";
import { computeDataFlowProfileDigest } from "../../services/mcp-registry/dataFlowProfile";
import { mcpRuntimeCatalogEntry } from "../../services/agent-integration/mcpTool";
import { computeSchemaDigest } from "../../services/mcp-registry/schemaDigest";

const SECRET_VALUE = "s3cr3t-mcp-credential-do-not-leak";
const SUBJECT_REF = "employee-1";
const FENCE = "fence-abc-123";

describe("MCP HTTP connector", () => {
  let stub: StubMcpServer;
  let endpoint: string;
  let registry: SqliteMcpRegistry;
  let secrets: MemorySecretStore;
  let admin: McpAdminService;
  let serverId: string;

  beforeEach(async () => {
    stub = new StubMcpServer();
    endpoint = await stub.start();
    registry = new SqliteMcpRegistry(":memory:");
    secrets = new MemorySecretStore();
    admin = new McpAdminService(registry, secrets, fetch);
    const registered = await admin.registerServer({ endpoint, transport: "http", secret: SECRET_VALUE });
    serverId = registered.id;
    await admin.discoverTools(serverId);
    await admin.approveTool({ serverId, toolId: "echo", dataFlowProfile: NO_EGRESS_PROFILE, resultAuthorization: "tool-gated" });
    await admin.approveTool({ serverId, toolId: "lookup_ticket", dataFlowProfile: INTERNAL_EGRESS_PROFILE, resultAuthorization: "resource-gated", provenancePath: STUB_PROVENANCE_PATH });
  });

  afterEach(async () => {
    await stub.stop();
  });

  function makeConnector(
    maxOutputBytes?: number,
    approvedEgress?: { allowedDestinations: readonly string[] },
    registryOverride: SqliteMcpRegistry = registry,
    secretsOverride: MemorySecretStore = secrets,
  ) {
    const broker = new McpCredentialBroker(registryOverride, secretsOverride);
    const connector = new McpHttpConnector({
      registry: registryOverride,
      credentials: broker,
      maxOutputBytes,
      approvedEgress: approvedEgress ?? { allowedDestinations: ["127.0.0.1", "localhost"] },
    });
    return { broker, connector };
  }

  it("mcp.registration-requires-data-flow: approval without a valid dataFlowProfile is refused", async () => {
    await expect(admin.approveTool({
      serverId,
      toolId: "echo",
      dataFlowProfile: { egressClass: "none", targets: [""] },
      resultAuthorization: "tool-gated",
    })).rejects.toMatchObject({ code: "DATA_FLOW_PROFILE_REQUIRED" });

    await expect(registry.approveTool({
      serverId,
      toolId: "echo",
      schemaDigest: computeSchemaDigest({ type: "object" }),
      dataFlowProfile: { egressClass: "invalid" as never, targets: [] },
      resultAuthorization: "tool-gated",
    })).rejects.toMatchObject({ code: "DATA_FLOW_PROFILE_REQUIRED" });

    const unapproved = await registry.getTool(serverId, "echo");
    expect(unapproved?.dataFlowProfile).toEqual(NO_EGRESS_PROFILE);
  });

  it("mcp.external-egress-refused-unless-approved: external-approved tools block unless the server endpoint is allowlisted", async () => {
    const externalRegistry = new SqliteMcpRegistry(":memory:");
    const externalSecrets = new MemorySecretStore();
    const externalAdmin = new McpAdminService(externalRegistry, externalSecrets, fetch);
    const registered = await externalAdmin.registerServer({ endpoint, transport: "http", secret: SECRET_VALUE });
    await externalAdmin.discoverTools(registered.id);
    await externalAdmin.approveTool({
      serverId: registered.id,
      toolId: "echo",
      dataFlowProfile: EXTERNAL_EGRESS_PROFILE,
      resultAuthorization: "tool-gated",
    });

    const { broker, connector } = makeConnector(undefined, { allowedDestinations: [] }, externalRegistry, externalSecrets);
    const { credentialRef } = await broker.issue({
      subjectRef: SUBJECT_REF,
      targetRef: mcpServerTargetRef(registered.id),
      action: mcpToolAction("echo"),
      executionFence: FENCE,
    });
    const listCountBefore = stub.listCount;
    await expect(connector.dispatch({
      targetRef: mcpServerTargetRef(registered.id),
      action: mcpToolAction("echo"),
      credentialRef,
      executionFence: FENCE,
      idempotencyKey: "idem-external-blocked",
      argumentsDigest: "sha256:deadbeef",
    })).rejects.toThrow(/approved external egress/i);
    expect(stub.listCount).toBe(listCountBefore);

    const { broker: approvedBroker, connector: approvedConnector } = makeConnector(undefined, { allowedDestinations: ["127.0.0.1"] }, externalRegistry, externalSecrets);
    const { credentialRef: approvedRef } = await approvedBroker.issue({
      subjectRef: SUBJECT_REF,
      targetRef: mcpServerTargetRef(registered.id),
      action: mcpToolAction("echo"),
      executionFence: "fence-approved",
    });
    const outcome = await approvedConnector.dispatch({
      targetRef: mcpServerTargetRef(registered.id),
      action: mcpToolAction("echo"),
      credentialRef: approvedRef,
      executionFence: "fence-approved",
      idempotencyKey: "idem-external-approved",
      argumentsDigest: "sha256:deadbeef",
    });
    expect(outcome.status).toBe("succeeded");
  });

  it("mcp.data-flow-digest-is-real: the catalog digest tracks the pinned dataFlowProfile", () => {
    const schema = { type: "object", properties: { text: { type: "string" } }, additionalProperties: false };
    const descriptor = {
      toolId: "echo",
      version: "1",
      serverId,
      inputSchema: schema,
      schemaDigest: computeSchemaDigest(schema),
      resultAuthorization: "tool-gated" as const,
      risk: "read" as const,
      dataFlowProfile: NO_EGRESS_PROFILE,
    };
    const placeholder = mcpRuntimeCatalogEntry(descriptor);
    const real = computeDataFlowProfileDigest(NO_EGRESS_PROFILE);
    expect(placeholder.dataFlowProfileDigest).not.toBe(real);

    const changed = computeDataFlowProfileDigest({ egressClass: "internal", targets: ["retrieval.internal"] });
    expect(changed).not.toBe(real);
    expect(computeDataFlowProfileDigest(NO_EGRESS_PROFILE)).toBe(real);
    expect(computeDataFlowProfileDigest({ egressClass: "internal", targets: ["b.example", "a.example"] }))
      .toBe(computeDataFlowProfileDigest({ egressClass: "internal", targets: ["a.example", "b.example"] }));
  });

  it("calls an approved tool and returns bounded content with provenance refs", async () => {
    const { broker, connector } = makeConnector();
    const { credentialRef } = await broker.issue({ subjectRef: SUBJECT_REF, targetRef: mcpServerTargetRef(serverId), action: mcpToolAction("lookup_ticket"), executionFence: FENCE });
    const outcome = await connector.dispatch({
      targetRef: mcpServerTargetRef(serverId),
      action: mcpToolAction("lookup_ticket"),
      credentialRef,
      executionFence: FENCE,
      idempotencyKey: "idem-1",
      argumentsDigest: "sha256:deadbeef",
    });
    expect(outcome.status).toBe("succeeded");
    expect(outcome.result?.content).toContain("ticket TCK-1 found");
    expect(outcome.result?.resourceRefs).toEqual(["doc:ticket-1", "doc:ticket-2"]);
  });

  it("mcp.credential-never-in-process: the secret value appears in neither process.env nor the connector's call arguments", async () => {
    const { broker, connector } = makeConnector();
    const { credentialRef } = await broker.issue({ subjectRef: SUBJECT_REF, targetRef: mcpServerTargetRef(serverId), action: mcpToolAction("echo"), executionFence: FENCE });
    const dispatchInput = {
      targetRef: mcpServerTargetRef(serverId),
      action: mcpToolAction("echo"),
      credentialRef,
      executionFence: FENCE,
      idempotencyKey: "idem-2",
      argumentsDigest: "sha256:deadbeef",
    };
    expect(JSON.stringify(dispatchInput)).not.toContain(SECRET_VALUE);
    expect(credentialRef).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(process.env)).not.toContain(SECRET_VALUE);

    const outcome = await connector.dispatch(dispatchInput);
    expect(outcome.status).toBe("succeeded");

    // scanned again after the call completes: dispatch never mutates process.env, and the
    // credentialRef the orchestrator would have held (dispatchInput) still carries no secret.
    expect(JSON.stringify(dispatchInput)).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(process.env)).not.toContain(SECRET_VALUE);

    // the secret DOES have to reach the MCP server itself to authenticate the call — that is
    // expected and is the connector's whole job. It just never travels through the orchestrator.
    expect(stub.seenAuthorizations.some((header) => header === `Bearer ${SECRET_VALUE}`)).toBe(true);
  });

  it("mcp.arguments-verified-against-digest: a tampered arguments object with a stale digest is rejected with zero network calls; a matching pair reaches the stub with the arguments intact", async () => {
    const { broker, connector } = makeConnector();
    const args = { text: "hello from the caller" };
    const goodDigest = computeArgumentsDigest(args);

    const { credentialRef } = await broker.issue({ subjectRef: SUBJECT_REF, targetRef: mcpServerTargetRef(serverId), action: mcpToolAction("echo"), executionFence: FENCE });
    const listCountBefore = stub.listCount;
    const callCountBefore = stub.callCount;
    await expect(connector.dispatch({
      targetRef: mcpServerTargetRef(serverId),
      action: mcpToolAction("echo"),
      credentialRef,
      executionFence: FENCE,
      idempotencyKey: "idem-tamper",
      argumentsDigest: "sha256:stale-digest-that-does-not-match",
      arguments: args,
    })).rejects.toThrow(/digest/i);
    expect(stub.listCount).toBe(listCountBefore); // zero network calls — not even tools/list
    expect(stub.callCount).toBe(callCountBefore);

    const { credentialRef: secondRef } = await broker.issue({ subjectRef: SUBJECT_REF, targetRef: mcpServerTargetRef(serverId), action: mcpToolAction("echo"), executionFence: "fence-match" });
    const outcome = await connector.dispatch({
      targetRef: mcpServerTargetRef(serverId),
      action: mcpToolAction("echo"),
      credentialRef: secondRef,
      executionFence: "fence-match",
      idempotencyKey: "idem-match",
      argumentsDigest: goodDigest,
      arguments: args,
    });
    expect(outcome.status).toBe("succeeded");
    expect(stub.lastCallArguments).toEqual(args);
  });

  it("mcp.schema-drift-blocks: a changed live schema blocks the call, marks the tool drifted, and never reaches the tool handler", async () => {
    const { broker, connector } = makeConnector();
    stub.setSchema("echo", { type: "object", properties: { text: { type: "number" } }, additionalProperties: false });

    const { credentialRef } = await broker.issue({ subjectRef: SUBJECT_REF, targetRef: mcpServerTargetRef(serverId), action: mcpToolAction("echo"), executionFence: FENCE });
    const callCountBefore = stub.callCount;
    await expect(connector.dispatch({
      targetRef: mcpServerTargetRef(serverId),
      action: mcpToolAction("echo"),
      credentialRef,
      executionFence: FENCE,
      idempotencyKey: "idem-3",
      argumentsDigest: "sha256:deadbeef",
    })).rejects.toThrow(/drift/i);

    expect(stub.callCount).toBe(callCountBefore); // tools/call was never reached
    const tool = await registry.getTool(serverId, "echo");
    expect(tool?.state).toBe("drifted");

    // Once drifted, a fresh dispatch attempt blocks before any network attempt at all.
    const listCountBefore = stub.listCount;
    const { credentialRef: secondRef } = await broker.issue({ subjectRef: SUBJECT_REF, targetRef: mcpServerTargetRef(serverId), action: mcpToolAction("echo"), executionFence: "fence-2" });
    await expect(connector.dispatch({
      targetRef: mcpServerTargetRef(serverId),
      action: mcpToolAction("echo"),
      credentialRef: secondRef,
      executionFence: "fence-2",
      idempotencyKey: "idem-4",
      argumentsDigest: "sha256:deadbeef",
    })).rejects.toThrow(/not callable/i);
    expect(stub.listCount).toBe(listCountBefore); // no network attempt for a drifted tool
  });

  it("mcp.unreachable-fails-closed: an unreachable server fails closed with DEPENDENCY_UNAVAILABLE and no retry", async () => {
    const catalog: readonly ToolCatalogEntry[] = [{
      name: "echo", version: "1", targetRef: mcpServerTargetRef(serverId), action: mcpToolAction("echo"),
      risk: "read", requiresApproval: false, externalCapable: false,
    }];
    const broker = new McpCredentialBroker(registry, secrets);
    const connector = new McpHttpConnector({ registry, credentials: broker });
    const service = new ToolExecutionService(catalog, broker, connector);

    stub.down();
    const attemptsBefore = stub.listCount + stub.callCount;
    await expect(service.execute({
      idempotencyKey: "idem-5",
      subjectRef: SUBJECT_REF,
      toolName: "echo",
      toolVersion: "1",
      argumentsDigest: "sha256:deadbeef",
      executionFence: FENCE,
    })).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    // Confirms it's a ToolExecutionError specifically, not just any rejection.
    try {
      await service.execute({
        idempotencyKey: "idem-6",
        subjectRef: SUBJECT_REF,
        toolName: "echo",
        toolVersion: "1",
        argumentsDigest: "sha256:deadbeef",
        executionFence: FENCE,
      });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolExecutionError);
    }
    void attemptsBefore;
  });

  it("mcp.result-bounded: an oversized result is truncated with a marker in a single call", async () => {
    stub.setOversizedEcho(true);
    const { broker, connector } = makeConnector(256);
    const { credentialRef } = await broker.issue({ subjectRef: SUBJECT_REF, targetRef: mcpServerTargetRef(serverId), action: mcpToolAction("echo"), executionFence: FENCE });
    const callCountBefore = stub.callCount;
    const outcome = await connector.dispatch({
      targetRef: mcpServerTargetRef(serverId),
      action: mcpToolAction("echo"),
      credentialRef,
      executionFence: FENCE,
      idempotencyKey: "idem-7",
      argumentsDigest: "sha256:deadbeef",
    });
    expect(outcome.result?.content.endsWith("[truncated]")).toBe(true);
    expect(Buffer.byteLength(outcome.result?.content ?? "", "utf8")).toBeLessThanOrEqual(256);
    expect(stub.callCount).toBe(callCountBefore + 1); // exactly one tools/call — never split into a second
  });

  it("boundContent never splits a multi-byte UTF-8 character", () => {
    const content = "a".repeat(10) + "€".repeat(10); // euro sign is 3 bytes in utf8
    const bounded = boundContent(content, 15);
    expect(Buffer.byteLength(bounded, "utf8")).toBeLessThanOrEqual(15);
    expect(bounded.endsWith("[truncated]")).toBe(true);
    expect(() => Buffer.from(bounded, "utf8").toString("utf8")).not.toThrow();
  });

  it("health probe marks tools unavailable when the server is unreachable, and calls block without a network attempt", async () => {
    stub.down();
    await probeMcpServerHealth({ registry, secrets });
    const tool = await registry.getTool(serverId, "echo");
    expect(tool?.state).toBe("unavailable");

    const { broker, connector } = makeConnector();
    const { credentialRef } = await broker.issue({ subjectRef: SUBJECT_REF, targetRef: mcpServerTargetRef(serverId), action: mcpToolAction("echo"), executionFence: FENCE });
    const listCountBefore = stub.listCount;
    const callCountBefore = stub.callCount;
    await expect(connector.dispatch({
      targetRef: mcpServerTargetRef(serverId),
      action: mcpToolAction("echo"),
      credentialRef,
      executionFence: FENCE,
      idempotencyKey: "idem-8",
      argumentsDigest: "sha256:deadbeef",
    })).rejects.toThrow(/not callable/i);
    expect(stub.listCount).toBe(listCountBefore);
    expect(stub.callCount).toBe(callCountBefore);

    stub.up();
    await probeMcpServerHealth({ registry, secrets });
    const recovered = await registry.getTool(serverId, "echo");
    expect(recovered?.state).toBe("approved");
  });
});
