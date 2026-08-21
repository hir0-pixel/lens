import { createHash } from "node:crypto";
import { AuditLedger } from "../../services/audit/AuditLedger";
import { CostController } from "../../services/cost-controller/CostController";
import { GpuScheduler } from "../../services/gpu-scheduler/GpuScheduler";
import { InferenceAdapter } from "../../services/inference-adapter/InferenceAdapter";
import { ModelGateway, ModelGatewayError, type RuntimePort, type SchedulerPort } from "../../services/model-gateway/ModelGateway";
import {
  Orchestrator,
  OrchestratorError,
  type ChatRequest,
  type DisclosureReservation,
  type OrchestratorDependencies,
  type OrchestratorFailureCode,
  type OrchestratorResult,
  type StagedOutput,
  type TurnIntent,
} from "../../services/orchestrator";
import type { ReleaseAuthorization } from "../../services/orchestrator/types";
import type { RetrievalRequest, RetrievalResult, RetrievedContext } from "../../libs/rag-contracts";
import type { OrchestratorChatRequest, OrchestratorChatResponse } from "./http";

export interface RetrievalPort {
  retrieve(request: RetrievalRequest, signal: AbortSignal): Promise<RetrievalResult>;
}

export type GenerationContextBoundary = "generation_start" | "tool_call_boundary";

export interface GenerationContextFenceReceipt {
  fenceRef: string;
  contextDigest: `sha256:${string}`;
  expiresAt: number;
  checkedAt: number;
}

export interface GenerationContextFencePort {
  revalidate(input: {
    requestId: string;
    turnId: string;
    subjectRef: string;
    deviceRef: string;
    sessionRef: string;
    contextDigest: `sha256:${string}`;
    manifestExpiresAt: number;
    boundary: GenerationContextBoundary;
    toolCallRef?: string;
  }, signal: AbortSignal): Promise<GenerationContextFenceReceipt>;
}

export interface AuditAdmissionPort {
  admit(input: {
    kind: "generation" | "release";
    requestId: string;
    turnId: string;
    inputDigest: `sha256:${string}`;
  }, signal: AbortSignal): Promise<{ receiptDigest: string }>;
}

export interface OutputGuardPort {
  inspect(input: {
    requestId: string;
    subjectRef: string;
    output: string;
    outputDigest: `sha256:${string}`;
    sourceClassifications: readonly string[];
  }, signal: AbortSignal): Promise<{
    allowed: boolean;
    derivedClassificationRef: string;
    guardReceipt: string;
    reason?: string;
  }>;
}

export interface OutputBlobStorePort {
  putBlob(input: {
    requestId: string;
    turnId: string;
    output: string;
    outputDigest: `sha256:${string}`;
    classificationRef: string;
    guardReceipt: string;
  }, signal: AbortSignal): Promise<{
    outputRef: string;
    outputDigest: `sha256:${string}`;
    commitProof: string;
  }>;
  verifyBlob(input: {
    outputRef: string;
    outputDigest: `sha256:${string}`;
  }, signal: AbortSignal): Promise<boolean>;
  repairDanglingOutput(input: {
    outputRef: string;
    outputDigest: `sha256:${string}`;
  }, signal: AbortSignal): Promise<"repaired" | "missing" | "corrupt">;
}

export interface TurnStatePort {
  commitTerminal(input: {
    requestId: string;
    turnId: string;
    outputRef: string;
    outputDigest: `sha256:${string}`;
    releaseFence: string;
    releaseAuditReceipt: string;
  }, signal: AbortSignal): Promise<void>;
  markFailed(input: {
    requestId: string;
    turnId: string;
    code: OrchestratorFailureCode;
  }): Promise<void>;
}

export interface DisclosureReservationPort {
  reserve(input: {
    requestId: string;
    subjectRef: string;
    outputRef: string;
    outputDigest: `sha256:${string}`;
    classificationRef: string;
  }, signal: AbortSignal): Promise<DisclosureReservation>;
  commit(input: {
    reservation: DisclosureReservation;
    outputRef: string;
    outputDigest: `sha256:${string}`;
    releaseFence: string;
  }, signal: AbortSignal): Promise<void>;
}

