export class InferenceError extends Error { constructor(readonly code: "STALE_FENCE" | "CANCELLED") { super(code); } }
export interface RuntimeReceipt { usageEventId: string; reservationId: string; fence: number; generatedTokens: number; terminal: "completed" | "cancelled"; scopeId: string; }
export class InferenceAdapter {
  async execute(input: { reservationId: string; fence: number; scopeId: string; chunks: readonly string[] }, signal: AbortSignal): Promise<{ output: string; receipt: RuntimeReceipt }> {
    if (!input.scopeId || input.fence < 1) throw new InferenceError("STALE_FENCE");
    let output = ""; let generatedTokens = 0;
    for (const chunk of input.chunks) { if (signal.aborted) throw new InferenceError("CANCELLED"); output += chunk; generatedTokens += chunk.trim() ? 1 : 0; }
    return { output, receipt: { usageEventId: `usage:${input.reservationId}:${input.fence}`, reservationId: input.reservationId, fence: input.fence, generatedTokens, terminal: "completed", scopeId: input.scopeId } };
  }
}
