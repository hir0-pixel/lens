import { USAGE_SCHEMA_VERSION, measureOutputUnits } from "./localMeter";

export class InferenceError extends Error { constructor(readonly code: "STALE_FENCE" | "CANCELLED" | "DEPENDENCY_UNAVAILABLE") { super(code); } }

export class InferenceAdapter {
  async execute(input: {
    reservationId: string;
    fence: number;
    scopeId: string;
    chunks: readonly string[];
    requestId?: string;
    turnId?: string;
    stepId?: string;
    artifactDigest?: string;
    endpointGeneration?: string;
  }, signal: AbortSignal): Promise<{ output: string; receipt: import("../model-gateway/ModelGateway").RuntimeReceipt }> {
    let output = "";
    for await (const chunk of this.stream(input, signal)) output += chunk;
    if (!input.requestId || !input.turnId || !input.stepId || !input.artifactDigest || !input.endpointGeneration) {
      throw new InferenceError("STALE_FENCE");
    }
    return {
      output,
      receipt: {
        schemaVersion: USAGE_SCHEMA_VERSION,
        reservationId: input.reservationId,
        requestId: input.requestId,
        turnId: input.turnId,
        stepId: input.stepId,
        fence: input.fence,
        artifactDigest: input.artifactDigest,
        endpointGeneration: input.endpointGeneration,
        usageEventId: `usage:${input.reservationId}:${input.fence}`,
        measuredUnits: measureOutputUnits(output),
        terminal: "completed",
      },
    };
  }

  async *stream(input: { reservationId: string; fence: number; scopeId: string; chunks: readonly string[] }, signal: AbortSignal): AsyncGenerator<string> {
    if (!input.scopeId || input.fence < 1) throw new InferenceError("STALE_FENCE");
    for (const chunk of input.chunks) {
      if (signal.aborted) throw new InferenceError("CANCELLED");
      yield chunk;
    }
  }
}
