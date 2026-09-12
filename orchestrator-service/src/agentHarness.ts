import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  AgentHarness,
  JsonlSessionRepo,
  NodeExecutionEnv,
  TODO_CONTEXT,
  withAbortSignal,
  type HookInvocation,
  type MessageEntry,
} from "@earendil-works/pi-agent-core/node";
import { createModels } from "@earendil-works/pi-ai";
import { AgentError, AgentRuntime } from "../../services/agent-runtime/AgentRuntime";
import { bindCompactionDecline } from "../../services/agent-integration/compactionBinding";
import { bindContextAuthorization, type ContextBindingLogPort } from "../../services/agent-integration/contextBinding";
import {
  createSearchCorpusTool,
  resolveSearchCorpusIntent,
  searchCorpusCatalogEntry,
  type CorpusRetrievalPort,
} from "../../services/agent-integration/corpusTool";
import {
  bindToolGovernance,
  type ToolGovernanceLogEvent,
  type ToolGovernanceLogPort,
} from "../../services/agent-integration/governanceBinding";
import { assertAgentEnvironment, createLensAgentProvider } from "../../services/agent-integration/modelTransport";
import type { AuditLedger } from "../../services/audit/AuditLedger";
import type { AgentRunAuthorityPort } from "../../services/agent-run-authority/AgentRunAuthority";
import type { CostAuthorityPort } from "../../services/cost-authority/CostAuthority";
import type { ModelGateway, ModelGatewayChatDispatchInput } from "../../services/model-gateway/ModelGateway";
import type { ModelUseAuthorityPort } from "../../services/pdp/ModelUseAuthority";
import type { PolicyDecisionPoint } from "../../services/pdp/PolicyDecisionPoint";
import type { CompanyRagProfile } from "../../services/rag-profile/companyRagProfile";
import { computeCompanyRagProfileDigest } from "../../services/rag-profile/companyRagProfile";
import { DEFAULT_WORKFLOW_LIMITS, workflowProfileDigest } from "../../services/workflow-profile/workflowProfile";
import { AGENT_HARNESS_WORKLOAD_ID } from "./agentPdpReplica";
import type { EmployeeApprovedCatalogPort } from "./service";
import type { ModelEligibilityCheckPort } from "./modelGovernance";
import type { ModelSelectionPort } from "./modelSelection";

const POLICY_BLOCK_REASON = "Not permitted";
const DEFAULT_MAX_STEPS = 4;
const DEFAULT_MAX_COST_UNITS = 16_384;

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export interface AgentHarnessRequest {
  requestId: string;
  turnId: string;
  subjectRef: string;
  sessionRef: string;
  conversationRef: string;
  deviceRef: string;
  applicationId: "lens-employee-client";
  workspaceRef: string;
  purposeRef: string;
  retrievalClass: "enterprise-grounded";
  inputText: string;
  queryDigest: `sha256:${string}`;
  deadlineAt: number;
  modelRef?: string;
}

export interface AgentHarnessResult {
  status: "COMPLETED" | "INCOMPLETE" | "DENIED";
  output: string;
  citations: readonly { source: string; section: string }[];
  incomplete?: true;
}

export interface ProductionAgentHarnessOptions {
  gateway: Pick<ModelGateway, "generateChat">;
  retrieval: CorpusRetrievalPort;
  profile: CompanyRagProfile;
  pdp: PolicyDecisionPoint;
  auditLedger: AuditLedger;
  modelSelection: ModelSelectionPort;
  modelEligibility: ModelEligibilityCheckPort;
  employeeCatalog?: EmployeeApprovedCatalogPort;
  modelUseAuthority: ModelUseAuthorityPort;
  costAuthority: CostAuthorityPort;
  agentRunAuthority: AgentRunAuthorityPort;
  sessionRoot?: string;
  profileSelector?: string;
  maxSteps?: number;
  maxCostUnits?: number;
  now?: () => number;
  environment?: NodeJS.ProcessEnv;
  runtime?: AgentRuntime;
}

