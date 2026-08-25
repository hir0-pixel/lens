import type { ConfidenceBucket, ConversationTurnRecord, RouteOutput, RouterReasonCode } from "./router";

const DEFAULT_MAX_TURNS = 12;
const DEFAULT_MAX_BYTES = 16 * 1024;

/**
 * Structured terminal lineage for a finalized turn (Doc 004 §23 step 4 / item 4).
 * Every field a durable audit trail needs, named — never concatenated into an opaque
 * string. This shape deliberately mirrors `RouteOverrideAuditFields` (the structured
 * fields recorded on the Authority `route_override` admission — see `service.ts`) field
 * for field, so the durable turn and Audit records can be cross-checked by name, not by
 * parsing prose. Every field is present on every finalized turn, not only overridden
 * ones: `enforcementOverride: false` with `attemptedRoute === effectiveRoute` is itself
 * a checkable, positive statement that no override occurred.
 */
export interface TerminalEvidence {
  releaseFence: string;
  releaseAuditReceipt: string;
  outputCommitProof: string;
  attemptedRoute: RouteOutput;
  attemptedReasonCode: RouterReasonCode;
  attemptedConfidenceBucket: ConfidenceBucket;
  attemptedProfileSelector?: string;
  effectiveRoute: RouteOutput;
  effectiveProfileSelector?: string;
  groundingRequired: boolean;
  routePolicyRevision: number;
  routePolicyDigest: `sha256:${string}`;
  allowedProfileSetDigest: `sha256:${string}`;
  enforcementOverride: boolean;
  /** Required exactly when enforcementOverride is true; absent otherwise. */
  overrideReason?: string;
  /** CompanyRagProfile provenance for the corpus/mode resolveContext used (see service.ts's resolveContext) -- absent on routes that never call resolveContext. */
  ragProfileVersion?: number;
  ragProfileDigest?: `sha256:${string}`;
  resolvedCorpusRef?: string;
  resolvedMode?: string;
}

export interface ConversationHistoryPort {
  /** Returns only turns owned by exactly this stable subject/conversation pair. */
  get(
    input: { requestId: string; subjectRef: string; sessionRef: string; deviceRef: string; conversationRef: string; queryDigest: `sha256:${string}`; limit: number; memorySessionAssertion?: string },
    signal: AbortSignal,
  ): Promise<readonly ConversationTurnRecord[]>;
  beginTurn(input: { requestId: string; subjectRef: string; sessionRef: string; deviceRef: string; conversationRef: string; turnId: string; inputDigest: `sha256:${string}`; inputText: string; memorySessionAssertion?: string }, signal: AbortSignal): Promise<{ turnId: string; sequence: number }>;
  finalizeTurn(input: { requestId: string; subjectRef: string; sessionRef: string; deviceRef: string; conversationRef: string; turnId: string; inputDigest: `sha256:${string}`; output: string; outputDigest: `sha256:${string}`; terminalEvidence: TerminalEvidence; memorySessionAssertion?: string }, signal: AbortSignal): Promise<void>;
  append(
    input: { subjectRef: string; sessionRef: string; conversationRef: string; turn: ConversationTurnRecord },
    signal: AbortSignal,
  ): Promise<void>;
}

/**
 * Bounded development/test adapter keyed by stable subject+conversation.
 * The current session/device is request evidence, not ownership.
 */
export class InMemoryConversationHistory implements ConversationHistoryPort {
  private readonly byKey = new Map<string, ConversationTurnRecord[]>();
  private readonly turns = new Map<string, { inputDigest: string; inputText: string; finalized: boolean }>();

  constructor(
    private readonly maxTurns: number = DEFAULT_MAX_TURNS,
    private readonly maxBytes: number = DEFAULT_MAX_BYTES,
  ) {}

  private key(subjectRef: string, conversationRef: string): string {
    return [subjectRef, conversationRef].join("\\u0000");
  }

  async get(
    input: { requestId: string; subjectRef: string; sessionRef: string; deviceRef: string; conversationRef: string; queryDigest: `sha256:${string}`; limit: number },
  ): Promise<readonly ConversationTurnRecord[]> {
    const turns = this.byKey.get(this.key(input.subjectRef, input.conversationRef)) ?? [];
    const limit = Math.max(0, Math.min(input.limit, this.maxTurns));
    return turns.slice(-limit);
  }

  async beginTurn(input: { requestId: string; subjectRef: string; sessionRef: string; deviceRef: string; conversationRef: string; turnId: string; inputDigest: `sha256:${string}`; inputText: string }): Promise<{ turnId: string; sequence: number }> {
    const existing = this.turns.get(input.requestId);
    if (existing && existing.inputDigest !== input.inputDigest) throw new Error("MEMORY_BEGIN_CONFLICT");
    if (existing) return { turnId: input.turnId, sequence: 1 };
    this.turns.set(input.requestId, { inputDigest: input.inputDigest, inputText: input.inputText, finalized: false });
    return { turnId: input.turnId, sequence: 1 };
  }

  async finalizeTurn(input: { requestId: string; subjectRef: string; sessionRef: string; deviceRef: string; conversationRef: string; turnId: string; inputDigest: `sha256:${string}`; output: string; outputDigest: `sha256:${string}`; terminalEvidence: TerminalEvidence }): Promise<void> {
    const state = this.turns.get(input.requestId);
    if (!state || state.inputDigest !== input.inputDigest) throw new Error("MEMORY_FINALIZE_CONFLICT");
    if (state.finalized) return;
    await this.append({ subjectRef: input.subjectRef, sessionRef: input.sessionRef, conversationRef: input.conversationRef, turn: { role: "user", text: state.inputText } });
    await this.append({ subjectRef: input.subjectRef, sessionRef: input.sessionRef, conversationRef: input.conversationRef, turn: { role: "assistant", text: input.output } });
    state.finalized = true;
  }

  async append(
    input: { subjectRef: string; sessionRef: string; conversationRef: string; turn: ConversationTurnRecord },
  ): Promise<void> {
    const key = this.key(input.subjectRef, input.conversationRef);
    const existing = this.byKey.get(key) ?? [];
    let next = [...existing, input.turn].slice(-this.maxTurns);
    let bytes = next.reduce((sum, turn) => sum + Buffer.byteLength(turn.text, "utf8"), 0);
    while (bytes > this.maxBytes && next.length > 1) {
      const [dropped, ...rest] = next;
      next = rest;
      bytes -= Buffer.byteLength(dropped.text, "utf8");
    }
    this.byKey.set(key, next);
  }
}
