import { createHash, generateKeyPairSync } from "node:crypto";
import { AuditLedger } from "../../services/audit/AuditLedger";
import { GpuScheduler } from "../../services/gpu-scheduler/GpuScheduler";
import { InferenceAdapter } from "../../services/inference-adapter/InferenceAdapter";
import { ModelGateway, ModelGatewayError, type ModelGatewayAuthority, type RuntimePort, type RuntimeReceipt, type SchedulerPort } from "../../services/model-gateway/ModelGateway";
import { AuthorityReceiptIssuer, Ed25519ReceiptVerifier, FailClosedReceiptVerifier, type ReceiptVerifier, type SignedAuthorityReceipt } from "../../services/security/authorityReceipt";
import { FailClosedClaimStore, InMemoryClaimStore, type ClaimStore } from "../../services/security/replayClaimStore";
import { FailClosedModelUseAuthorityPort, SubjectDeviceModelUseAuthority, type ModelUseAuthorityPort } from "../../services/pdp/ModelUseAuthority";
import { FailClosedCostAuthority, type CostAuthorityPort } from "../../services/cost-authority/CostAuthority";
import { SqliteCostAuthority } from "../../services/cost-authority/SqliteCostAuthority";
import { FailClosedAgentRunAuthority, type AgentRunAuthorityPort } from "../../services/agent-run-authority/AgentRunAuthority";
import { SqliteAgentRunAuthority } from "../../services/agent-run-authority/SqliteAgentRunAuthority";
import { estimateModelUnits, resolveWorkflowLimits, workflowProfileDigest, ALLOWED_AGENT_STEP_CLASSES, type SignedWorkflowProfile, type WorkflowLimits } from "../../services/workflow-profile/workflowProfile";
import { FailClosedRuntimeAttemptStore, type RuntimeAttemptStore } from "../../services/runtime-attempt/RuntimeAttemptStore";
import { conservativeMeasuredUnits, claimVerifiedUsage, type UsageExpectedContext } from "../../services/security/sidecarUsage";
import { RelationalRuntimeAttemptStore } from "../../services/runtime-attempt/RelationalRuntimeAttemptStore";
import { createSqlitePgCompatPool } from "../../services/storage/pgPool";
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
  type TurnRoute,
} from "../../services/orchestrator";
import type { ReleaseAuthorization } from "../../services/orchestrator/types";
import type { RetrievalRequest, RetrievalResult, RetrievedContext } from "../../libs/rag-contracts";
import type { OrchestratorChatRequest, OrchestratorChatResponse } from "./http";
import { classifyTurn, ROUTER_REASON_CODES, type ConfidenceBucket, type ConversationTurnRecord, type RouteOutput, type RouterReasonCode, type TurnRouterLLMPort } from "./router";
import { InMemoryConversationHistory, type ConversationHistoryPort } from "./conversationHistory";
import type { ModelSelectionPort } from "./modelSelection";
import type { ModelEligibilityCheckPort } from "./modelGovernance";
import { FailClosedRoutePolicyPort, RoutePolicyError, type RoutePolicyPort, type RoutePolicyResult } from "./groundingPolicy";
import type { CompanyRagProfile } from "../../services/rag-profile/companyRagProfile";
import { computeCompanyRagProfileDigest, employeeModelDoesNotAffectRag } from "../../services/rag-profile/companyRagProfile";
import { isValidModelRef } from "./modelSelection";

function sidecarVerifiedUnits(
  reserved: number,
  generated: RuntimeReceipt,
  expected: UsageExpectedContext,
  publicKey?: string,
): number {
  if (!publicKey || !generated.usageSignature) return reserved;
  const verified = claimVerifiedUsage(publicKey, {
    schemaVersion: generated.schemaVersion,
    reservationId: generated.reservationId,
    requestId: generated.requestId,
    turnId: generated.turnId,
    stepId: generated.stepId,
    fence: generated.fence,
    artifactDigest: generated.artifactDigest,
    endpointGeneration: generated.endpointGeneration,
    usageEventId: generated.usageEventId,
    measuredUnits: generated.measuredUnits,
    terminal: generated.terminal,
  }, generated.usageSignature, expected);
  return conservativeMeasuredUnits(reserved, generated.measuredUnits, verified);
}

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
    /** Exact, immutable resource/version references the fence must attest — the real PDP re-checks current ACL/publication/integrity state for each one. */
    resourceRefs: readonly string[];
    /** The corpus generation the retrieved context came from. */
    indexGeneration: string;
    /** Request-captured CompanyRagProfile identity that authorized this context. */
    profileVersion: number;
    profileDigest: `sha256:${string}`;
    toolCallRef?: string;
  }, signal: AbortSignal): Promise<GenerationContextFenceReceipt>;
}

/**
 * Complete structured provenance for a route_override admission (Doc 004
 * §23 step 4 / item 4). Every field the user asked for, named — never
 * concatenated into an opaque string or reduced to a bare `kind`+digest.
 */
export interface RouteOverrideAuditFields {
  attemptedRoute: RouteOutput;
  attemptedReasonCode: RouterReasonCode;
  attemptedConfidenceBucket: string;
  attemptedProfileSelector?: string;
  effectiveRoute: RouteOutput;
  effectiveProfileSelector?: string;
  groundingRequired: boolean;
  routePolicyRevision: number;
  routePolicyDigest: `sha256:${string}`;
  allowedProfileSetDigest: `sha256:${string}`;
  enforcementOverride: boolean;
  overrideReason: string;
}