class RunAuditLog implements ToolGovernanceLogPort, ContextBindingLogPort {
  private sequence = 0;

  constructor(
    private readonly ledger: AuditLedger,
    private readonly requestId: string,
    private readonly runId: string,
  ) {}

  emit(event: ToolGovernanceLogEvent | Parameters<ContextBindingLogPort["emit"]>[0]): void {
    const payload = "toolCallId" in event
      ? { runId: event.runId, toolCallId: event.toolCallId, toolName: event.toolName, event: event.event }
      : { runId: this.runId, event: event.event, total: event.total, kept: event.kept, dropped: event.dropped };
    this.ledger.appendIntent(
      { workloadId: AGENT_HARNESS_WORKLOAD_ID, attested: true },
      {
        eventId: `${this.requestId}:agent-audit:${++this.sequence}`,
        partitionKey: this.requestId,
        eventType: `agent.${"toolCallId" in event ? "tool" : "context"}.${event.event}`,
        requestId: this.requestId,
        action: event.event,
        intentDigest: sha256(JSON.stringify(payload)),
        byteLength: Buffer.byteLength(JSON.stringify(payload)),
      },
    );
  }
}

function finalText(entries: readonly MessageEntry[]): string {
  const assistant = entries
    .filter((entry) => entry.message.role === "assistant")
    .sort((left, right) => left.seq - right.seq)
    .at(-1)?.message;
  if (!assistant || assistant.role !== "assistant") return "";
  return assistant.content.filter((part) => part.type === "text").map((part) => part.text).join("");
}

function hasUnknownToolCall(entries: readonly MessageEntry[]): boolean {
  return entries.some((entry) => entry.message.role === "assistant" && entry.message.content.some(
    (part) => part.type === "toolCall" && part.name !== searchCorpusCatalogEntry.toolId,
  ));
}

function messageEntries(messages: readonly unknown[]): MessageEntry[] {
  return messages.filter((entry): entry is MessageEntry => {
    if (!entry || typeof entry !== "object") return false;
    const candidate = entry as Partial<MessageEntry>;
    return candidate.type === "message" && candidate.message !== undefined;
  });
}

