import type { ChatRequest, ContextManifest, AgentRun } from "./types";

/** Deterministic, internal-only inference stand-in for M04 integration tests. */
export class FakeInferenceAdapter {
  constructor(private readonly chunks: readonly string[]) {}

  async *generate(
    _input: { request: ChatRequest; context: ContextManifest; run: AgentRun; budgetRef: string },
    signal: AbortSignal,
  ): AsyncIterable<string> {
    for (const chunk of this.chunks) {
      if (signal.aborted) throw new Error("cancelled");
      yield chunk;
    }
  }
}