export interface ResultAuthorizationPort {
  authorize(input: {
    requestId: string;
    subjectRef: string;
    outputRef: string;
    outputDigest: `sha256:${string}`;
    classificationRef: string;
    disclosureReservationRef: string;
  }, signal: AbortSignal): Promise<ReleaseAuthorization>;
}

export interface ProductionOrchestratorOptions {
  retrieval: RetrievalPort;
  generationContextFence?: GenerationContextFencePort;
  auditAdmission?: AuditAdmissionPort;
  outputGuards?: OutputGuardPort;
  outputStore?: OutputBlobStorePort;
  turnState?: TurnStatePort;
  disclosure?: DisclosureReservationPort;
  resultAuthorization?: ResultAuthorizationPort;
  now?: () => number;
  maxActiveRequests?: number;
  maxPromptBytes?: number;
  maxOutputBytes?: number;
  gpuCapacity?: number;
  scheduler?: SchedulerPort;
  runtime?: RuntimePort;
  modelArtifactDigest?: `sha256:${string}`;
}

interface StoredContext {
  manifestDigest: `sha256:${string}`;
  manifestExpiresAt: number;
  sources: readonly RetrievedContext[];
}

interface RequestState {
  inputText: string;
  subjectRef: string;
  deviceRef: string;
  sessionRef: string;
}

interface StoredOutput {
  requestId: string;
  turnId: string;
  outputRef: string;
  outputDigest: `sha256:${string}`;
  commitProof: string;
  classificationRef: string;
  guardReceipt: string;
}

class FailClosedContextFencePort implements GenerationContextFencePort {
  async revalidate(): Promise<GenerationContextFenceReceipt> {
    throw new OrchestratorError("EVIDENCE_REQUIRED", "Generation context fence authority adapter is required.");
  }
}

class LedgerAuditAdmissionPort implements AuditAdmissionPort {
  private readonly ledger: AuditLedger;

  constructor(now: () => number) {
    this.ledger = new AuditLedger({
      orchestrator: ["orchestrator.generation", "orchestrator.release"],
    }, () => new Date(now()), 64);
  }

  async admit(input: {
    kind: "generation" | "release";
    requestId: string;
    turnId: string;
    inputDigest: `sha256:${string}`;
  }, signal: AbortSignal): Promise<{ receiptDigest: string }> {
    throwIfAborted(signal);
    const receipt = this.ledger.appendIntent({ workloadId: "orchestrator", attested: true }, {
      eventId: `orchestrator:${input.kind}:${input.requestId}`,
      partitionKey: input.requestId,
      eventType: input.kind === "generation" ? "orchestrator.generation" : "orchestrator.release",
      requestId: input.requestId,
      action: input.kind,
      intentDigest: `${input.turnId}:${input.inputDigest}`,
      byteLength: input.inputDigest.length + input.turnId.length,
    });
    return { receiptDigest: receipt.receiptDigest };
  }
}

class FailClosedOutputGuardPort implements OutputGuardPort {
  async inspect(): Promise<{ allowed: boolean; derivedClassificationRef: string; guardReceipt: string }> {
    throw new OrchestratorError("EVIDENCE_REQUIRED", "Output guard adapter is required.");
  }
}

class FailClosedOutputBlobStorePort implements OutputBlobStorePort {
  async putBlob(): Promise<{ outputRef: string; outputDigest: `sha256:${string}`; commitProof: string }> {
    throw new OrchestratorError("EVIDENCE_REQUIRED", "Durable output blob store adapter is required.");
  }

  async verifyBlob(): Promise<boolean> {
    throw new OrchestratorError("EVIDENCE_REQUIRED", "Durable output blob store adapter is required.");
  }

  async repairDanglingOutput(): Promise<"repaired" | "missing" | "corrupt"> {
    throw new OrchestratorError("EVIDENCE_REQUIRED", "Durable output repair adapter is required.");
  }
}

