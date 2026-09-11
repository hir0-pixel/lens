import type { AgentHarness } from "@earendil-works/pi-agent-core";

export const declineCompaction = () => ({ decline: true } as const);

export const bindCompactionDecline = (
  harness: Pick<AgentHarness, "hooks">,
) => harness.hooks.on("before_compaction", declineCompaction);
