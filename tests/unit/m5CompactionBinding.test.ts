import type { AgentHarness } from "@earendil-works/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import {
  bindCompactionDecline,
  declineCompaction,
} from "../../services/agent-integration/compactionBinding";

describe("M5 production compaction binding", () => {
  it("routing.compaction-declined-in-production", () => {
    const unsubscribe = vi.fn();
    const on = vi.fn(() => unsubscribe);
    const harness = {
      hooks: { on },
    } as unknown as Pick<AgentHarness, "hooks">;

    expect(bindCompactionDecline(harness)).toBe(unsubscribe);
    expect(on).toHaveBeenCalledWith("before_compaction", declineCompaction);
    expect(declineCompaction()).toEqual({ decline: true });
  });
});