class FailClosedTurnStatePort implements TurnStatePort {
  async commitTerminal(): Promise<void> {
    throw new OrchestratorError("EVIDENCE_REQUIRED", "Terminal turn-state adapter is required.");
  }

  async markFailed(): Promise<void> {
    return undefined;
  }
}

class FailClosedDisclosureReservationPort implements DisclosureReservationPort {
  async reserve(): Promise<DisclosureReservation> {
    throw new OrchestratorError("EVIDENCE_REQUIRED", "Disclosure reservation adapter is required.");
  }

  async commit(): Promise<void> {
    throw new OrchestratorError("EVIDENCE_REQUIRED", "Disclosure commit adapter is required.");
  }
}

class FailClosedResultAuthorizationPort implements ResultAuthorizationPort {
  async authorize(): Promise<ReleaseAuthorization> {
    throw new OrchestratorError("EVIDENCE_REQUIRED", "Durable result authorization adapter is required.");
  }
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new OrchestratorError("CANCELLED", "The request was cancelled.");
}

function citations(sources: readonly RetrievedContext[]): { source: string; section: string }[] {
  return sources.map((source) => ({
    source: source.document_version_ref,
    section: source.citation_anchor,
  }));
}

function requestDigest(request: ChatRequest): `sha256:${string}` {
  return sha256(`${request.requestId}|${request.subjectRef}|${request.deviceRef}|${request.inputDigest}|${request.deadlineAt}`);
}

/**
 * Adapter-driven production Orchestrator service. This owns the internal
 * /v1/chat behavior while delegating authority to Retrieval, Audit,
 * ModelGateway, Scheduler and Runtime ports.
 */
export class ProductionOrchestratorService {
  private readonly orchestrator: Orchestrator;
  private readonly contexts = new Map<string, StoredContext>();
  private readonly requestStates = new Map<string, RequestState>();
  private readonly turns = new Map<string, TurnIntent>();
  private readonly outputs = new Map<string, StoredOutput>();
  private readonly auditAdmission: AuditAdmissionPort;
  private readonly generationContextFence: GenerationContextFencePort;
  private readonly outputGuards: OutputGuardPort;
  private readonly outputStore: OutputBlobStorePort;
  private readonly turnState: TurnStatePort;
  private readonly disclosure: DisclosureReservationPort;
  private readonly resultAuthorization: ResultAuthorizationPort;
  private readonly cost: CostController;
  private readonly modelGateway: ModelGateway;
  private readonly now: () => number;
  private readonly maxPromptBytes: number;
  private readonly maxOutputBytes: number;
  private active = 0;

  constructor(private readonly options: ProductionOrchestratorOptions) {
    this.now = options.now ?? (() => Date.now());
    this.auditAdmission = options.auditAdmission ?? new LedgerAuditAdmissionPort(this.now);
    this.generationContextFence = options.generationContextFence ?? new FailClosedContextFencePort();
    this.outputGuards = options.outputGuards ?? new FailClosedOutputGuardPort();
    this.outputStore = options.outputStore ?? new FailClosedOutputBlobStorePort();
    this.turnState = options.turnState ?? new FailClosedTurnStatePort();
    this.disclosure = options.disclosure ?? new FailClosedDisclosureReservationPort();
    this.resultAuthorization = options.resultAuthorization ?? new FailClosedResultAuthorizationPort();
    this.maxPromptBytes = options.maxPromptBytes ?? 256 * 1024;
    this.maxOutputBytes = options.maxOutputBytes ?? 64 * 1024;
    this.cost = new CostController(100_000, this.now);
    const scheduler = options.scheduler ?? new GpuScheduler(options.gpuCapacity ?? 8, this.now);
    const runtime = options.runtime ?? new InferenceAdapter();
    const modelArtifactDigest = options.modelArtifactDigest ?? `sha256:${"c".repeat(64)}`;
    this.modelGateway = new ModelGateway(
      { resolve: async ({ artifactDigest }) => ({ endpointRef: `internal-model:${artifactDigest}`, snapshotExpiresAt: this.now() + 60_000, external: false }) },
      {
        validate: async ({ reservationRef, requestId, estimateDigest, expiresAt }) => {
          this.cost.reserve({ reservationRef, requestId, estimateDigest, maximumCost: 1_000, expiresAt });
        },
        finalize: async ({ reservationRef, usageEventId, measuredCost }) => {
          this.cost.finalize(reservationRef, usageEventId, measuredCost);
        },
      },
      { reserve: async (input) => scheduler.reserve(input), start: async (...args) => { scheduler.start(...args); }, release: async (...args) => { scheduler.release(...args); } },
      { execute: (input, signal) => runtime.execute(input, signal) },
      this.now,
    );
    this.orchestrator = new Orchestrator(this.dependencies(modelArtifactDigest), { now: this.now, maxOutputBytes: this.maxOutputBytes });
  }

