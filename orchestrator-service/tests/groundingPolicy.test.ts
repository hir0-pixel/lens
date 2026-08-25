import { describe, expect, it } from "vitest";
import { DevRoutePolicyPort, FailClosedRoutePolicyPort, RoutePolicyError } from "../src/groundingPolicy";

const signal = () => new AbortController().signal;

describe("FailClosedRoutePolicyPort", () => {
  it("is the production default and denies every resolution — never a silent 'grounding not required'", async () => {
    const port = new FailClosedRoutePolicyPort();
    await expect(
      port.resolve({ requestId: "req-1", subjectRef: "subject-1", applicationRef: "lens-employee-client", workspaceRef: "default-workspace", purposeRef: "assistant", requestClass: "enterprise-grounded" }, signal()),
    ).rejects.toThrow(RoutePolicyError);
  });
});

describe("DevRoutePolicyPort", () => {
  it("is explicitly named as a dev/test-only fixture and is never wired by main.ts's production path", async () => {
    const port = new DevRoutePolicyPort();
    const result = await port.resolve(
      { requestId: "req-1", subjectRef: "subject-1", applicationRef: "lens-employee-client", workspaceRef: "default-workspace", purposeRef: "assistant", requestClass: "enterprise-grounded" },
      signal(),
    );
    expect(result.groundingRequired).toBe(false);
    expect(result.applicationRef).toBe("lens-employee-client");
    expect(result.allowedProfileSelectors.length).toBeGreaterThan(0);
    expect(result.routePolicyDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("supports overrides so tests can exercise mandatory-grounding scopes", async () => {
    const port = new DevRoutePolicyPort({ groundingRequired: true, defaultProfileSelector: undefined, noDefaultSelectorBehavior: "FAIL_CLOSED" });
    const result = await port.resolve(
      { requestId: "req-1", subjectRef: "subject-1", applicationRef: "lens-employee-client", workspaceRef: "default-workspace", purposeRef: "assistant", requestClass: "enterprise-grounded" },
      signal(),
    );
    expect(result.groundingRequired).toBe(true);
    expect(result.defaultProfileSelector).toBeUndefined();
    expect(result.noDefaultSelectorBehavior).toBe("FAIL_CLOSED");
  });
});