export interface AuditAdmissionPort {
  admit(input: {
    /** "route_override" records a grounding-required enforcement override (Doc 004 §23 step 4) — durably admitted before the resulting route is acted on. */
    kind: "generation" | "release" | "route_override";
    requestId: string;
    turnId: string;
    inputDigest: `sha256:${string}`;
    ragProfileVersion: number;
    ragProfileDigest: `sha256:${string}`;
    /** Required when, and only meaningful when, kind === "route_override". */
    routeOverride?: RouteOverrideAuditFields;
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
    deviceRef: string;
    applicationRef: string;
    purposeRef: string;
    outputRef: string;
    outputDigest: `sha256:${string}`;
    classificationRef: string;
    /** Classification of each source document that grounded this output — the live exposure ledger keys on the strongest of these, not just the single derived output classification. */
    sourceClassifications: readonly string[];
    resourceSetDigest: `sha256:${string}`;
    lineageDigest: `sha256:${string}`;
    units: number;
    ceiling: number;
    terminalReceipt: {
      runRef: string;
      finalCounterDigest: `sha256:${string}`;
      terminal: boolean;
      pendingWork: boolean;
    };
    expiresAt: number;
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

export interface ApprovedEmployeeModel {
  modelRef: string;
  artifactDigest: `sha256:${string}`;
  approvedCapabilities: readonly string[];
}

export interface EmployeeApprovedCatalogPort {
  refresh(): Promise<void>;
  resolve(input: { modelRef: string; capability: string }): { artifactDigest: `sha256:${string}` };
  digestApproved(input: { artifactDigest: string; capability: string }): boolean;
}

export class SnapshotEmployeeCatalog implements EmployeeApprovedCatalogPort {
  constructor(
    private models: readonly ApprovedEmployeeModel[],
    private readonly ragProfile?: CompanyRagProfile,
    private readonly loader?: () => Promise<readonly ApprovedEmployeeModel[]>,
  ) {}

  async refresh(): Promise<void> {
    if (this.loader) this.models = await this.loader();
  }

  resolve(input: { modelRef: string; capability: string }): { artifactDigest: `sha256:${string}` } {
    if (!isValidModelRef(input.modelRef)) throw new OrchestratorError("FORBIDDEN", "The requested model reference is malformed.");
    if (this.ragProfile && !employeeModelDoesNotAffectRag(this.ragProfile, input.modelRef)) {
      throw new OrchestratorError("FORBIDDEN", "The requested model is not eligible for this company profile.");
    }
    const entry = this.models.find((model) => model.modelRef === input.modelRef);
    if (!entry || !entry.approvedCapabilities.includes(input.capability)) {
      throw new OrchestratorError("FORBIDDEN", "The requested model is not approved for this capability.");
    }
    return { artifactDigest: entry.artifactDigest };
  }

  digestApproved(input: { artifactDigest: string; capability: string }): boolean {
    return this.models.some((model) =>
      model.artifactDigest === input.artifactDigest && model.approvedCapabilities.includes(input.capability),
    );
  }
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
  /**
   * Disclosure exposure ceiling threaded into every disclosure reservation.
   * HONEST SCOPE NOTE: no real tenant/data-governance policy service exists
   * in this repository to source this from; it is a caller-supplied,
   * process-wide constant until one is wired in. A production deployment
   * must source this per (subject, application, purpose) from real policy,
   * not a fixed default. Named as an outstanding gap in the implementation
   * report.
   */
  disclosureCeiling?: number;
  /** Schema-constrained turn router. Optional: without it every turn uses the deterministic fallback classifier (see router.ts). */
  turnRouter?: TurnRouterLLMPort;
  /**
   * Wires the production router (item 7): the route-classification model
   * step dispatches through the same ModelGateway used for final
   * generation, with its own reservation, one-use step fence, and budget —
   * never a raw, unbudgeted call. Ignored if `turnRouter` is explicitly
   * supplied. `main.ts`'s production entrypoint sets this to true and
   * requires a working router model catalog entry; test/dev callers that
   * don't care about router mechanics leave it unset and get the
   * documented deterministic fallback instead of a real (and therefore
   * potentially failing) model dispatch attempt.
   */
  useGatewayTurnRouter?: boolean;
  /** Bounded, authorized conversation history used for CONTEXTUAL_FOLLOW_UP rewriting. Defaults to a process-local, non-durable store. */
  conversationHistory?: ConversationHistoryPort;
  /** Server-side model catalog the Model Gateway validates model_ref against. Fails closed if not configured and a model is needed. */
  modelSelection?: ModelSelectionPort;
  /**
   * Live approved employee catalog (BFF Provider Registry snapshot).
   * When set, employee-selected model_ref is validated against this catalog and
   * CompanyRagProfile.eligibleModelPatterns on every turn. Router model_ref stays on modelSelection.
   */
  employeeCatalog?: EmployeeApprovedCatalogPort;
  ragProfile?: CompanyRagProfile;
  /** Live model endpoint eligibility (routability + revocation), backed by a signed ModelRegistry snapshot in production (see modelGovernance.ts). Defaults to a single-digest check scoped to modelArtifactDigest, never a blanket approval. */
  modelEligibility?: ModelEligibilityCheckPort;
  maxHistoryTurns?: number;
  /**
   * Signed, server-owned route policy resolved from application/workspace/
   * purpose/request-class, before the router ever runs (see
   * groundingPolicy.ts). Defaults to `FailClosedRoutePolicyPort`, which
   * denies every resolution — there is no permissive default. A production
   * deployment MUST inject a real policy port backed by the signed
   * route-policy authority.
   */
  routePolicy?: RoutePolicyPort;
  /** Real AuthorizeGenerate/AuthorizeModelUse authority (see services/pdp/ModelUseAuthority.ts). Defaults to FailClosedModelUseAuthorityPort — denies every authorization. A production deployment MUST inject a real port. */
  modelUseAuthority?: ModelUseAuthorityPort;
  /** Real Doc 019 Cost authority: one whole-workflow reservation per turn with non-interchangeable route/retrieval/final_generation/tool sub-envelopes. Defaults to FailClosedCostAuthority. A production deployment MUST inject a durable, cross-replica implementation (e.g. SqliteCostAuthority pointed at shared durable storage, or a real network client). */
  costAuthority?: CostAuthorityPort;
  /** Real Doc 014 Agent-run/step authority. Defaults to FailClosedAgentRunAuthority. A production deployment MUST inject a durable, cross-replica implementation. */
  agentRunAuthority?: AgentRunAuthorityPort;
  /** Verifies the typed receipts Model Gateway consumes. Defaults to FailClosedReceiptVerifier. */
  receiptVerifier?: ReceiptVerifier;
  /** The shared, cross-replica one-use claim store Model Gateway claims Agent-step receipts against. Defaults to FailClosedClaimStore. */
  claimStore?: ClaimStore;
  runtimeAttempts?: RuntimeAttemptStore;
  /** Ed25519 public key for sidecar-signed usage. Production supplies this; unsigned runtime tokens are telemetry only. */
  usageReceiptPublicKey?: string;
  /**
   * Dev/test-only convenience: wires SubjectDeviceModelUseAuthority (permissive subject/
   * device facts, always active/compliant), SqliteCostAuthority/SqliteAgentRunAuthority
   * backed by ":memory:" (not durable, not cross-replica), and a matching
   * Ed25519ReceiptVerifier/InMemoryClaimStore — all sharing one throwaway signing keypair
   * generated at construction. Individual options above still override any one of these.
   * NEVER set this in production: main.ts's production entrypoint does not expose it and
   * instead requires each of modelUseAuthority/costAuthority/agentRunAuthority/
   * receiptVerifier/claimStore to be supplied explicitly, or the FailClosed defaults apply.
   */
  devInMemoryAuthorities?: boolean;
}

interface StoredContext {
  manifestDigest: `sha256:${string}`;
  manifestExpiresAt: number;
  sources: readonly RetrievedContext[];
  indexGeneration: string;
}

interface RequestState {
  inputText: string;
  inputDigest: `sha256:${string}`;
  subjectRef: string;
  deviceRef: string;
  sessionRef: string;
  memorySessionAssertion?: string;
  conversationRef: string;
  applicationRef: string;
  purposeRef: string;
  route: TurnRoute;
  /** The text used for retrieval/generation: raw input, or the router's rewritten standalone query for CONTEXTUAL_FOLLOW_UP. */
  queryText: string;
  clarifyQuestion?: string;
  modelRef?: string;
  /** Architecture-level effective route (Doc 004 §23), for audit/lineage — see router.ts's RouteOutput. */
  routeOutput: RouteOutput;
  profileSelector?: string;
  /** The router's (or fast-path's) original attempt, before any grounding-required override — equal to routeOutput/profileSelector when enforcementOverride is false. */
  attemptedRoute: RouteOutput;
  attemptedReasonCode: RouterReasonCode;
  attemptedConfidenceBucket: ConfidenceBucket;
  attemptedProfileSelector?: string;
  groundingRequired: boolean;
  allowedProfileSetDigest: `sha256:${string}`;
  routePolicyRevision: number;
  routePolicyDigest: `sha256:${string}`;
  enforcementOverride: boolean;
  overrideReason?: string;
  workflowProfileDigest?: `sha256:${string}`;
  workflowLimits?: WorkflowLimits;
  routePolicyResult?: RoutePolicyResult;
  /** Provenance for which CompanyRagProfile version resolved the corpus/mode below (lineage, not a competing signing authority -- see RouteOverrideAuditFields/TerminalEvidence). */
  ragProfileVersion?: number;
  ragProfileDigest?: `sha256:${string}`;
  /** Whether a CompanyRagProfile was configured when this request resolved its retrieval profile. */
  hasConfiguredRagProfile?: boolean;
  resolvedCorpusRef?: string;
  resolvedMode?: string;
}

interface StoredOutput {
  requestId: string;
  turnId: string;
  outputRef: string;
  outputDigest: `sha256:${string}`;
  commitProof: string;
  classificationRef: string;
  guardReceipt: string;
  output: string;
}

function resourceRefsOf(stored: { sources: readonly RetrievedContext[] }): readonly string[] {
  return Array.from(new Set(stored.sources.map((source) => source.document_version_ref)));
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
      orchestrator: ["orchestrator.generation", "orchestrator.release", "orchestrator.route_override"],
    }, () => new Date(now()), 64);
  }