  async handleChat(request: OrchestratorChatRequest, signal: AbortSignal): Promise<OrchestratorChatResponse> {
    if (request.retryBudget !== 0) {
      return { status: "FAILED", requestId: request.requestId, error: "NON_IDEMPOTENT_RETRY_REJECTED" };
    }
    if (this.active >= (this.options.maxActiveRequests ?? 32)) {
      return { status: "FAILED", requestId: request.requestId, error: "OVERLOADED" };
    }
    this.active += 1;
    this.requestStates.set(request.requestId, {
      inputText: request.inputText,
      subjectRef: request.subjectRef,
      deviceRef: request.deviceRef,
      sessionRef: request.sessionRef,
    });
    try {
      const result = await this.orchestrator.execute({
        requestId: request.requestId,
        subjectRef: request.subjectRef,
        deviceRef: request.deviceRef,
        conversationRef: request.sessionRef,
        inputDigest: request.queryDigest,
        deadlineAt: request.deadlineAt,
        requireGroundedContext: true,
      }, signal);
      const response = this.toResponse(request.requestId, result);
      return response;
    } finally {
      this.active -= 1;
      this.releaseRequestState(request.requestId);
    }
  }

  async revalidateToolCallBoundary(input: {
    requestId: string;
    contextDigest: `sha256:${string}`;
    toolCallRef: string;
  }, signal: AbortSignal): Promise<GenerationContextFenceReceipt> {
    const state = this.requestStates.get(input.requestId);
    const turn = this.turns.get(input.requestId);
    const stored = this.contexts.get(input.requestId);
    if (!state || !turn || !stored || stored.manifestDigest !== input.contextDigest) {
      throw new OrchestratorError("FORBIDDEN", "Tool-call context fence is unavailable or changed.");
    }
    return this.revalidateStoredContext({
      requestId: input.requestId,
      turnId: turn.turnId,
      subjectRef: state.subjectRef,
      deviceRef: state.deviceRef,
      sessionRef: state.sessionRef,
      contextDigest: input.contextDigest,
      manifestExpiresAt: stored.manifestExpiresAt,
      boundary: "tool_call_boundary",
      toolCallRef: input.toolCallRef,
    }, signal);
  }

