import { MemorySecretStore } from "../../services/secrets/SecretStore";
import { SqliteMcpRegistry, mcpServerTargetRef, mcpToolAction } from "../../services/mcp-registry/McpRegistry";
import { McpAdminService } from "../../services/mcp-registry/adminService";
import { McpCredentialBroker } from "../../services/mcp-registry/McpCredentialBroker";
import { McpHttpConnector } from "../../services/mcp-registry/McpHttpConnector";
import { StubMcpServer } from "../../tests/helpers/stubMcpServer";

const SECRET_VALUE = "evidence-run-secret-do-not-print-me";
const FENCE = "fence-evidence-1";

async function main() {
  const stub = new StubMcpServer();
  const endpoint = await stub.start();
  const registry = new SqliteMcpRegistry(":memory:");
  const secrets = new MemorySecretStore();
  const admin = new McpAdminService(registry, secrets, fetch);

  const registered = await admin.registerServer({ endpoint, transport: "http", secret: SECRET_VALUE });
  await admin.discoverTools(registered.id);
  await admin.approveTool({ serverId: registered.id, toolId: "echo", resultAuthorization: "tool-gated" });

  const broker = new McpCredentialBroker(registry, secrets);
  const connector = new McpHttpConnector({ registry, credentials: broker });

  console.log("=== EVIDENCE 1: connector call — credentialRef present, secret value absent ===");
  const { credentialRef } = await broker.issue({
    subjectRef: "employee-1",
    targetRef: mcpServerTargetRef(registered.id),
    action: mcpToolAction("echo"),
    executionFence: FENCE,
  });
  const dispatchInput = {
    targetRef: mcpServerTargetRef(registered.id),
    action: mcpToolAction("echo"),
    credentialRef,
    executionFence: FENCE,
    idempotencyKey: "evidence-idem-1",
    argumentsDigest: "sha256:evidence",
  };
  console.log("dispatch input (this is exactly what the orchestrator process holds):");
  console.log(JSON.stringify(dispatchInput, null, 2));
  console.log(`process.env contains secret value: ${JSON.stringify(process.env).includes(SECRET_VALUE)}`);
  console.log(`dispatch input contains secret value: ${JSON.stringify(dispatchInput).includes(SECRET_VALUE)}`);
  const outcome = await connector.dispatch(dispatchInput);
  console.log("dispatch outcome:", JSON.stringify(outcome, null, 2));
  console.log(`MCP server actually received the secret (as a Bearer header, out of band from the orchestrator): ${stub.seenAuthorizations.includes(`Bearer ${SECRET_VALUE}`)}`);

  console.log("");
  console.log("=== EVIDENCE 2: schema drift blocks the call and transitions registry state to 'drifted' ===");
  stub.setSchema("echo", { type: "object", properties: { text: { type: "number" } }, additionalProperties: false });
  const before = await registry.getTool(registered.id, "echo");
  console.log(`tool state before the drifted call: ${before?.state}`);
  const callsBefore = stub.callCount;
  const { credentialRef: driftCred } = await broker.issue({
    subjectRef: "employee-1",
    targetRef: mcpServerTargetRef(registered.id),
    action: mcpToolAction("echo"),
    executionFence: "fence-evidence-2",
  });
  try {
    await connector.dispatch({
      targetRef: mcpServerTargetRef(registered.id),
      action: mcpToolAction("echo"),
      credentialRef: driftCred,
      executionFence: "fence-evidence-2",
      idempotencyKey: "evidence-idem-2",
      argumentsDigest: "sha256:evidence",
    });
    console.log("UNEXPECTED: dispatch did not throw on drift");
  } catch (error) {
    console.log(`dispatch threw as expected: ${(error as Error).message}`);
  }
  const after = await registry.getTool(registered.id, "echo");
  console.log(`tool state after the drifted call: ${after?.state}`);
  console.log(`stub's tools/call handler was invoked during the drifted attempt: ${stub.callCount > callsBefore}`);

  await stub.stop();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