  async admit(input: {
    kind: "generation" | "release" | "route_override";
    requestId: string;
    turnId: string;
    inputDigest: `sha256:${string}`;
    ragProfileVersion: number;
    ragProfileDigest: `sha256:${string}`;
    routeOverride?: RouteOverrideAuditFields;
  }, signal: AbortSignal): Promise<{ receiptDigest: string }> {
    throwIfAborted(signal);
    // AuditLedger's commitment is over a single intentDigest string — the
    // structured route_override fields are folded into it so the ledger's
    // cryptographic receipt actually covers them, not just requestId/turnId.
    // This is the dev/test default; production carries the full structured
    // fields to the real Authority admission contract instead (see
    // AuthorityHttpClient.admit / authority-service's AdmitInput).
    const intentDigest = input.routeOverride
      ? `${input.turnId}:${input.inputDigest}:${input.ragProfileVersion}:${input.ragProfileDigest}:${createHash("sha256").update(JSON.stringify(input.routeOverride)).digest("hex")}`
      : `${input.turnId}:${input.inputDigest}:${input.ragProfileVersion}:${input.ragProfileDigest}`;
    const receipt = this.ledger.appendIntent({ workloadId: "orchestrator", attested: true }, {
      eventId: `orchestrator:${input.kind}:${input.requestId}`,
      partitionKey: input.requestId,
      eventType: `orchestrator.${input.kind}`,
      requestId: input.requestId,
      action: input.kind,
      intentDigest,
      byteLength: intentDigest.length,
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

/** Backward-compatible single-model catalog: accepts only the unset/"default" model_ref. Any other explicit model_ref fails closed unless a real ModelSelectionPort is configured. */
export class SingleDigestModelSelection implements ModelSelectionPort {
  constructor(private readonly artifactDigest: `sha256:${string}`) {}
  resolve(input: { modelRef: string; capability: string }): { artifactDigest: `sha256:${string}` } {
    if (input.modelRef && input.modelRef !== "default") {
      throw new OrchestratorError("FORBIDDEN", "The requested model is not approved for this capability.");
    }
    return { artifactDigest: this.artifactDigest };
  }
}

/**
 * Backward-compatible single-model eligibility check, paired with
 * SingleDigestModelSelection above. This is deliberately NOT a blanket
 * "approve any artifact" answer — it approves exactly the one
 * constructor-pinned digest and rejects every other one — so it cannot be
 * used to smuggle an unapproved or external artifact through the Model
 * Gateway. It has no live revocation source (denyEpoch is always 0); a real
 * multi-model deployment must configure RegistryModelGovernance
 * (modelGovernance.ts) instead, which does.
 */
export class SingleDigestModelEligibility implements ModelEligibilityCheckPort {
  constructor(private readonly artifactDigest: `sha256:${string}`, private readonly now: () => number) {}
  async resolveEndpoint(input: { capability: string; artifactDigest: string; denyEpoch: number }): Promise<{ endpointRef: string; snapshotExpiresAt: number; external: boolean }> {
    if (input.artifactDigest !== this.artifactDigest) {
      throw new OrchestratorError("FORBIDDEN", "The model artifact is not the approved single-model deployment digest.");
    }
    return { endpointRef: `internal-model:${input.artifactDigest}`, snapshotExpiresAt: this.now() + 60_000, external: false };
  }
  currentDenyEpoch(): number {
    return 0;
  }

  capabilityApproved(input: { artifactDigest: string; capability: string }): boolean {
    return input.artifactDigest === this.artifactDigest;
  }
}
export class EmployeeCatalogModelEligibility implements ModelEligibilityCheckPort {
  constructor(
    private readonly catalog: EmployeeApprovedCatalogPort,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async resolveEndpoint(input: { capability: string; artifactDigest: string; denyEpoch: number }): Promise<{ endpointRef: string; snapshotExpiresAt: number; external: boolean }> {
    if (!this.catalog.digestApproved(input)) {
      throw new OrchestratorError("FORBIDDEN", "The model artifact is not approved in the employee catalog.");
    }
    return { endpointRef: `provider-model:${input.artifactDigest}`, snapshotExpiresAt: this.now() + 60_000, external: false };
  }

  currentDenyEpoch(): number {
    return 0;
  }

  capabilityApproved(input: { artifactDigest: string; capability: string }): boolean {
    return this.catalog.digestApproved(input);
  }
}

/** Try delegates in order; used so route-policy "default" keeps the pinned digest while employee models use the catalog. */
export class CompositeModelEligibility implements ModelEligibilityCheckPort {
  constructor(private readonly delegates: readonly ModelEligibilityCheckPort[]) {}

  async resolveEndpoint(input: { capability: string; artifactDigest: string; denyEpoch: number }): Promise<{ endpointRef: string; snapshotExpiresAt: number; external: boolean }> {
    let lastError: unknown;
    for (const delegate of this.delegates) {
      try {
        return await delegate.resolveEndpoint(input);
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError instanceof OrchestratorError) throw lastError;
    throw new OrchestratorError("FORBIDDEN", "The model artifact is not approved.");
  }

  currentDenyEpoch(): number {
    return this.delegates[0]?.currentDenyEpoch() ?? 0;
  }

  capabilityApproved(input: { artifactDigest: string; capability: string }): boolean {
    return this.delegates.some((delegate) => delegate.capabilityApproved?.(input) ?? false);
  }
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function buildRouterPrompt(text: string, history: readonly ConversationTurnRecord[]): string {
  const historyLines = history.map((turn) => `${turn.role}: ${turn.text}`).join("\n");
  return [
    "Classify the following user turn for a governed enterprise RAG assistant.",
    "Respond with exactly one JSON object, no prose, matching this schema:",
    // MULTI_RETRIEVAL is deliberately NOT offered here: classifyTurn (router.ts)
    // hard-rejects it as unsupported (bounded fan-out is not implemented), so
    // advertising it as a valid choice would only make real multi-topic
    // questions fail closed at whatever rate the model picks it.
    `{"route":"NO_RETRIEVAL"|"SINGLE_RETRIEVAL"|"CLARIFY","standalone_query":"<bounded standalone query, empty string if not applicable>","profile_selector":"<required only for SINGLE_RETRIEVAL>","reason_code":${JSON.stringify(ROUTER_REASON_CODES)},"confidence_bucket":"LOW"|"MEDIUM"|"HIGH"}`,
    "reason_code must be EXACTLY one of the listed values verbatim. Any other value is rejected and the turn falls back to the deterministic policy default.",
    historyLines ? `Conversation so far:\n${historyLines}` : "No prior conversation.",
    `Current turn: ${text}`,
  ].join("\n");
}

/**
 * Production router wiring (Doc 004 §23 / item 7 of the runtime-adapter/
 * adaptive-RAG reconciliation): the route-classification model step goes
 * through the SAME ModelGateway used for final generation — its own fresh
 * model-eligibility check, its own Scheduler reservation/fence (via
 * ModelGateway's `stepId`, distinct from final generation's), and its own
 * budget reservation — never a raw, unbudgeted HTTP call outside the
 * gateway. `routerModelRef` comes only from the signed route policy, never
 * from the employee-selected `model_ref`.
 */
export class GatewayTurnRouterLLMPort implements TurnRouterLLMPort {
  constructor(
    private readonly modelGateway: ModelGateway,
    private readonly modelSelection: ModelSelectionPort,
    private readonly modelEligibility: ModelEligibilityCheckPort,
  ) {}

  async classify(
    input: {
      text: string;
      history: readonly ConversationTurnRecord[];
      requestId: string;
      turnId: string;
      deadlineAt: number;
      routerModelRef: string;
      artifactDigest?: `sha256:${string}`;
      workflowReservationRef?: string;
      authority?: ModelGatewayAuthority;
    },
    signal: AbortSignal,
  ): Promise<unknown> {
    // `classifyRoute` (service.ts) resolves the model and mints every receipt in `authority`
    // BEFORE calling classifyTurn — never here, and never fabricated as a plain string. If
    // any is missing, the caller failed to authorize this dispatch; refuse rather than
    // improvise a fence.
    if (!input.artifactDigest || !input.authority || !input.workflowReservationRef) {
      throw new Error("Router dispatch requires a resolved model artifact digest, workflow reservation, and a full authority receipt bundle.");
    }
    const prompt = buildRouterPrompt(input.text, input.history);
    const generated = await this.modelGateway.generate({
      requestId: input.requestId,
      turnId: input.turnId,
      stepId: `step:route:${input.requestId}`,
      stepClass: "route",
      requestDigest: sha256(`route:${prompt}`),
      capability: "rag-route-classification",
      artifactDigest: input.artifactDigest,
      modelRef: input.routerModelRef,
      denyEpoch: this.modelEligibility.currentDenyEpoch(),
      workflowReservationRef: input.workflowReservationRef,
      deadlineAt: input.deadlineAt,
      scopeId: `scope:route:${input.requestId}`,
      chunks: [prompt],
      authority: input.authority,
    }, signal);
    void this.modelSelection;
    return JSON.parse(generated.output);
  }
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

// Dev/test sentinel: no CompanyRagProfile was configured; never a real profile identity.
const NO_COMPANY_RAG_PROFILE_DIGEST = `sha256:${"0".repeat(64)}` as const;

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
  /** The original inbound request, kept only until beginTurn/classifyRoute have consumed it inside the authorized workflow. */
  private readonly originalRequests = new Map<string, OrchestratorChatRequest>();
  /** The authorized bounded history read, taken during beginTurn (step 3) and consumed by classifyRoute (step 7). */
  private readonly pendingHistory = new Map<string, readonly ConversationTurnRecord[]>();
  /** Rich fail-closed reasons produced inside the authorized workflow (route policy / router fail-closed), surfaced back onto the HTTP-facing DENIED response since OrchestratorFailureCode is a small fixed enum. */
  private readonly denialReasons = new Map<string, string>();
  /** The top-level AuthorizeGenerate receipt minted in `authorizeGenerate`, reused as-is by every model dispatch within the turn (route classification and final generation both present the same receipt to Model Gateway). */
  private readonly generationDecisions = new Map<string, string>();
  private readonly auditAdmission: AuditAdmissionPort;
  private readonly generationContextFence: GenerationContextFencePort;
  private readonly outputGuards: OutputGuardPort;
  private readonly outputStore: OutputBlobStorePort;
  private readonly turnState: TurnStatePort;
  private readonly disclosure: DisclosureReservationPort;
  private readonly resultAuthorization: ResultAuthorizationPort;
  private readonly modelUseAuthority: ModelUseAuthorityPort;
  private readonly costAuthority: CostAuthorityPort;
  private readonly agentRunAuthority: AgentRunAuthorityPort;
  private readonly receiptVerifier: ReceiptVerifier;
  private readonly claimStore: ClaimStore;
  private readonly modelGateway: ModelGateway;
  private readonly now: () => number;
  private readonly maxPromptBytes: number;
  private readonly maxOutputBytes: number;
  private readonly turnRouter: TurnRouterLLMPort | undefined;
  private readonly conversationHistory: ConversationHistoryPort;
  private readonly modelSelection: ModelSelectionPort;
  private readonly employeeCatalog?: EmployeeApprovedCatalogPort;
  private readonly ragProfile?: CompanyRagProfile;
  /** Calculated once at construction; every request captures it before retrieval. */
  private readonly ragProfileDigest?: `sha256:${string}`;
  private readonly modelEligibility: ModelEligibilityCheckPort;
  private readonly maxHistoryTurns: number;
  private readonly disclosureCeiling: number;
  private readonly routePolicy: RoutePolicyPort;
  private readonly usageReceiptPublicKey?: string;
  private active = 0;

  constructor(private readonly options: ProductionOrchestratorOptions) {
    this.now = options.now ?? (() => Date.now());
    this.usageReceiptPublicKey = options.usageReceiptPublicKey;
    this.auditAdmission = options.auditAdmission ?? new LedgerAuditAdmissionPort(this.now);
    this.generationContextFence = options.generationContextFence ?? new FailClosedContextFencePort();
    this.outputGuards = options.outputGuards ?? new FailClosedOutputGuardPort();
    this.outputStore = options.outputStore ?? new FailClosedOutputBlobStorePort();
    this.turnState = options.turnState ?? new FailClosedTurnStatePort();
    this.disclosure = options.disclosure ?? new FailClosedDisclosureReservationPort();
    this.resultAuthorization = options.resultAuthorization ?? new FailClosedResultAuthorizationPort();
    this.maxPromptBytes = options.maxPromptBytes ?? 256 * 1024;
    this.maxOutputBytes = options.maxOutputBytes ?? 64 * 1024;
    this.maxHistoryTurns = options.maxHistoryTurns ?? 8;
    this.disclosureCeiling = options.disclosureCeiling ?? 1_000;
    this.conversationHistory = options.conversationHistory ?? new InMemoryConversationHistory();
    this.routePolicy = options.routePolicy ?? new FailClosedRoutePolicyPort();
    const modelArtifactDigest = options.modelArtifactDigest ?? `sha256:${"c".repeat(64)}`;
    this.modelSelection = options.modelSelection ?? new SingleDigestModelSelection(modelArtifactDigest);
    this.employeeCatalog = options.employeeCatalog;
    this.ragProfile = options.ragProfile;
    this.ragProfileDigest = this.ragProfile ? computeCompanyRagProfileDigest(this.ragProfile) : undefined;
    this.modelEligibility = options.modelEligibility ?? new SingleDigestModelEligibility(modelArtifactDigest, this.now);

    let leaseIssuer: AuthorityReceiptIssuer | undefined;
    if (options.devInMemoryAuthorities) {
      // Dev/test-only: one throwaway Ed25519 keypair backs every receipt this process issues
      // and verifies. Never reachable from main.ts's production entrypoint (see the option's
      // doc comment above) — production either gets real adapters or the FailClosed defaults
      // below, never this bundle.
      const devKeys = generateKeyPairSync("ed25519");
      const devIssuer = new AuthorityReceiptIssuer(devKeys.privateKey, { now: this.now });
      leaseIssuer = devIssuer;
      this.receiptVerifier = options.receiptVerifier ?? new Ed25519ReceiptVerifier(devKeys.publicKey, { now: this.now });
      this.claimStore = options.claimStore ?? new InMemoryClaimStore();
      this.modelUseAuthority = options.modelUseAuthority ?? new SubjectDeviceModelUseAuthority(
        { subject: () => ({ revision: 1, active: true, groups: [] }), device: () => ({ revision: 1, compliant: true }) },
        { resolveEndpoint: (input) => this.modelEligibility.resolveEndpoint(input), currentDenyEpoch: () => this.modelEligibility.currentDenyEpoch() },
        devIssuer,
        this.now,
      );
      // SQLite's special ":memory:" path: real relational/atomic logic, zero durability and
      // zero cross-replica sharing — exactly a "development/test profile", never production.
      this.costAuthority = options.costAuthority ?? new SqliteCostAuthority(":memory:", devIssuer, this.now);
      this.agentRunAuthority = options.agentRunAuthority ?? new SqliteAgentRunAuthority(":memory:", devIssuer, this.now);
    } else {
      this.receiptVerifier = options.receiptVerifier ?? new FailClosedReceiptVerifier();
      this.claimStore = options.claimStore ?? new FailClosedClaimStore();
      this.modelUseAuthority = options.modelUseAuthority ?? new FailClosedModelUseAuthorityPort();
      this.costAuthority = options.costAuthority ?? new FailClosedCostAuthority();
      this.agentRunAuthority = options.agentRunAuthority ?? new FailClosedAgentRunAuthority();
    }

    const attempts = options.runtimeAttempts ?? (options.devInMemoryAuthorities
      ? new RelationalRuntimeAttemptStore(createSqlitePgCompatPool(":memory:"))
      : new FailClosedRuntimeAttemptStore());
    const scheduler = options.scheduler ?? new GpuScheduler(options.gpuCapacity ?? 8, this.now, leaseIssuer);
    const runtime = options.runtime ?? new InferenceAdapter();
    this.modelGateway = new ModelGateway(
      { resolve: (input) => this.modelEligibility.resolveEndpoint(input) },
      {
        reserve: async (input) => scheduler.reserve(input),
        start: async (...args) => { await Promise.resolve(scheduler.start(...args)); },
        release: async (...args) => { await Promise.resolve(scheduler.release(...args)); },
      },
      { execute: (input, signal) => runtime.execute(input, signal) },
      this.receiptVerifier,
      this.claimStore,
      attempts,
      this.now,
    );
    this.turnRouter = options.turnRouter ?? (options.useGatewayTurnRouter ? new GatewayTurnRouterLLMPort(this.modelGateway, this.modelSelection, this.modelEligibility) : undefined);
    this.orchestrator = new Orchestrator(this.dependencies(), { now: this.now, maxOutputBytes: this.maxOutputBytes });
  }

  async handleChat(request: OrchestratorChatRequest, signal: AbortSignal): Promise<OrchestratorChatResponse> {
    if (request.retryBudget !== 0) {
      return { status: "FAILED", requestId: request.requestId, error: "NON_IDEMPOTENT_RETRY_REJECTED" };
    }
    if (this.active >= (this.options.maxActiveRequests ?? 32)) {
      return { status: "FAILED", requestId: request.requestId, error: "OVERLOADED" };
    }
    this.active += 1;
    try {
      if (this.employeeCatalog) await this.employeeCatalog.refresh();
      if (request.modelRef && this.employeeCatalog) {
        this.employeeCatalog.resolve({ modelRef: request.modelRef, capability: "grounded-assistant" });
      } else if (request.modelRef && this.ragProfile && !employeeModelDoesNotAffectRag(this.ragProfile, request.modelRef)) {
        throw new OrchestratorError("FORBIDDEN", "The requested model is not eligible for this company profile.");
      }
      // Session/assertion validity is checked at the HTTP/session layer before this is
      // ever called; here the workflow itself begins with nothing but a bare requestId
      // handed to the Orchestrator. Everything downstream of authorizeGenerate — the
      // authorized history read, route classification (including its own model dispatch),
      // retrieval, and final generation — runs inside the single authorized Orchestrator
      // workflow below, in that order. Route policy resolution, the router's model call,
      // and Memory begin/history-read used to run here, BEFORE authorizeGenerate ever
      // fired; they now run inside `dependencies().beginTurn` / `dependencies().classifyRoute`,
      // which the Orchestrator only reaches after authorizeGenerate has succeeded.
      this.originalRequests.set(request.requestId, request);
      const result = await this.orchestrator.execute({
        requestId: request.requestId,
        subjectRef: request.subjectRef,
        deviceRef: request.deviceRef,
        conversationRef: request.conversationRef,
        inputDigest: request.queryDigest,
        deadlineAt: request.deadlineAt,
      }, signal);
      return this.toResponse(request.requestId, result);
    } catch (error) {
      if (error instanceof OrchestratorError) {
        if (process.env.NODE_ENV === "development") {
          console.error(`[orchestrator deny] ${request.requestId}: ${error.message}`);
        }
        return {
          status: "DENIED",
          requestId: request.requestId,
          error: error.code,
          ...(process.env.NODE_ENV === "development" ? { reason: error.message } : {}),
        };
      }
      throw error;
    } finally {
      this.active -= 1;
      this.releaseRequestState(request.requestId);
      this.denialReasons.delete(request.requestId);
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
      resourceRefs: resourceRefsOf(stored),
      indexGeneration: stored.indexGeneration,
      profileVersion: state.ragProfileVersion ?? 0,
      profileDigest: state.ragProfileDigest ?? NO_COMPANY_RAG_PROFILE_DIGEST,
      toolCallRef: input.toolCallRef,
    }, signal);
  }

  private dependencies(): OrchestratorDependencies {
    // The async generator below must retain the owning service instance after
    // this method returns its dependency object.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const service = this;
    return {
      authorizeGenerate: async (request, signal) => {
        // Fresh top-level PDP Authorize(ai.generate) (step 2) — the FIRST thing the workflow
        // does, before beginTurn, before any history read, before route classification's
        // model dispatch, and before retrieval or final generation. This is now a real
        // authority call, not a nonempty/deadline placeholder: `SubjectDeviceModelUseAuthority`
        // checks live subject/device facts and issues a signed, expiring, single-use
        // `authorize_generate` receipt bound to every field named below. That receipt is what
        // every model dispatch in this turn presents to Model Gateway as its `generationDecision`
        // — Model Gateway verifies it fresh each time, not a cached boolean.
        const original = service.originalRequests.get(request.requestId);
        if (!original) throw new OrchestratorError("FORBIDDEN", "Request context is unavailable.");
        let receipt;
        try {
          receipt = await this.modelUseAuthority.authorizeGenerate({
            requestId: request.requestId,
            requestDigest: requestDigest(request),
            subjectRef: request.subjectRef,
            deviceRef: request.deviceRef,
            sessionRef: original.sessionRef,
            applicationRef: original.applicationId,
            workspaceRef: original.workspaceRef,
            purposeRef: original.purposeRef,
            requestClass: original.retrievalClass,
            deadlineAt: request.deadlineAt,
          }, signal);
        } catch {
          throw new OrchestratorError("FORBIDDEN", "The generation request is not authorized.");
        }
        service.generationDecisions.set(request.requestId, receipt.token);
      },
      beginTurn: async (request, signal) => {
        const original = service.originalRequests.get(request.requestId);
        if (!original) throw new OrchestratorError("FORBIDDEN", "Request context is unavailable.");
        const turn = { turnId: `turn:${request.requestId}`, sequence: 1 };
        this.turns.set(request.requestId, turn);

        // Authorized bounded history read (step 3) — this and Memory's beginTurn now run
        // strictly after authorizeGenerate succeeded above, never before it.
        const history = await this.conversationHistory.get({
          subjectRef: original.subjectRef,
          requestId: original.requestId,
          sessionRef: original.sessionRef,
          deviceRef: original.deviceRef,
          conversationRef: original.conversationRef,
          queryDigest: original.queryDigest,
          limit: this.maxHistoryTurns,
          memorySessionAssertion: original.memorySessionAssertion,
        }, signal);
        await this.conversationHistory.beginTurn({
          requestId: original.requestId,
          subjectRef: original.subjectRef,
          sessionRef: original.sessionRef,
          deviceRef: original.deviceRef,
          conversationRef: original.conversationRef,
          turnId: turn.turnId,
          inputDigest: original.queryDigest,
          inputText: original.inputText,
          memorySessionAssertion: original.memorySessionAssertion,
        }, signal);
        this.pendingHistory.set(request.requestId, history);

        // Seed request state with everything known before route classification runs;
        // classifyRoute below fills in the route-derived fields once it has them.
        this.requestStates.set(request.requestId, {
          inputText: original.inputText,
          inputDigest: original.queryDigest,
          subjectRef: original.subjectRef,
          deviceRef: original.deviceRef,
          sessionRef: original.sessionRef,
          memorySessionAssertion: original.memorySessionAssertion,
          conversationRef: original.conversationRef,
          applicationRef: original.applicationId,
          purposeRef: original.purposeRef,
          route: "GENERAL_CONVERSATION",
          queryText: original.inputText,
          modelRef: original.modelRef,
          routeOutput: "NO_RETRIEVAL",
          attemptedRoute: "NO_RETRIEVAL",
          attemptedReasonCode: "router_unavailable",
          attemptedConfidenceBucket: "LOW",
          groundingRequired: false,
          allowedProfileSetDigest: sha256(""),
          routePolicyRevision: 0,
          routePolicyDigest: sha256(""),
          enforcementOverride: false,
        });
        return turn;
      },
      reserveWorkflowBudget: async (request, turn, signal) => {
        const original = service.originalRequests.get(request.requestId);
        if (!original) throw new OrchestratorError("FORBIDDEN", "Request context is unavailable.");
        let routePolicy: RoutePolicyResult;
        try {
          routePolicy = await this.routePolicy.resolve({
            requestId: original.requestId,
            subjectRef: original.subjectRef,
            applicationRef: original.applicationId,
            workspaceRef: original.workspaceRef,
            purposeRef: original.purposeRef,
            requestClass: original.retrievalClass,
          }, signal);
        } catch (error) {
          this.denialReasons.set(request.requestId, error instanceof RoutePolicyError ? error.code : "ROUTE_POLICY_UNAVAILABLE");
          throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Route policy is unavailable.");
        }
        const limits = resolveWorkflowLimits(routePolicy);
        const reservationRef = `workflow:${request.requestId}`;
        const profile: SignedWorkflowProfile = {
          applicationRef: original.applicationId,
          workspaceRef: original.workspaceRef,
          purposeRef: original.purposeRef,
          requestClass: original.retrievalClass,
          deadlineAt: request.deadlineAt,
          reservationRef,
          routePolicyRevision: routePolicy.routePolicyRevision,
          routePolicyDigest: routePolicy.routePolicyDigest,
          allowedProfileSetDigest: routePolicy.allowedProfileSetDigest,
          allowedStepClasses: ALLOWED_AGENT_STEP_CLASSES,
          limits,
        };
        const digest = workflowProfileDigest(profile);
        const existing = this.requestStates.get(request.requestId);
        if (existing) {
          this.requestStates.set(request.requestId, {
            ...existing,
            workflowProfileDigest: digest,
            workflowLimits: limits,
            routePolicyResult: routePolicy,
            groundingRequired: routePolicy.groundingRequired,
            allowedProfileSetDigest: routePolicy.allowedProfileSetDigest,
            routePolicyRevision: routePolicy.routePolicyRevision,
            routePolicyDigest: routePolicy.routePolicyDigest,
          });
        }
        await this.costAuthority.reserveWorkflowBudget({
          requestId: request.requestId,
          turnId: turn.turnId,
          reservationRef,
          idempotencyKey: request.requestId,
          subEnvelopes: limits,
          expiresAt: request.deadlineAt,
          workflowProfileDigest: digest,
        }, signal);
        return reservationRef;
      },
      classifyRoute: async (request, turn, run, workflowReservationRef, signal) => {
        const original = service.originalRequests.get(request.requestId);
        if (!original) throw new OrchestratorError("FORBIDDEN", "Request context is unavailable.");
        const history = service.pendingHistory.get(request.requestId) ?? [];

        // Signed route policy was already resolved during reserveWorkflowBudget so the
        // Cost reservation and Agent-run profile digest bind the same signed Doc 014 profile.
        const cachedPolicy = this.requestStates.get(request.requestId)?.routePolicyResult;
        let routePolicy: RoutePolicyResult;
        try {
          routePolicy = cachedPolicy ?? await this.routePolicy.resolve({
            requestId: original.requestId,
            subjectRef: original.subjectRef,
            applicationRef: original.applicationId,
            workspaceRef: original.workspaceRef,
            purposeRef: original.purposeRef,
            requestClass: original.retrievalClass,
          }, signal);
        } catch (error) {
          this.denialReasons.set(request.requestId, error instanceof RoutePolicyError ? error.code : "ROUTE_POLICY_UNAVAILABLE");
          throw new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Route policy is unavailable.");
        }

        // Route classification (step 7) — this is the first admitted MODEL step of the
        // authorized workflow: it runs strictly after authorizeGenerate, beginTurn, the
        // workflow Cost reservation, and beginAgentRun above, never before them.
        // `this.turnRouter` is undefined unless `turnRouter` or `useGatewayTurnRouter` was
        // explicitly set at construction. Production wiring (main.ts) sets
        // `useGatewayTurnRouter: true` and requires a working router model configuration
        // to start — the regex/heuristic fallback in router.ts is never the production
        // router. Test/dev callers that don't set either option get that documented
        // deterministic fallback instead of an unconfigured real model dispatch attempt.
        //
        // Live model-use authorization happens here, per dispatch, only when a real router
        // will actually run — the deterministic fallback path never touches a model, so it
        // never needs AuthorizeModelUse/Cost/Agent-step authority either.
        let artifactDigest: `sha256:${string}` | undefined;
        let authority: ModelGatewayAuthority | undefined;
        let routeStepId: string | undefined;
        let routeStepReceipt: SignedAuthorityReceipt | undefined;
        let routeCostReceipt: SignedAuthorityReceipt | undefined;
        // Model-use/Cost/Agent-step authorization applies specifically when the router will
        // actually dispatch through Model Gateway (`GatewayTurnRouterLLMPort`) — other
        // `TurnRouterLLMPort` implementations (the deterministic fallback; test/dev doubles
        // that simulate a router's wire response directly; `HttpTurnRouterLLMPort`, which
        // dispatches over HTTP to a scripted stand-in server outside Model Gateway — see
        // `routerWireIntegration.test.ts`) never touch Model Gateway and so have nothing for
        // this authority to admit.
        if (this.turnRouter instanceof GatewayTurnRouterLLMPort) {
          const resolved = this.modelSelection.resolve({ modelRef: routePolicy.routerModelRef, capability: "rag-route-classification" });
          artifactDigest = resolved.artifactDigest;
          const stepId = `step:route:${request.requestId}`;
          const generationDecision = service.generationDecisions.get(request.requestId);
          if (!generationDecision) throw new OrchestratorError("FORBIDDEN", "No top-level generation authorization is available for this turn.");
          let modelUseReceipt;
          try {
            modelUseReceipt = await this.modelUseAuthority.authorizeModelUse({
              requestId: request.requestId,
              turnId: turn.turnId,
              stepId,
              stepClass: "route",
              requestDigest: requestDigest(request),
              modelRef: routePolicy.routerModelRef,
              artifactDigest,
              capability: "rag-route-classification",
              subjectRef: request.subjectRef,
              applicationRef: original.applicationId,
              workspaceRef: original.workspaceRef,
              purposeRef: original.purposeRef,
              requestClass: original.retrievalClass,
              deadlineAt: request.deadlineAt,
            }, signal);
          } catch {
            throw new OrchestratorError("FORBIDDEN", "The router model is not authorized for this dispatch.");
          }
          const routeUnits = estimateModelUnits(Buffer.byteLength(original.inputText, "utf8"), this.requestStates.get(request.requestId)?.workflowLimits?.route.maximumUnits ?? 4_096);
          const costReceipt = await this.costAuthority.consumeSubEnvelope({
            reservationRef: workflowReservationRef,
            subEnvelope: "route",
            units: routeUnits,
            requestId: request.requestId,
            turnId: turn.turnId,
            stepId,
            idempotencyKey: stepId,
            expiresAt: request.deadlineAt,
          }, signal);
          const stepReceipt = await this.agentRunAuthority.reserveAgentStep({
            runId: run.runId,
            requestId: request.requestId,
            turnId: turn.turnId,
            stepId,
            stepClass: "route",
            stepIndex: 0,
            modelRef: routePolicy.routerModelRef,
            artifactDigest,
            capability: "rag-route-classification",
            workflowReservationRef,
            subEnvelope: "route",
            modelAuthorizationDigest: sha256(modelUseReceipt.token),
            idempotencyKey: stepId,
            deadlineAt: request.deadlineAt,
          }, signal);
          authority = { generationDecision, modelUseDecision: modelUseReceipt.token, costConsumption: costReceipt.token, agentStep: stepReceipt.token };
          routeStepId = stepId;
          routeStepReceipt = stepReceipt;
          routeCostReceipt = costReceipt;
        }

        const classified = await classifyTurn(
          { text: original.inputText, history, requestId: original.requestId, turnId: turn.turnId, deadlineAt: original.deadlineAt, artifactDigest, workflowReservationRef, authority },
          this.turnRouter,
          routePolicy,
          signal,
        );

        // The route step actually dispatched (ModelGateway claimed its agent-step receipt
        // and returned output) — drive the Doc 014/019 lifecycles past RESERVED so
        // GetAgentRunStatus/GetWorkflowBudgetStatus report the real, durable outcome rather
        // than staying open forever.
        if (routeStepId && routeStepReceipt && routeCostReceipt) {
          await this.agentRunAuthority.consumeAgentStep(run.runId, routeStepId, routeStepReceipt.claims.receiptId, signal);
          await this.agentRunAuthority.finalizeAgentStep(run.runId, routeStepId, signal);
          await this.costAuthority.finalizeSubEnvelope({
            reservationRef: workflowReservationRef,
            subEnvelope: "route",
            measuredUnits: estimateModelUnits(Buffer.byteLength(original.inputText, "utf8"), this.requestStates.get(request.requestId)?.workflowLimits?.route.maximumUnits ?? 4_096),
            idempotencyKey: routeStepId,
          }, signal);
        }

        if (classified.enforcement) {
          const requestState = this.requestStates.get(request.requestId);
          if (!requestState) throw new OrchestratorError("FORBIDDEN", "Request profile lineage is unavailable.");
          // Durably recorded BEFORE the resulting route is acted on (step 8 / Doc 004 §23
          // step 4) — a synchronous audit admission, not a best-effort log, carrying every
          // named field (not a bare kind+digest, and never concatenated into an opaque
          // string).
          await this.auditAdmission.admit({
            kind: "route_override",
            requestId: original.requestId,
            turnId: turn.turnId,
            inputDigest: original.queryDigest,
            ragProfileVersion: requestState.ragProfileVersion ?? 0,
            ragProfileDigest: requestState.ragProfileDigest ?? NO_COMPANY_RAG_PROFILE_DIGEST,
            routeOverride: {
              attemptedRoute: classified.enforcement.attemptedRoute,
              attemptedReasonCode: classified.enforcement.attemptedReasonCode,
              attemptedConfidenceBucket: classified.enforcement.attemptedConfidenceBucket,
              attemptedProfileSelector: classified.enforcement.attemptedProfileSelector,
              effectiveRoute: classified.routeOutput,
              effectiveProfileSelector: classified.profileSelector,
              groundingRequired: routePolicy.groundingRequired,
              routePolicyRevision: routePolicy.routePolicyRevision,
              routePolicyDigest: routePolicy.routePolicyDigest,
              allowedProfileSetDigest: routePolicy.allowedProfileSetDigest,
              enforcementOverride: true,
              overrideReason: classified.enforcement.overrideReason,
            },
          }, signal);
        }

        if (classified.failClosed) {
          this.denialReasons.set(request.requestId, classified.failClosed.reason.toUpperCase());
          throw new OrchestratorError("FORBIDDEN", `Route classification failed closed: ${classified.failClosed.reason}`);
        }

        const decision = classified.decision;
        const existing = this.requestStates.get(request.requestId);
        if (!existing) throw new OrchestratorError("FORBIDDEN", "Request state is unavailable.");
        this.requestStates.set(request.requestId, {
          ...existing,
          route: decision.route,
          queryText: decision.queryText,
          clarifyQuestion: decision.clarifyQuestion,
          routeOutput: classified.routeOutput,
          profileSelector: classified.profileSelector,
          // Attempted == effective when no override occurred — always populated so
          // TerminalEvidence carries a positive "no override" statement, not an absence.
          attemptedRoute: classified.enforcement?.attemptedRoute ?? classified.routeOutput,
          attemptedReasonCode: classified.enforcement?.attemptedReasonCode ?? classified.reasonCode,
          attemptedConfidenceBucket: classified.enforcement?.attemptedConfidenceBucket ?? classified.confidenceBucket,
          attemptedProfileSelector: classified.enforcement?.attemptedProfileSelector ?? classified.profileSelector,
          groundingRequired: routePolicy.groundingRequired,
          allowedProfileSetDigest: routePolicy.allowedProfileSetDigest,
          routePolicyRevision: routePolicy.routePolicyRevision,
          routePolicyDigest: routePolicy.routePolicyDigest,
          enforcementOverride: Boolean(classified.enforcement),
          overrideReason: classified.enforcement?.overrideReason,
        });
        return { route: decision.route };
      },
      resolveContext: async (request, turn, _route, signal) => {
        const requestState = this.requestStates.get(request.requestId);
        if (!requestState) throw new OrchestratorError("FORBIDDEN", "Input text is unavailable for retrieval.");
        const retrievalCap = requestState.workflowLimits?.retrieval.maximumUnits ?? 100;
        const candidateLimit = Math.min(100, Math.max(1, Math.floor(retrievalCap)));
        // The route policy (groundingPolicy.ts) governs which profile_selector a request may
        // use; the company RAG profile governs what that selector actually resolves to. Both
        // must agree -- a selector the policy allowed but the profile never defined fails closed
        // rather than falling back to a guessed corpus/mode. router.ts's parseRouterWireDecision
        // always populates profileSelector for SINGLE_RETRIEVAL/MULTI_RETRIEVAL routes (the only
        // routes that reach resolveContext), so an undefined selector here is itself a fail-closed
        // condition when a profile is configured -- never a "default" guess.
        const selector = requestState.profileSelector;
        const retrievalProfile = selector ? this.ragProfile?.retrievalProfiles[selector] : undefined;
        if (this.ragProfile && !retrievalProfile) {
          throw new OrchestratorError("FORBIDDEN", `No retrieval profile configured for selector "${selector ?? "(none)"}".`);
        }
        const corpusRef = retrievalProfile?.corpusRef ?? "enterprise-docs";
        const mode = retrievalProfile?.mode ?? "hybrid";
        const ragProfileVersion = this.ragProfile?.profileVersion ?? 0;
        const ragProfileDigest = this.ragProfileDigest ?? NO_COMPANY_RAG_PROFILE_DIGEST;
        const hasConfiguredRagProfile = this.ragProfile !== undefined && this.ragProfileDigest !== undefined;
        const capturedRequestState: RequestState = {
          ...requestState,
          ragProfileVersion,
          ragProfileDigest,
          hasConfiguredRagProfile,
          resolvedCorpusRef: corpusRef,
          resolvedMode: mode,
        };
        this.requestStates.set(request.requestId, capturedRequestState);
        await this.costAuthority.consumeSubEnvelope({
          reservationRef: `workflow:${request.requestId}`,
          subEnvelope: "retrieval",
          units: candidateLimit,
          requestId: request.requestId,
          turnId: turn.turnId,
          stepId: `step:retrieval:${request.requestId}`,
          idempotencyKey: `step:retrieval:${request.requestId}`,
          expiresAt: request.deadlineAt,
        }, signal);
        const retrieval = await this.options.retrieval.retrieve({
          request_id: request.requestId,
          turn_id: turn.turnId,
          caller_workload_ref: "ai-orchestrator",
          subject_ref: request.subjectRef,
          session_ref: requestState.sessionRef,
          device_ref: request.deviceRef,
          application_id: "lens-employee-client",
          query_digest: sha256(requestState.queryText),
          query_text: requestState.queryText,
          purpose_ref: "assistant",
          retrieval_class: "enterprise-grounded",
          corpus_ref: capturedRequestState.resolvedCorpusRef!,
          mode: capturedRequestState.resolvedMode as RetrievalRequest["mode"],
          profile_version: capturedRequestState.ragProfileVersion!,
          profile_digest: capturedRequestState.ragProfileDigest!,
          candidate_limit: candidateLimit,
          deadline_at: request.deadlineAt,
          cancellation: signal.aborted,
          bulkhead: "interactive",
          visibility_minimum: 0,
        }, signal);
        const measured = retrieval.status === "context" ? Math.max(1, retrieval.sources.length) : retrieval.status === "no_context" ? 1 : candidateLimit;
        if (retrieval.status === "denied_policy" || retrieval.status === "failed_downstream") {
          throw new OrchestratorError(retrieval.status === "denied_policy" ? "FORBIDDEN" : "DEPENDENCY_UNAVAILABLE", retrieval.status === "denied_policy" ? "Retrieval denied context." : "Retrieval failed.");
        }
        await this.costAuthority.finalizeSubEnvelope({
          reservationRef: `workflow:${request.requestId}`,
          subEnvelope: "retrieval",
          measuredUnits: conservativeMeasuredUnits(candidateLimit, measured, true),
          idempotencyKey: `step:retrieval:${request.requestId}`,
        }, signal);
        if (retrieval.status === "no_context") return { digest: sha256("no-context"), noContext: true };
        const capturedProfile = this.requestStates.get(request.requestId);
        if (!capturedProfile?.ragProfileDigest || capturedProfile.ragProfileVersion === undefined) {
          throw new OrchestratorError("FORBIDDEN", "Request profile lineage is unavailable.");
        }
        const hasProfileLineage =
          retrieval.manifest.profile_version !== undefined || retrieval.manifest.profile_digest !== undefined ||
          retrieval.profile_version !== undefined || retrieval.profile_digest !== undefined;
        if (
          (hasProfileLineage && (
            retrieval.manifest.profile_version !== capturedProfile.ragProfileVersion ||
            retrieval.manifest.profile_digest !== capturedProfile.ragProfileDigest ||
            retrieval.profile_version !== capturedProfile.ragProfileVersion ||
            retrieval.profile_digest !== capturedProfile.ragProfileDigest
          )) ||
          (!hasProfileLineage && capturedProfile.hasConfiguredRagProfile)
        ) {
          throw new OrchestratorError("FORBIDDEN", "Retrieval profile lineage does not match the request.");
        }
        this.contexts.set(request.requestId, {
          manifestDigest: retrieval.manifest.digest,
          manifestExpiresAt: retrieval.manifest.expires_at,
          sources: retrieval.sources,
          indexGeneration: retrieval.index_generation,
        });
        return { digest: retrieval.manifest.digest, noContext: false };
      },
      authorizeContextUse: async (request, context) => {
        const stored = this.contexts.get(request.requestId);
        if (context.noContext || !stored || stored.manifestDigest !== context.digest || stored.manifestExpiresAt <= this.now()) {
          throw new OrchestratorError("FORBIDDEN", "Context use fence is stale.");
        }
      },
      beginAgentRun: async (request, turn, workflowReservationRef, signal) => {
        const runId = `run:${request.requestId}`;
        const storedDigest = this.requestStates.get(request.requestId)?.workflowProfileDigest;
        if (!storedDigest) throw new OrchestratorError("FORBIDDEN", "Workflow profile digest is unavailable.");
        const { envelopeRevision } = await this.agentRunAuthority.beginAgentRun({
          requestId: request.requestId,
          turnId: turn.turnId,
          runId,
          workflowReservationRef,
          workflowProfileDigest: storedDigest,
          idempotencyKey: request.requestId,
          expiresAt: request.deadlineAt,
        }, signal);
        return { runId, envelopeRevision };
      },
      admitAudit: async (kind, request, turn, signal) => {
        const requestState = service.requestStates.get(request.requestId);
        if (!requestState) throw new OrchestratorError("FORBIDDEN", "Request profile lineage is unavailable.");
        const receipt = await this.auditAdmission.admit({
          kind,
          requestId: request.requestId,
          turnId: turn.turnId,
          inputDigest: request.inputDigest,
          ragProfileVersion: requestState.ragProfileVersion ?? 0,
          ragProfileDigest: requestState.ragProfileDigest ?? NO_COMPANY_RAG_PROFILE_DIGEST,
        }, signal);
        return receipt.receiptDigest;
      },
      generate: async function* (input, signal) {
        const requestState = service.requestStates.get(input.request.requestId);
        if (!requestState) throw new OrchestratorError("FORBIDDEN", "Input text is unavailable for prompt composition.");

        // Ungrounded routes never touch Retrieval or the model: their output is
        // fixed and deterministic, so there is nothing to fence or generate.
        if (requestState.route === "ACKNOWLEDGEMENT") {
          // A closed-set acknowledgement ("okay", "got it", "thanks", "yes", ...)
          // gets a neutral, content-free response — never a specific reply like
          // "You're welcome.", which presumes the user was thanking the
          // assistant. "okay"/"yes" are not thanks; a fixed presumptive reply
          // was a real semantics bug, not a stylistic choice.
          yield "Noted.";
          return;
        }
        if (requestState.route === "CLARIFICATION_REQUIRED") {
          yield requestState.clarifyQuestion ?? "Could you say more about what you'd like to know?";
          return;
        }
        const needsGroundedContext = requestState.route === "KNOWLEDGE_QUERY" || requestState.route === "CONTEXTUAL_FOLLOW_UP";
        let sourceLines: string[] = [];
        if (needsGroundedContext) {
          const stored = service.contexts.get(input.request.requestId);
          if (!stored || stored.manifestDigest !== input.context.digest || stored.manifestExpiresAt <= service.now()) {
            throw new OrchestratorError("FORBIDDEN", "Context expired or changed before generation.");
          }
          await service.revalidateStoredContext({
            requestId: input.request.requestId,
            turnId: service.turns.get(input.request.requestId)?.turnId ?? `turn:${input.request.requestId}`,
            subjectRef: input.request.subjectRef,
            deviceRef: input.request.deviceRef,
            sessionRef: requestState.sessionRef,
            contextDigest: input.context.digest,
            manifestExpiresAt: stored.manifestExpiresAt,
            boundary: "generation_start",
            resourceRefs: resourceRefsOf(stored),
            indexGeneration: stored.indexGeneration,
            profileVersion: requestState.ragProfileVersion ?? 0,
            profileDigest: requestState.ragProfileDigest ?? NO_COMPANY_RAG_PROFILE_DIGEST,
          }, signal);
          sourceLines = stored.sources.map((source, index) => `[${index + 1}] ${source.text}`);
        }
        const prompt = [
          needsGroundedContext
            ? `Answer using only the authorized context for request ${input.request.requestId}.`
            : "Answer conversationally. No enterprise document context was retrieved for this turn; do not claim to cite any source.",
          `Question: ${requestState.queryText}`,
          ...sourceLines,
        ];
        if (Buffer.byteLength(prompt.join(""), "utf8") > service.maxPromptBytes) {
          throw new OrchestratorError("OVERLOADED", "The authorized prompt exceeded its bounded context envelope.");
        }
        const { artifactDigest } = (service.employeeCatalog && requestState.modelRef
          ? service.employeeCatalog
          : service.modelSelection
        ).resolve({ modelRef: requestState.modelRef ?? "", capability: "grounded-assistant" });
        const original = service.originalRequests.get(input.request.requestId);
        if (!original) throw new OrchestratorError("FORBIDDEN", "Request context is unavailable for final-generation authorization.");
        const turnId = service.turns.get(input.request.requestId)?.turnId ?? `turn:${input.request.requestId}`;
        const modelRef = requestState.modelRef ?? "default";
        const stepId = `step:final:${input.request.requestId}`;
        const generationDecision = service.generationDecisions.get(input.request.requestId);
        if (!generationDecision) throw new OrchestratorError("FORBIDDEN", "No top-level generation authorization is available for this turn.");

        // Live model-use authorization for final generation (step 11) — a fresh, exact
        // AuthorizeModelUse(employee-selected model_ref) call, distinct from route
        // classification's (different stepId/stepClass/capability/sub-envelope), so a model
        // approved for `rag-route-classification` cannot ride final generation's dispatch and
        // vice versa.
        let modelUseReceipt;
        try {
          modelUseReceipt = await service.modelUseAuthority.authorizeModelUse({
            requestId: input.request.requestId,
            turnId,
            stepId,
            stepClass: "final_generation",
            requestDigest: requestDigest(input.request),
            modelRef,
            artifactDigest,
            capability: "grounded-assistant",
            subjectRef: input.request.subjectRef,
            applicationRef: original.applicationId,
            workspaceRef: original.workspaceRef,
            purposeRef: original.purposeRef,
            requestClass: original.retrievalClass,
            deadlineAt: input.request.deadlineAt,
          }, signal);
        } catch {
          throw new OrchestratorError("FORBIDDEN", "The selected model is not authorized for final generation.");
        }
        const finalUnits = estimateModelUnits(Buffer.byteLength(prompt.join(""), "utf8"), requestState.workflowLimits?.final_generation.maximumUnits ?? 8_192);
        const costReceipt = await service.costAuthority.consumeSubEnvelope({
          reservationRef: input.workflowReservationRef,
          subEnvelope: "final_generation",
          units: finalUnits,
          requestId: input.request.requestId,
          turnId,
          stepId,
          idempotencyKey: stepId,
          expiresAt: input.request.deadlineAt,
        }, signal);
        const stepReceipt = await service.agentRunAuthority.reserveAgentStep({
          runId: input.run.runId,
          requestId: input.request.requestId,
          turnId,
          stepId,
          stepClass: "final_generation",
          stepIndex: 1,
          modelRef,
          artifactDigest,
          capability: "grounded-assistant",
          workflowReservationRef: input.workflowReservationRef,
          subEnvelope: "final_generation",
          modelAuthorizationDigest: sha256(modelUseReceipt.token),
          idempotencyKey: stepId,
          deadlineAt: input.request.deadlineAt,
        }, signal);

        let generated;
        try {
          generated = await service.modelGateway.generate({
            requestId: input.request.requestId,
            turnId,
            stepId,
            stepClass: "final_generation",
            requestDigest: requestDigest(input.request),
            capability: "grounded-assistant",
            artifactDigest,
            modelRef,
            denyEpoch: service.modelEligibility.currentDenyEpoch(),
            workflowReservationRef: input.workflowReservationRef,
            deadlineAt: input.request.deadlineAt,
            scopeId: `scope:${input.request.subjectRef}`,
            chunks: prompt,
            authority: { generationDecision, modelUseDecision: modelUseReceipt.token, costConsumption: costReceipt.token, agentStep: stepReceipt.token },
          }, signal);
        } catch (error) {
          throw mapModelGatewayError(error);
        }
        if (Buffer.byteLength(generated.output, "utf8") > service.maxOutputBytes) {
          throw new OrchestratorError("OVERLOADED", "The generated output exceeded its approved byte envelope.");
        }
        // Final generation actually dispatched — drive the Doc 014/019 lifecycles past
        // RESERVED, matching the same closure the route step gets in classifyRoute.
        await service.agentRunAuthority.consumeAgentStep(input.run.runId, stepId, stepReceipt.claims.receiptId, signal);
        await service.agentRunAuthority.finalizeAgentStep(input.run.runId, stepId, signal);
        await service.costAuthority.finalizeSubEnvelope({
          reservationRef: input.workflowReservationRef,
          subEnvelope: "final_generation",
          measuredUnits: sidecarVerifiedUnits(finalUnits, generated.receipt, {
            reservationId: generated.receipt.reservationId,
            requestId: input.request.requestId,
            turnId,
            stepId,
            fence: generated.receipt.fence,
            artifactDigest,
            endpointGeneration: generated.receipt.endpointGeneration,
          }, service.usageReceiptPublicKey),
          idempotencyKey: stepId,
        }, signal);
        yield generated.output;
      },
      closeAgentRun: async (run, signal) => {
        // Real Doc 014 close, followed by a digest of the authority's own post-close status
        // (never a bare fabricated `closed:${runId}` string) — the correlation token
        // downstream stages fold into their own receipts (see stageOutput's guardReceipt).
        await this.agentRunAuthority.closeAgentRun(run.runId, signal);
        const status = await this.agentRunAuthority.getAgentRunStatus(run.runId, signal);
        const requestId = run.runId.replace(/^run:/, "");
        await this.costAuthority.closeWorkflowBudget(`workflow:${requestId}`, signal);
        return sha256(`${status.runId}|${status.state}|${status.envelopeRevision}`);
      },
      stageOutput: async (turn, output, runCloseReceipt, signal): Promise<StagedOutput> => {
        const requestId = turn.turnId.replace(/^turn:/, "");
        const requestState = service.requestStates.get(requestId);
        if (!requestState) throw new OrchestratorError("FORBIDDEN", "Cannot stage output without live request context.");
        const context = service.contexts.get(requestId);
        if (Buffer.byteLength(output, "utf8") > service.maxOutputBytes) {
          throw new OrchestratorError("OVERLOADED", "The generated output exceeded its approved byte envelope.");
        }
        const outputDigest = sha256(output);
        const guard = await service.outputGuards.inspect({
          requestId,
          subjectRef: requestState.subjectRef,
          output,
          outputDigest,
          sourceClassifications: context ? context.sources.map((source) => source.classification_ref) : [],
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
          output,
        });
        return {
          outputRef: blob.outputRef,
          outputDigest: blob.outputDigest,
          commitProof: blob.commitProof,
        };
      },
      reserveDisclosure: async (request, staged, runCloseReceipt, signal) => {
        const storedOutput = service.requireStoredOutput(request.requestId, staged);
        const requestState = service.requestStates.get(request.requestId);
        if (!requestState) throw new OrchestratorError("FORBIDDEN", "Input text is unavailable for disclosure reservation.");
        const turn = service.turns.get(request.requestId);
        const stored = service.contexts.get(request.requestId);
        const sourceClassifications = stored && stored.sources.length > 0
          ? stored.sources.map((source) => source.classification_ref)
          : [storedOutput.classificationRef];
        const resourceSetDigest = stored
          ? sha256(resourceRefsOf(stored).slice().sort().join("|"))
          : sha256(`no-context:${request.requestId}`);
        const lineageDigest = sha256(`${stored?.manifestDigest ?? "no-manifest"}|${staged.outputDigest}`);
        return service.disclosure.reserve({
          requestId: request.requestId,
          subjectRef: request.subjectRef,
          deviceRef: request.deviceRef,
          applicationRef: requestState.applicationRef,
          purposeRef: requestState.purposeRef,
          outputRef: staged.outputRef,
          outputDigest: staged.outputDigest,
          classificationRef: storedOutput.classificationRef,
          sourceClassifications,
          resourceSetDigest,
          lineageDigest,
          units: 1,
          ceiling: service.disclosureCeiling,
          terminalReceipt: {
            runRef: turn?.turnId ?? `turn:${request.requestId}`,
            finalCounterDigest: sha256(`${runCloseReceipt}:${staged.outputDigest}`),
            terminal: true,
            pendingWork: false,
          },
          expiresAt: request.deadlineAt,
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
        const storedOutput = service.requireStoredOutput(requestId, staged);
        const requestState = service.requestStates.get(requestId);
        if (!requestState) throw new OrchestratorError("FORBIDDEN", "Memory finalization lacks request ownership context.");
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
        await service.conversationHistory.finalizeTurn({
          requestId,
          subjectRef: requestState.subjectRef,
          sessionRef: requestState.sessionRef,
          deviceRef: requestState.deviceRef,
          conversationRef: requestState.conversationRef,
          turnId: turn.turnId,
          inputDigest: requestState.inputDigest,
          output: storedOutput.output,
          outputDigest: staged.outputDigest,
          // Route-policy provenance (Doc 004 §23 step 4 / item 4) rides in the terminal
          // lineage the same way release evidence does: every named field the Authority
          // route_override admission carries (see RouteOverrideAuditFields above), always
          // present here too — not only when an override occurred — so the durable turn
          // record and the Audit admission can be cross-checked field by field.
          terminalEvidence: {
            releaseFence: release.releaseFence,
            releaseAuditReceipt,
            outputCommitProof: storedOutput.commitProof,
            attemptedRoute: requestState.attemptedRoute,
            attemptedReasonCode: requestState.attemptedReasonCode,
            attemptedConfidenceBucket: requestState.attemptedConfidenceBucket,
            attemptedProfileSelector: requestState.attemptedProfileSelector,
            effectiveRoute: requestState.routeOutput,
            effectiveProfileSelector: requestState.profileSelector,
            groundingRequired: requestState.groundingRequired,
            routePolicyRevision: requestState.routePolicyRevision,
            routePolicyDigest: requestState.routePolicyDigest,
            allowedProfileSetDigest: requestState.allowedProfileSetDigest,
            enforcementOverride: requestState.enforcementOverride,
            ...(requestState.enforcementOverride ? { overrideReason: requestState.overrideReason ?? "" } : {}),
            ...(requestState.ragProfileVersion !== undefined ? { ragProfileVersion: requestState.ragProfileVersion } : {}),
            ...(requestState.ragProfileDigest !== undefined ? { ragProfileDigest: requestState.ragProfileDigest } : {}),
            ...(requestState.resolvedCorpusRef !== undefined ? { resolvedCorpusRef: requestState.resolvedCorpusRef } : {}),
            ...(requestState.resolvedMode !== undefined ? { resolvedMode: requestState.resolvedMode } : {}),
          },
          memorySessionAssertion: requestState.memorySessionAssertion,
        }, signal);
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
        // Best-effort: a failure can occur before beginAgentRun/reserveWorkflowBudget ever
        // ran (e.g. a denied top-level authorization), so these may not exist — that is not
        // itself an error, and cleanup here must never mask the original failure code.
        const cleanupSignal = new AbortController().signal;
        await this.agentRunAuthority.closeAgentRun(`run:${requestId}`, cleanupSignal).catch(() => undefined);
        await this.costAuthority.closeWorkflowBudget(`workflow:${requestId}`, cleanupSignal).catch(() => undefined);
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
    const denialReason = this.denialReasons.get(requestId);
    return { status, requestId, turnId: result.status.turnId, error: denialReason ?? result.status.code };
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
    resourceRefs: readonly string[];
    indexGeneration: string;
    profileVersion: number;
    profileDigest: `sha256:${string}`;
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
    this.originalRequests.delete(requestId);
    this.pendingHistory.delete(requestId);
    this.generationDecisions.delete(requestId);
  }
}

function mapModelGatewayError(error: unknown): OrchestratorError {
  if (error instanceof OrchestratorError) return error;
  if (!(error instanceof ModelGatewayError)) {
    if (process.env.NODE_ENV === "development") {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[model-gateway] non-gateway error: ${detail}`);
    }
    return new OrchestratorError("DEPENDENCY_UNAVAILABLE", "Model Gateway failed.");
  }
  if (process.env.NODE_ENV === "development") {
    console.error(`[model-gateway] ${error.code}`);
  }
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