  private dependencies(modelArtifactDigest: `sha256:${string}`): OrchestratorDependencies {
    const service = this;
    return {
      authorizeGenerate: async (request) => {
        if (!request.subjectRef || !request.deviceRef || request.deadlineAt <= this.now()) {
          throw new OrchestratorError("FORBIDDEN", "The generation request is not authorized.");
        }
      },
      beginTurn: async (request) => {
        const turn = { turnId: `turn:${request.requestId}`, sequence: 1 };
        this.turns.set(request.requestId, turn);
        return turn;
      },
      resolveContext: async (request, turn, signal) => {
        const requestState = this.requestStates.get(request.requestId);
        if (!requestState) throw new OrchestratorError("FORBIDDEN", "Input text is unavailable for retrieval.");
        const retrieval = await this.options.retrieval.retrieve({
          request_id: request.requestId,
          turn_id: turn.turnId,
          caller_workload_ref: "ai-orchestrator",
          subject_ref: request.subjectRef,
          session_ref: request.conversationRef,
          device_ref: request.deviceRef,
          application_id: "lens-employee-client",
          query_digest: request.inputDigest,
          query_text: requestState.inputText,
          purpose_ref: "assistant",
          retrieval_class: "enterprise-grounded",
          corpus_ref: "enterprise-docs",
          mode: "hybrid",
          candidate_limit: 100,
          deadline_at: request.deadlineAt,
          cancellation: signal.aborted,
          bulkhead: "interactive",
          visibility_minimum: 0,
        }, signal);
        if (retrieval.status === "denied_policy") throw new OrchestratorError("FORBIDDEN", "Retrieval denied context.");
        if (retrieval.status === "failed_downstream") throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Retrieval failed.");
        if (retrieval.status === "no_context") return { digest: sha256("no-context"), noContext: true };
        this.contexts.set(request.requestId, {
          manifestDigest: retrieval.manifest.digest,
          manifestExpiresAt: retrieval.manifest.expires_at,
          sources: retrieval.sources,
        });
        return { digest: retrieval.manifest.digest, noContext: false };
      },
      authorizeContextUse: async (request, context) => {
        const stored = this.contexts.get(request.requestId);
        if (context.noContext || !stored || stored.manifestDigest !== context.digest || stored.manifestExpiresAt <= this.now()) {
          throw new OrchestratorError("FORBIDDEN", "Context use fence is stale.");
        }
      },
      reserveBudget: async (request, context) => {
        if (context.noContext) throw new OrchestratorError("FORBIDDEN", "Cannot reserve generation budget without context.");
        return `budget:${request.requestId}`;
      },
      beginAgentRun: async (request) => ({ runId: `run:${request.requestId}`, envelopeRevision: 1, stepFence: `context:${request.requestId}` }),
      admitAudit: async (kind, request, turn, signal) => {
        const receipt = await this.auditAdmission.admit({
          kind,
          requestId: request.requestId,
          turnId: turn.turnId,
          inputDigest: request.inputDigest,
        }, signal);
        return receipt.receiptDigest;
      },
      generate: async function* (input, signal) {
        const stored = service.contexts.get(input.request.requestId);
        const requestState = service.requestStates.get(input.request.requestId);
        if (!stored || stored.manifestDigest !== input.context.digest || stored.manifestExpiresAt <= service.now()) {
          throw new OrchestratorError("FORBIDDEN", "Context expired or changed before generation.");
        }
        if (!requestState) throw new OrchestratorError("FORBIDDEN", "Input text is unavailable for prompt composition.");
        await service.revalidateStoredContext({
          requestId: input.request.requestId,
          turnId: service.turns.get(input.request.requestId)?.turnId ?? `turn:${input.request.requestId}`,
          subjectRef: input.request.subjectRef,
          deviceRef: input.request.deviceRef,
          sessionRef: input.request.conversationRef,
          contextDigest: input.context.digest,
          manifestExpiresAt: stored.manifestExpiresAt,
          boundary: "generation_start",
        }, signal);
        const prompt = [
          `Answer using only the authorized context for request ${input.request.requestId}.`,
          `Question: ${requestState.inputText}`,
          ...stored.sources.map((source, index) => `[${index + 1}] ${source.text}`),
        ];
        if (Buffer.byteLength(prompt.join(""), "utf8") > service.maxPromptBytes) {
          throw new OrchestratorError("OVERLOADED", "The authorized prompt exceeded its bounded context envelope.");
        }
        let generated;
        try {
          generated = await service.modelGateway.generate({
            requestId: input.request.requestId,
            requestDigest: requestDigest(input.request),
            capability: "grounded-assistant",
            artifactDigest: modelArtifactDigest,
            denyEpoch: 0,
            budgetReservationRef: input.budgetRef,
            estimateDigest: "estimate-1",
            deadlineAt: input.request.deadlineAt,
            contextFence: input.run.stepFence,
            scopeId: `scope:${input.request.subjectRef}`,
            chunks: prompt,
          }, signal);
        } catch (error) {
          throw mapModelGatewayError(error);
        }
        if (Buffer.byteLength(generated.output, "utf8") > service.maxOutputBytes) {
          throw new OrchestratorError("OVERLOADED", "The generated output exceeded its approved byte envelope.");
        }
        yield generated.output;
      },
      closeAgentRun: async (run) => `closed:${run.runId}`,
      stageOutput: async (turn, output, runCloseReceipt, signal): Promise<StagedOutput> => {
        const requestId = turn.turnId.replace(/^turn:/, "");
        const requestState = service.requestStates.get(requestId);
        const context = service.contexts.get(requestId);
        if (!requestState || !context) throw new OrchestratorError("FORBIDDEN", "Cannot stage output without live request context.");
        if (Buffer.byteLength(output, "utf8") > service.maxOutputBytes) {
          throw new OrchestratorError("OVERLOADED", "The generated output exceeded its approved byte envelope.");
        }
        const outputDigest = sha256(output);
        const guard = await service.outputGuards.inspect({
          requestId,
          subjectRef: requestState.subjectRef,
          output,
          outputDigest,
          sourceClassifications: context.sources.map((source) => source.classification_ref),
        }, signal);
        throwIfAborted(signal);
        if (!guard.allowed) throw new OrchestratorError("FORBIDDEN", guard.reason ?? "Output guard denied release.");
        const blob = await service.outputStore.putBlob({
          requestId,
          turnId: turn.turnId,
          output,
          outputDigest,
          classificationRef: guard.derivedClassificationRef,
          guardReceipt: `${runCloseReceipt}:${guard.guardReceipt}`,
        }, signal);
        throwIfAborted(signal);
        if (blob.outputDigest !== outputDigest) {
          throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Durable output store returned a mismatched digest.");
        }
        service.outputs.set(requestId, {
          requestId,
          turnId: turn.turnId,
          outputRef: blob.outputRef,
          outputDigest: blob.outputDigest,
          commitProof: blob.commitProof,
          classificationRef: guard.derivedClassificationRef,
          guardReceipt: guard.guardReceipt,
        });
        return {
          outputRef: blob.outputRef,
          outputDigest: blob.outputDigest,
          commitProof: blob.commitProof,
        };
      },
      reserveDisclosure: async (request, staged, _runCloseReceipt, signal) => {
        const storedOutput = service.requireStoredOutput(request.requestId, staged);
        return service.disclosure.reserve({
          requestId: request.requestId,
          subjectRef: request.subjectRef,
          outputRef: staged.outputRef,
          outputDigest: staged.outputDigest,
          classificationRef: storedOutput.classificationRef,
        }, signal);
      },
      authorizeOutput: async (request, staged, reservation, signal) => {
        const storedOutput = service.requireStoredOutput(request.requestId, staged);
        if (!staged.outputDigest) throw new OrchestratorError("FORBIDDEN", "Output is not staged.");
        return service.resultAuthorization.authorize({
          requestId: request.requestId,
          subjectRef: request.subjectRef,
          outputRef: staged.outputRef,
          outputDigest: staged.outputDigest,
          classificationRef: storedOutput.classificationRef,
          disclosureReservationRef: reservation.reservationRef,
        }, signal);
      },
      finalizeTurn: async (turn, staged, release, releaseAuditReceipt, signal) => {
        const requestId = turn.turnId.replace(/^turn:/, "");
        service.requireStoredOutput(requestId, staged);
        const verified = await service.outputStore.verifyBlob({
          outputRef: staged.outputRef,
          outputDigest: staged.outputDigest,
        }, signal);
        throwIfAborted(signal);
        if (!verified) {
          const repaired = await service.outputStore.repairDanglingOutput({
            outputRef: staged.outputRef,
            outputDigest: staged.outputDigest,
          }, signal);
          throwIfAborted(signal);
          if (repaired !== "repaired") {
            throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", `Dangling output repair failed: ${repaired}.`);
          }
        }
        await service.turnState.commitTerminal({
          requestId,
          turnId: turn.turnId,
          outputRef: staged.outputRef,
          outputDigest: staged.outputDigest,
          releaseFence: release.releaseFence,
          releaseAuditReceipt,
        }, signal);
      },
      commitDisclosure: async (reservation, staged, release, signal) => {
        await service.disclosure.commit({
          reservation,
          outputRef: staged.outputRef,
          outputDigest: staged.outputDigest,
          releaseFence: release.releaseFence,
        }, signal);
      },
      failTurn: async (turn, code) => {
        const requestId = turn.turnId.replace(/^turn:/, "");
        await this.turnState.markFailed({ requestId, turnId: turn.turnId, code });
        this.releaseRequestState(requestId);
      },
    };
  }

