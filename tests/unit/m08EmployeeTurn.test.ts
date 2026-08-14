import { describe, expect, it } from "vitest";
import { canResolveCitation, presentTurn, verifyRelease } from "../../src/features/employee-chat/turnState";
const digest = `sha256:${"a".repeat(64)}` as const;
describe("M08 employee turn safety", () => {
  it("never presents protected output before a completed or degraded turn", () => { for (const state of ["submitting", "accepted", "authorizing", "retrieving", "queued", "generating_internal", "finalizing", "denied", "cancelled", "failed_retryable", "failed_terminal", "authorization_changed"] as const) expect(presentTurn(state).showOutput).toBe(false); expect(presentTurn("authorization_changed").hideContent).toBe(true); });
  it("accepts output only under the exact current release envelope", () => { expect(verifyRelease({ schemaVersion: 1, turnId: "turn-1", outputDigest: digest, expiresAt: 2_000 }, "turn-1", digest, 1_000)).toBe(true); expect(verifyRelease({ schemaVersion: 1, turnId: "turn-1", outputDigest: digest, expiresAt: 2_000 }, "turn-2", digest, 1_000)).toBe(false); });
  it("permits citations only after final output", () => { const citation = { resourceRef: "r1", versionRef: "v1", chunkRef: "c1", anchor: "page:1" }; expect(canResolveCitation("completed", citation)).toBe(true); expect(canResolveCitation("authorization_changed", citation)).toBe(false); });
});