export function createProductionAgentHarness(options: ProductionAgentHarnessOptions) {
  const now = options.now ?? Date.now;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxCostUnits = options.maxCostUnits ?? DEFAULT_MAX_COST_UNITS;
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) throw new Error("Agent maxSteps is invalid.");
  if (!Number.isSafeInteger(maxCostUnits) || maxCostUnits < 0) throw new Error("Agent maxCostUnits is invalid.");
  assertAgentEnvironment(options.environment ?? process.env);

  const admittedRuns = new Map<string, {
    subjectRef: string;
    deviceRef: string;
    applicationRef: string;
    workflowProfileDigest: string;
    budgetDecisionRef: string;
  }>();
  const runtime = options.runtime ?? new AgentRuntime({
    authorize(input) {
      const admission = admittedRuns.get(input.requestId);
      admittedRuns.delete(input.requestId);
      return admission !== undefined
        && admission.subjectRef === input.subjectRef
        && admission.deviceRef === input.deviceRef
        && admission.applicationRef === input.applicationRef
        && admission.workflowProfileDigest === input.workflowProfileDigest
        && admission.budgetDecisionRef === input.budgetDecisionRef;
    },
  }, now);
  runtime.registerTool(searchCorpusCatalogEntry);

  return {
    runtime,
    async run(request: AgentHarnessRequest, signal: AbortSignal): Promise<AgentHarnessResult> {
      if (signal.aborted || request.deadlineAt <= now()) {
        return { status: "INCOMPLETE", output: "Agent run incomplete.", citations: [], incomplete: true };
      }
      const deadlineSignal = AbortSignal.any([
        signal,
        AbortSignal.timeout(Math.max(1, request.deadlineAt - now())),
      ]);
      const profileSelector = options.profileSelector ?? "default";
      const modelRef = request.modelRef ?? "default";
      const selection = options.employeeCatalog && request.modelRef
        ? options.employeeCatalog.resolve({ modelRef, capability: "grounded-assistant" })
        : options.modelSelection.resolve({ modelRef, capability: "grounded-assistant" });
      const profileDigest = computeCompanyRagProfileDigest(options.profile);
      const workflowLimits = {
        ...DEFAULT_WORKFLOW_LIMITS,
        tool: { maximumUnits: Math.max(1, maxCostUnits) },
      };
      const reservationRef = `workflow:${request.requestId}:agent`;
      const workflowDigest = workflowProfileDigest({
        applicationRef: request.applicationId,
        workspaceRef: request.workspaceRef,
        purposeRef: request.purposeRef,
        requestClass: request.retrievalClass,
        deadlineAt: request.deadlineAt,
        reservationRef,
        routePolicyRevision: options.profile.profileVersion,
        routePolicyDigest: profileDigest,
        allowedProfileSetDigest: profileDigest,
        allowedStepClasses: ["tool"],
        limits: workflowLimits,
      });
      const authorityRunId = `agent:${request.requestId}`;
      let budgetReserved = false;
      let authorityRunStarted = false;
      let costFinalized = false;
      let authorityRunClosed = false;
      let budgetClosed = false;
      let measuredModelUnits = 0;
      const pendingModelSteps = new Map<string, {
        stepId: string;
        stepIndex: number;
        modelUseToken: string;
        receiptId?: string;
        units?: number;
        consumed?: boolean;
      }>();
      const modelRunByStep = new Map<string, string>();
      const settleModelStep = async (runId: string, signal: AbortSignal) => {
        const pending = pendingModelSteps.get(runId);
        if (!pending?.receiptId) return;
        if (!pending.consumed) {
          await options.agentRunAuthority.consumeAgentStep(authorityRunId, pending.stepId, pending.receiptId, signal);
          pending.consumed = true;
        }
        await options.agentRunAuthority.finalizeAgentStep(authorityRunId, pending.stepId, signal);
        pendingModelSteps.delete(runId);
        modelRunByStep.delete(pending.stepId);
      };
      const closeAuthorities = async (throwOnError = true) => {
        const errors: unknown[] = [];
        const cleanupSignal = AbortSignal.timeout(5_000);
        if (budgetReserved && !costFinalized) {
          try {
            await options.costAuthority.finalizeSubEnvelope({
              reservationRef,
              subEnvelope: "tool",
              measuredUnits: measuredModelUnits,
              idempotencyKey: `${request.requestId}:agent-tool-finalize`,
            }, cleanupSignal);
            costFinalized = true;
          } catch (error) {
            errors.push(error);
          }
        }
        if (authorityRunStarted && !authorityRunClosed) {
          for (const runId of pendingModelSteps.keys()) {
            try {
              await settleModelStep(runId, cleanupSignal);
            } catch (error) {
              errors.push(error);
            }
          }
          try {
            await options.agentRunAuthority.closeAgentRun(authorityRunId, cleanupSignal);
            authorityRunClosed = true;
          } catch (error) {
            errors.push(error);
          }
        }
        if (budgetReserved && !budgetClosed) {
          try {
            await options.costAuthority.closeWorkflowBudget(reservationRef, cleanupSignal);
            budgetClosed = true;
          } catch (error) {
            errors.push(error);
          }
        }
        if (throwOnError && errors.length > 0) throw errors[0];
      };

      try {
      const generationDecision = await options.modelUseAuthority.authorizeGenerate({
        requestId: request.requestId,
        requestDigest: request.queryDigest,
        subjectRef: request.subjectRef,
        deviceRef: request.deviceRef,
        sessionRef: request.sessionRef,
        applicationRef: request.applicationId,
        workspaceRef: request.workspaceRef,
        purposeRef: request.purposeRef,
        requestClass: request.retrievalClass,
        deadlineAt: request.deadlineAt,
      }, deadlineSignal);
      await options.costAuthority.reserveWorkflowBudget({
        requestId: request.requestId,
        turnId: request.turnId,
        reservationRef,
        idempotencyKey: `${request.requestId}:agent-budget`,
        subEnvelopes: workflowLimits,
        expiresAt: request.deadlineAt,
        workflowProfileDigest: workflowDigest,
      }, deadlineSignal);
      budgetReserved = true;
      await options.agentRunAuthority.beginAgentRun({
        requestId: request.requestId,
        turnId: request.turnId,
        runId: authorityRunId,
        workflowReservationRef: reservationRef,
        workflowProfileDigest: workflowDigest,
        idempotencyKey: `${request.requestId}:agent-run`,
        expiresAt: request.deadlineAt,
      }, deadlineSignal);
      authorityRunStarted = true;
      admittedRuns.set(request.requestId, {
        subjectRef: request.subjectRef,
        deviceRef: request.deviceRef,
        applicationRef: request.applicationId,
        workflowProfileDigest: workflowDigest,
        budgetDecisionRef: reservationRef,
      });
      let run;
      try {
        run = runtime.begin({
          requestId: request.requestId,
          subjectRef: request.subjectRef,
          deviceRef: request.deviceRef,
          applicationRef: request.applicationId,
          envelope: {
            maxSteps,
            maxSideEffects: 0,
            maxCostUnits,
            deadlineAt: request.deadlineAt,
            workflowProfileDigest: workflowDigest,
            budgetDecisionRef: reservationRef,
          },
        });
      } finally {
        admittedRuns.delete(request.requestId);
      }
      const log = new RunAuditLog(options.auditLedger, request.requestId, run.runId);
      const pendingToolSteps = new Map<string, string>();
      let modelStep = 0;
      let consumedModelUnits = 0;
      let incomplete: "steps" | "cost" | "deadline" | undefined;
      let policyBlocked = false;

      const governedGateway = {
        async generateChat(input: ModelGatewayChatDispatchInput, modelSignal: AbortSignal) {
          const units = Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify({
            messages: input.messages,
            tools: input.tools,
          }), "utf8") / 4));
          if (consumedModelUnits + units > maxCostUnits) {
            incomplete = "cost";
            throw new Error("Agent cost envelope exhausted.");
          }
          const cost = await options.costAuthority.consumeSubEnvelope({
            reservationRef,
            subEnvelope: "tool",
            units,
            requestId: request.requestId,
            turnId: request.turnId,
            stepId: input.stepId,
            idempotencyKey: input.stepId,
            expiresAt: request.deadlineAt,
          }, modelSignal);
          consumedModelUnits += units;
          const runId = modelRunByStep.get(input.stepId);
          const pending = runId ? pendingModelSteps.get(runId) : undefined;
          if (!pending) throw new Error("Agent model step was not admitted.");
          const agentStep = await options.agentRunAuthority.reserveAgentStep({
            runId: authorityRunId,
            requestId: request.requestId,
            turnId: request.turnId,
            stepId: input.stepId,
            stepClass: "tool",
            stepIndex: pending.stepIndex,
            modelRef,
            artifactDigest: selection.artifactDigest,
            capability: "grounded-assistant",
            workflowReservationRef: reservationRef,
            subEnvelope: "tool",
            modelAuthorizationDigest: sha256(pending.modelUseToken),
            idempotencyKey: input.stepId,
            deadlineAt: request.deadlineAt,
          }, modelSignal);
          pending.units = units;
          pending.receiptId = agentStep.claims.receiptId;
          return options.gateway.generateChat({
            ...input,
            authority: { ...input.authority, costConsumption: cost.token, agentStep: agentStep.token },
          }, modelSignal);
        },
      };
      const transport = createLensAgentProvider({
        selection: { modelRef },
        gateway: governedGateway,
        environment: options.environment ?? process.env,
        async prepareDispatch(event) {
          if (deadlineSignal.aborted || now() >= request.deadlineAt) {
            incomplete = "deadline";
            throw new Error("Agent deadline exhausted.");
          }
          const stepIndex = ++modelStep;
          const stepId = `step:agent-model:${request.requestId}:${stepIndex}`;
          const modelUse = await options.modelUseAuthority.authorizeModelUse({
            requestId: request.requestId,
            turnId: request.turnId,
            stepId,
            stepClass: "tool",
            requestDigest: request.queryDigest,
            modelRef,
            artifactDigest: selection.artifactDigest,
            capability: "grounded-assistant",
            subjectRef: request.subjectRef,
            applicationRef: request.applicationId,
            workspaceRef: request.workspaceRef,
            purposeRef: request.purposeRef,
            requestClass: request.retrievalClass,
            deadlineAt: request.deadlineAt,
          }, deadlineSignal);
          pendingModelSteps.set(event.runId, { stepId, stepIndex, modelUseToken: modelUse.token });
          modelRunByStep.set(stepId, event.runId);
          return {
            requestId: request.requestId,
            turnId: request.turnId,
            stepId,
            stepClass: "tool",
            requestDigest: request.queryDigest,
            capability: "grounded-assistant",
            artifactDigest: selection.artifactDigest,
            denyEpoch: options.modelEligibility.currentDenyEpoch(),
            workflowReservationRef: reservationRef,
            deadlineAt: request.deadlineAt,
            scopeId: `scope:${request.subjectRef}:${request.sessionRef}`,
            authority: {
              generationDecision: generationDecision.token,
              modelUseDecision: modelUse.token,
              costConsumption: "pending-agent-cost-consumption",
              agentStep: "pending-agent-step",
            },
          };
        },
      });

      const executionEnv = new NodeExecutionEnv({ cwd: process.cwd() });
      const repo = new JsonlSessionRepo({
        fileSystem: executionEnv,
        sessionsRoot: options.sessionRoot ?? join(process.cwd(), ".lens-agent-sessions"),
      });
      const session = await repo.create({ id: request.requestId, cwd: process.cwd() }, TODO_CONTEXT);
      const models = createModels();
      models.setProvider(transport.provider);
      const tool = createSearchCorpusTool({
        retrieval: options.retrieval,
        profile: options.profile,
        profileSelector,
        scope: {
          requestId: request.requestId,
          turnId: request.turnId,
          subjectRef: request.subjectRef,
          sessionRef: request.sessionRef,
          deviceRef: request.deviceRef,
          purposeRef: request.purposeRef,
          deadlineAt: request.deadlineAt,
        },
      });
      const { harness } = await AgentHarness.create({
        session,
        models,
        model: transport.model,
        tools: [tool],
        systemPrompt: "Complete the employee task using only authorized company context. Use search_corpus when company information is needed.",
      }, TODO_CONTEXT);

      const stops = [
        bindCompactionDecline(harness),
        bindToolGovernance(harness, {
          pdp: options.pdp,
          scope: {
            requestId: request.requestId,
            callerWorkloadRef: AGENT_HARNESS_WORKLOAD_ID,
            subjectRef: request.subjectRef,
            deviceRef: request.deviceRef,
            deadlineAt: request.deadlineAt,
          },
          resolveIntent(event) {
            if (event.toolName !== searchCorpusCatalogEntry.toolId) throw new Error("Unknown tool.");
            return resolveSearchCorpusIntent(options.profile, profileSelector);
          },
          log: {
            emit(event) {
              if (event.event === "tool_blocked") policyBlocked = true;
              log.emit(event);
            },
          },
          recordOutcome(outcome) {
            const stepId = pendingToolSteps.get(outcome.toolCallId);
            if (!stepId) return;
            run = runtime.finalize({
              runId: run.runId,
              stepId,
              state: outcome.isError ? "FAILED" : "SUCCEEDED",
            });
          },
          now,
        }),
        harness.hooks.on("before_tool", (event: HookInvocation<"before_tool">) => {
          if (event.toolName !== searchCorpusCatalogEntry.toolId) return undefined;
          if (now() >= request.deadlineAt) {
            incomplete = "deadline";
            return { block: { reason: "Run incomplete", terminate: true } };
          }
          if (run.consumedSteps >= run.envelope.maxSteps) incomplete = "steps";
          else if (run.reservedCostUnits + 1 > run.envelope.maxCostUnits) incomplete = "cost";
          if (incomplete) return { block: { reason: "Run incomplete", terminate: true } };
          try {
            const stepId = `tool:${event.toolCallId}`;
            const fence = runtime.reserveStep({
              runId: run.runId,
              expectedRevision: run.revision,
              stepId,
              toolId: searchCorpusCatalogEntry.toolId,
              toolVersion: searchCorpusCatalogEntry.version,
              intentDigest: sha256(JSON.stringify(event.args)),
              declaredCostUnits: 1,
            });
            runtime.start({
              fence,
              consumerAttemptId: `${request.requestId}:${event.toolCallId}`,
              exactIntentDigest: fence.intentDigest,
              policyEpoch: 1,
            });
            pendingToolSteps.set(event.toolCallId, stepId);
            run = { ...run, revision: fence.revision + 1, consumedSteps: run.consumedSteps + 1, reservedCostUnits: run.reservedCostUnits + 1 };
            return undefined;
          } catch (error) {
            if (error instanceof AgentError && error.code === "ENVELOPE_EXHAUSTED") incomplete = "steps";
            return { block: { reason: "Run incomplete", terminate: true } };
          }
        }),
        bindContextAuthorization(harness, {
          pdp: options.pdp,
          scope: {
            requestId: request.requestId,
            callerWorkloadRef: AGENT_HARNESS_WORKLOAD_ID,
            subjectRef: request.subjectRef,
            deviceRef: request.deviceRef,
            deadlineAt: request.deadlineAt,
          },
          log,
        }),
        transport.bind(harness),
        harness.hooks.on("after_response", async (event) => {
          const pending = pendingModelSteps.get(event.runId);
          if (!pending || pending.units === undefined || pending.receiptId === undefined) return undefined;
          await settleModelStep(event.runId, deadlineSignal);
          measuredModelUnits += event.message.usage.totalTokens;
          if (measuredModelUnits > maxCostUnits) incomplete = "cost";
          return undefined;
        }),
      ];

      try {
        const lane = await harness.lane("main", TODO_CONTEXT);
        const result = await lane.prompt(request.inputText, [], withAbortSignal(deadlineSignal, TODO_CONTEXT));
        const entries = messageEntries(await session.findEntries(undefined, TODO_CONTEXT));
        const output = finalText(entries);
        if (policyBlocked || hasUnknownToolCall(entries) || output === POLICY_BLOCK_REASON) {
          runtime.close(run.runId, run.revision, "CANCELLED");
          await closeAuthorities();
          return { status: "DENIED", output: POLICY_BLOCK_REASON, citations: [] };
        }
        const failed = !result.ok || result.value.status !== "completed" || output.length === 0;
        if (incomplete || deadlineSignal.aborted || failed) {
          runtime.close(run.runId, run.revision, deadlineSignal.aborted ? "EXPIRED" : "CANCELLED");
          await closeAuthorities();
          return {
            status: "INCOMPLETE",
            output: output ? `${output}\n\nAgent run incomplete.` : "Agent run incomplete.",
            citations: [],
            incomplete: true,
          };
        }
        runtime.close(run.runId, run.revision, "COMPLETED");
        await closeAuthorities();
        return { status: "COMPLETED", output, citations: [] };
      } finally {
        for (const stop of stops.reverse()) stop();
        await harness.close(TODO_CONTEXT);
        await repo.close(TODO_CONTEXT);
      }
      } finally {
        await closeAuthorities(false);
      }
    },
  };
}