  private toResponse(requestId: string, result: OrchestratorResult): OrchestratorChatResponse {
    if ("output" in result) {
      return {
        status: "COMPLETED",
        requestId,
        turnId: result.status.turnId,
        output: result.output,
        outputDigest: result.outputDigest,
        citations: citations(this.contexts.get(requestId)?.sources ?? []),
      };
    }
    const status = result.status.state === "DENIED" ? "DENIED" : result.status.state === "CANCELLED" ? "CANCELLED" : "FAILED";
    return { status, requestId, turnId: result.status.turnId, error: result.status.code };
  }

  private async revalidateStoredContext(input: {
    requestId: string;
    turnId: string;
    subjectRef: string;
    deviceRef: string;
    sessionRef: string;
    contextDigest: `sha256:${string}`;
    manifestExpiresAt: number;
    boundary: GenerationContextBoundary;
    toolCallRef?: string;
  }, signal: AbortSignal): Promise<GenerationContextFenceReceipt> {
    throwIfAborted(signal);
    if (input.manifestExpiresAt <= this.now()) {
      throw new OrchestratorError("FORBIDDEN", "Generation context fence is expired.");
    }
    const receipt = await this.generationContextFence.revalidate(input, signal);
    throwIfAborted(signal);
    if (
      receipt.contextDigest !== input.contextDigest ||
      receipt.expiresAt <= this.now() ||
      receipt.expiresAt > input.manifestExpiresAt
    ) {
      throw new OrchestratorError("FORBIDDEN", "Generation context fence revalidation failed.");
    }
    return receipt;
  }

