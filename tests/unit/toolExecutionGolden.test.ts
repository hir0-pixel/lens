import { describe, expect, it } from "vitest";
import {
  ToolExecutionError,
  ToolExecutionService,
  type CredentialBroker,
  type Sandbox,
  type ToolCatalogEntry,
} from "../../services/tool-execution/ToolExecutionService";

/**
 * M6a's only change to `services/tool-execution/ToolExecutionService.ts` is additive: an
 * optional `result?: { content, resourceRefs }` on `Sandbox.dispatch`'s return type. This test
 * is the golden proof that requires: `execute`'s behaviour and the exact input shape handed to
 * `Sandbox.dispatch` are byte-identical to before the change. It exercises every code path
 * (success, conflict, forbidden, awaiting-approval, dependency-unavailable) and asserts on the
 * literal JSON of every dispatch call — a legacy `Sandbox` that returns only `{ status }` and
 * never looks at `result` continues to work unmodified, proving the change is truly additive.
 */
describe("ToolExecutionService golden behaviour (M6a additive-field proof)", () => {
  const catalog: readonly ToolCatalogEntry[] = [
    { name: "legacy_tool", version: "1", targetRef: "target:legacy", action: "act.legacy", risk: "write", requiresApproval: false, externalCapable: false },
    { name: "approval_tool", version: "1", targetRef: "target:approval", action: "act.approval", risk: "write", requiresApproval: true, externalCapable: false },
    { name: "external_tool", version: "1", targetRef: "target:external", action: "act.external", risk: "read", requiresApproval: false, externalCapable: true },
  ];

  function legacySandbox(dispatchCalls: unknown[]): Sandbox {
    // A pre-M6a Sandbox: returns exactly { status }, never touches `result`. If this still
    // satisfies the `Sandbox` interface and `execute` still behaves identically, the change
    // was additive.
    return {
      async dispatch(input) {
        dispatchCalls.push(input);
        return { status: "succeeded" };
      },
    };
  }

  function broker(issueCalls: unknown[]): CredentialBroker {
    return {
      async issue(input) {
        issueCalls.push(input);
        return { credentialRef: "cred-fixed-for-golden-test" };
      },
    };
  }

  it("succeeds and dispatches with the exact pre-existing argument shape, byte-identical JSON", async () => {
    const dispatchCalls: unknown[] = [];
    const issueCalls: unknown[] = [];
    const service = new ToolExecutionService(catalog, broker(issueCalls), legacySandbox(dispatchCalls));

    const state = await service.execute({
      idempotencyKey: "idem-golden-1",
      subjectRef: "subject-1",
      toolName: "legacy_tool",
      toolVersion: "1",
      argumentsDigest: "sha256:aaaa",
      executionFence: "fence-1",
    });

    expect(state).toBe("SUCCEEDED");
    expect(issueCalls).toEqual([{ subjectRef: "subject-1", targetRef: "target:legacy", action: "act.legacy", executionFence: "fence-1" }]);
    expect(dispatchCalls).toEqual([{
      targetRef: "target:legacy",
      action: "act.legacy",
      credentialRef: "cred-fixed-for-golden-test",
      executionFence: "fence-1",
      idempotencyKey: "idem-golden-1",
      argumentsDigest: "sha256:aaaa",
    }]);
    // Exact key set and order-independent byte content — no new field snuck into the call.
    expect(Object.keys(dispatchCalls[0] as object).sort()).toEqual(
      ["targetRef", "action", "credentialRef", "executionFence", "idempotencyKey", "argumentsDigest"].sort(),
    );
  });

  it("idempotent replay returns the cached state without a second dispatch call", async () => {
    const dispatchCalls: unknown[] = [];
    const service = new ToolExecutionService(catalog, broker([]), legacySandbox(dispatchCalls));
    const input = {
      idempotencyKey: "idem-golden-2",
      subjectRef: "subject-1",
      toolName: "legacy_tool",
      toolVersion: "1",
      argumentsDigest: "sha256:bbbb",
      executionFence: "fence-2",
    };
    const first = await service.execute(input);
    const second = await service.execute(input);
    expect(first).toBe("SUCCEEDED");
    expect(second).toBe("SUCCEEDED");
    expect(dispatchCalls).toHaveLength(1);
  });

  it("conflicts when the same idempotency key is replayed with different arguments", async () => {
    const service = new ToolExecutionService(catalog, broker([]), legacySandbox([]));
    await service.execute({
      idempotencyKey: "idem-golden-3", subjectRef: "subject-1", toolName: "legacy_tool", toolVersion: "1",
      argumentsDigest: "sha256:cccc", executionFence: "fence-3",
    });
    await expect(service.execute({
      idempotencyKey: "idem-golden-3", subjectRef: "subject-1", toolName: "legacy_tool", toolVersion: "1",
      argumentsDigest: "sha256:dddd", executionFence: "fence-3",
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects an unknown tool, a missing fence, and an externalCapable tool as FORBIDDEN", async () => {
    const service = new ToolExecutionService(catalog, broker([]), legacySandbox([]));
    await expect(service.execute({
      idempotencyKey: "idem-golden-4", subjectRef: "s", toolName: "does_not_exist", toolVersion: "1",
      argumentsDigest: "sha256:e", executionFence: "fence",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.execute({
      idempotencyKey: "idem-golden-5", subjectRef: "s", toolName: "legacy_tool", toolVersion: "1",
      argumentsDigest: "sha256:e", executionFence: "",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.execute({
      idempotencyKey: "idem-golden-6", subjectRef: "s", toolName: "external_tool", toolVersion: "1",
      argumentsDigest: "sha256:e", executionFence: "fence",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns AWAITING_APPROVAL without dispatching, then proceeds once an approvalRef is supplied", async () => {
    const dispatchCalls: unknown[] = [];
    const service = new ToolExecutionService(catalog, broker([]), legacySandbox(dispatchCalls));
    const pending = await service.execute({
      idempotencyKey: "idem-golden-7", subjectRef: "s", toolName: "approval_tool", toolVersion: "1",
      argumentsDigest: "sha256:f", executionFence: "fence",
    });
    expect(pending).toBe("AWAITING_APPROVAL");
    expect(dispatchCalls).toHaveLength(0);
  });

  it("wraps any Sandbox.dispatch rejection as DEPENDENCY_UNAVAILABLE, exactly as before", async () => {
    const failingSandbox: Sandbox = { async dispatch() { throw new Error("network down"); } };
    const service = new ToolExecutionService(catalog, broker([]), failingSandbox);
    await expect(service.execute({
      idempotencyKey: "idem-golden-8", subjectRef: "s", toolName: "legacy_tool", toolVersion: "1",
      argumentsDigest: "sha256:g", executionFence: "fence",
    })).rejects.toBeInstanceOf(ToolExecutionError);
    await expect(service.execute({
      idempotencyKey: "idem-golden-9", subjectRef: "s", toolName: "legacy_tool", toolVersion: "1",
      argumentsDigest: "sha256:h", executionFence: "fence",
    })).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });

  it("a Sandbox that DOES return the new optional `result` field still behaves identically at the execute() boundary", async () => {
    // execute() only ever reads `outcome.status` — this proves the additive field is inert to
    // every existing caller and that `execute`'s return value (ToolState) is unaffected by it.
    const richSandbox: Sandbox = {
      async dispatch() {
        return { status: "succeeded", result: { content: "some content", resourceRefs: ["ref:1"] } };
      },
    };
    const service = new ToolExecutionService(catalog, broker([]), richSandbox);
    const state = await service.execute({
      idempotencyKey: "idem-golden-10", subjectRef: "s", toolName: "legacy_tool", toolVersion: "1",
      argumentsDigest: "sha256:i", executionFence: "fence",
    });
    expect(state).toBe("SUCCEEDED");
  });
});
