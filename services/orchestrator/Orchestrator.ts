import {
  GROUNDING_ROUTES,
  OrchestratorError,
  type ChatRequest,
  type ContextManifest,
  type OrchestratorDependencies,
  type OrchestratorFailureCode,
  type OrchestratorResult,
  type OrchestratorState,
  type SafeTurnStatus,
  type TurnIntent,
} from "./types";

const NO_CONTEXT_DIGEST: `sha256:${string}` = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

export interface OrchestratorOptions {
  now?: () => number;
  maxOutputBytes?: number;
}

/** Coordinates owner APIs and never becomes an authority for their data. */
export class Orchestrator {
  private readonly statuses = new Map<string, SafeTurnStatus>();
  private readonly now: () => number;
  private readonly maxOutputBytes: number;

  constructor(
    private readonly dependencies: OrchestratorDependencies,
    options: OrchestratorOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.maxOutputBytes = options.maxOutputBytes ?? 64 * 1024;
  }

  getStatus(requestId: string): SafeTurnStatus | undefined {
    const status = this.statuses.get(requestId);
    return status ? { ...status } : undefined;
  }

  async execute(request: ChatRequest, signal?: AbortSignal): Promise<OrchestratorResult> {
    const cancellation = signal ?? new AbortController().signal;
    let turn: TurnIntent | undefined;
    this.update(request.requestId, "RECEIVED");
    try {
      this.assertActive(request, cancellation);
      await this.dependencies.authorizeGenerate(request, cancellation);
      this.update(request.requestId, "AUTHORIZED");

      turn = await this.dependencies.beginTurn(request, cancellation);
      this.update(request.requestId, "TURN_INTENT_COMMITTED", turn.turnId);
      this.assertActive(request, cancellation);

      const workflowReservationRef = await this.dependencies.reserveWorkflowBudget(request, turn, cancellation);
      const run = await this.dependencies.beginAgentRun(request, turn, workflowReservationRef, cancellation);
      this.update(request.requestId, "AGENT_RUN_ADMITTED", turn.turnId);

      const route = await this.dependencies.classifyRoute(request, turn, run, workflowReservationRef, cancellation);
      this.update(request.requestId, "ROUTE_CLASSIFIED", turn.turnId);
      this.assertActive(request, cancellation);

      const needsGroundedContext = GROUNDING_ROUTES.has(route.route);
      let context: ContextManifest;
      if (needsGroundedContext) {
        context = await this.dependencies.resolveContext(request, turn, route, cancellation);
      } else {
        // Ungrounded routes (acknowledgement, general conversation, clarification,
        // tool action) never touch Retrieval; there is nothing to authorize or fence.
        context = { digest: NO_CONTEXT_DIGEST, noContext: true };
      }
      if (needsGroundedContext && context.noContext) {
        throw new OrchestratorError("FORBIDDEN", "Grounded context is unavailable.");
      }
      if (needsGroundedContext) {
        await this.dependencies.authorizeContextUse(request, context, cancellation);
      }
      this.update(request.requestId, "CONTEXT_RESOLVED", turn.turnId);

      await this.dependencies.admitAudit("generation", request, turn, cancellation);
      this.update(request.requestId, "OUTPUT_AUDIT_ADMITTED", turn.turnId);

      this.update(request.requestId, "GENERATING", turn.turnId);
      const output = await this.collectOutput(request, context, run, workflowReservationRef, route, cancellation);
      this.assertActive(request, cancellation);
      const runCloseReceipt = await this.dependencies.closeAgentRun(run, cancellation);
      this.update(request.requestId, "AGENT_RUN_CLOSED", turn.turnId);

      const staged = await this.dependencies.stageOutput(turn, output, runCloseReceipt, cancellation);
      const reservation = await this.dependencies.reserveDisclosure(request, staged, runCloseReceipt, cancellation);
      const release = await this.dependencies.authorizeOutput(request, staged, reservation, cancellation);
      const releaseAuditReceipt = await this.dependencies.admitAudit("release", request, turn, cancellation);
      this.update(request.requestId, "FINALIZING", turn.turnId);
      await this.dependencies.finalizeTurn(turn, staged, release, releaseAuditReceipt, cancellation);
      await this.dependencies.commitDisclosure(reservation, staged, release, cancellation);
      const status = this.update(request.requestId, "COMPLETED", turn.turnId);
      return { status, output, outputDigest: staged.outputDigest };
    } catch (error) {
      const code = this.toFailureCode(error, cancellation);
      if (turn) await this.dependencies.failTurn?.(turn, code);
      const state: OrchestratorState = code === "FORBIDDEN" ? "DENIED" : code === "CANCELLED" ? "CANCELLED" : "FAILED";
      return { status: this.update(request.requestId, state, turn?.turnId, code) };
    }
  }

  private async collectOutput(
    request: ChatRequest,
    context: Parameters<OrchestratorDependencies["generate"]>[0]["context"],
    run: Parameters<OrchestratorDependencies["generate"]>[0]["run"],
    workflowReservationRef: string,
    route: Parameters<OrchestratorDependencies["generate"]>[0]["route"],
    signal: AbortSignal,
  ): Promise<string> {
    let output = "";
    for await (const chunk of this.dependencies.generate({ request, context, run, workflowReservationRef, route }, signal)) {
      this.assertActive(request, signal);
      output += chunk;
      if (output.length > this.maxOutputBytes) {
        throw new OrchestratorError("OVERLOADED", "The generated output exceeded its approved bound.");
      }
    }
    return output;
  }

  private assertActive(request: ChatRequest, signal: AbortSignal): void {
    if (signal.aborted) throw new OrchestratorError("CANCELLED", "The request was cancelled.");
    if (request.deadlineAt <= this.now()) throw new OrchestratorError("DEADLINE_EXCEEDED", "The request deadline elapsed.");
  }

  private update(requestId: string, state: OrchestratorState, turnId?: string, code?: OrchestratorFailureCode): SafeTurnStatus {
    const status = { requestId, ...(turnId ? { turnId } : {}), state, ...(code ? { code } : {}) };
    this.statuses.set(requestId, status);
    return { ...status };
  }

  private toFailureCode(error: unknown, signal: AbortSignal): OrchestratorFailureCode {
    if (signal.aborted) return "CANCELLED";
    return error instanceof OrchestratorError ? error.code : "DEPENDENCY_UNAVAILABLE";
  }
}