  private requireStoredOutput(requestId: string, staged: StagedOutput): StoredOutput {
    const storedOutput = this.outputs.get(requestId);
    if (
      !storedOutput ||
      storedOutput.outputRef !== staged.outputRef ||
      storedOutput.outputDigest !== staged.outputDigest
    ) {
      throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Staged output metadata is unavailable or inconsistent.");
    }
    return storedOutput;
  }

  private releaseRequestState(requestId: string): void {
    this.contexts.delete(requestId);
    this.requestStates.delete(requestId);
    this.turns.delete(requestId);
    this.outputs.delete(requestId);
  }
}

function mapModelGatewayError(error: unknown): OrchestratorError {
  if (error instanceof OrchestratorError) return error;
  if (!(error instanceof ModelGatewayError)) return new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Model Gateway failed.");
  switch (error.code) {
    case "CANCELLED":
      return new OrchestratorError("CANCELLED", "Model generation was cancelled.");
    case "FORBIDDEN":
    case "STALE_AUTHORITY":
      return new OrchestratorError("FORBIDDEN", "Model Gateway rejected stale or unauthorized authority.");
    case "OVERLOADED":
      return new OrchestratorError("OVERLOADED", "Model Gateway capacity is unavailable.");
    case "DEPENDENCY_UNAVAILABLE":
      return new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Model Gateway dependency is unavailable.");
  }
}
