import { describe, expect, it } from "vitest";
import { ToolExecutionError, ToolExecutionService } from "../../services/tool-execution/ToolExecutionService";
const tool = { name: "directory", version: "v1", targetRef: "directory-api", action: "lookup", risk: "read" as const, requiresApproval: false, externalCapable: false };
const service = (status: "succeeded" | "unknown" = "succeeded") => new ToolExecutionService([tool], { issue: async () => ({ credentialRef: "lease" }) }, { dispatch: async () => ({ status }) });
const input = { idempotencyKey: "key-1", subjectRef: "subject", toolName: "directory", toolVersion: "v1", argumentsDigest: "sha256:args", executionFence: "fence" };
describe("M09 tool execution", () => {
  it("uses only catalog targets through a scoped broker and sandbox", async () => expect(service().execute(input)).resolves.toBe("SUCCEEDED"));
  it("binds idempotency to the exact intent and preserves unknown outcomes", async () => { const execution = service("unknown"); await expect(execution.execute(input)).resolves.toBe("OUTCOME_UNKNOWN"); await expect(execution.execute({ ...input, argumentsDigest: "sha256:changed" })).rejects.toBeInstanceOf(ToolExecutionError); });
  it("requires approval for catalog writes and denies external-capable targets", async () => { const approval = new ToolExecutionService([{ ...tool, risk: "write", requiresApproval: true }], { issue: async () => ({ credentialRef: "lease" }) }, { dispatch: async () => ({ status: "succeeded" as const }) }); await expect(approval.execute(input)).resolves.toBe("AWAITING_APPROVAL"); const external = new ToolExecutionService([{ ...tool, externalCapable: true }], { issue: async () => ({ credentialRef: "lease" }) }, { dispatch: async () => ({ status: "succeeded" as const }) }); await expect(external.execute(input)).rejects.toMatchObject<Partial<ToolExecutionError>>({ code: "FORBIDDEN" }); });
});
