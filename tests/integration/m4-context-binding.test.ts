import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentHarness, JsonlSessionRepo, NodeExecutionEnv, TODO_CONTEXT, type AgentHarnessTool } from "@earendil-works/pi-agent-core/node";
import { createModels } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { bindContextAuthorization, type ContextFilteredEvent } from "../../services/agent-integration/contextBinding";
import type { CorpusToolDetails } from "../../services/agent-integration/corpusToolContract";
import { createLensAgentProvider } from "../../services/agent-integration/modelTransport";
import type { ModelGatewayChatDispatchInput } from "../../services/model-gateway/ModelGateway";

const ALLOWED_REF = "document-allowed";
const DENIED_REF = "document-denied";
const ALLOWED_TEXT = "Allowed refund policy. [document-allowed]";
const DENIED_TEXT = "Restricted acquisition plan. [document-denied]";
const toolSchema = Type.Object({ resourceRef: Type.String() });

function corpusTool(unbacked = false, mixedRefs = false): AgentHarnessTool<CorpusToolDetails | undefined, typeof toolSchema> {
  return {
    name: "search_corpus",
    label: "search_corpus",
    description: "Search test corpus.",
    parameters: toolSchema,
    async execute(_toolCallId, input) {
      const text = input.resourceRef === ALLOWED_REF ? ALLOWED_TEXT : DENIED_TEXT;
      return {
        content: [{ type: "text", text }],
        details: unbacked ? undefined : { resourceRefs: mixedRefs && input.resourceRef === ALLOWED_REF ? [ALLOWED_REF, DENIED_REF] : [input.resourceRef] },
      };
    },
  };
}

async function runContext(options: {
  allowed?: readonly string[];
  throwDecision?: boolean;
  unbacked?: boolean;
  mixedRefs?: boolean;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "lens-m4-context-"));
  const env = new NodeExecutionEnv({ cwd: root });
  const repo = new JsonlSessionRepo({ fileSystem: env, sessionsRoot: join(root, "sessions") });
  const session = await repo.create({ id: "m4", cwd: root }, TODO_CONTEXT);
  const payloads: ModelGatewayChatDispatchInput[] = [];
  const decisions: Array<{ subjectRef: string; resourceRefs: readonly string[] }> = [];
  const logs: ContextFilteredEvent[] = [];
  let generation = 0;
  const transport = createLensAgentProvider({
    selection: { modelRef: "model" },
    environment: {},
    prepareDispatch: () => ({ requestId: "request", turnId: "turn", stepId: "step", stepClass: "tool", requestDigest: "digest", capability: "chat", artifactDigest: `sha256:${"a".repeat(64)}`, denyEpoch: 1, workflowReservationRef: "budget", deadlineAt: Date.now() + 30_000, scopeId: "scope", authority: { generationDecision: "generation", modelUseDecision: "model", costConsumption: "cost", agentStep: "step" } }),
    gateway: {
      async generateChat(input) {
        payloads.push(input);
        generation += 1;
        const deltas = generation === 1
          ? [
              { type: "tool-call" as const, index: 0, id: "call-allowed", name: "search_corpus", argumentsDelta: `{"resourceRef":"${ALLOWED_REF}"}` },
              { type: "tool-call" as const, index: 1, id: "call-denied", name: "search_corpus", argumentsDelta: `{"resourceRef":"${DENIED_REF}"}` },
            ]
          : [{ type: "text" as const, text: "Answer cites [document-allowed]." }];
        return { deltas, receipt: { measuredUnits: 1 } as never };
      },
    },
  });
  const models = createModels();
  models.setProvider(transport.provider);
  const { harness } = await AgentHarness.create({
    session,
    models,
    model: transport.model,
    tools: [corpusTool(options.unbacked, options.mixedRefs)],
    systemPrompt: "Lens system prompt without document text",
  }, TODO_CONTEXT);
  transport.bind(harness);
  bindContextAuthorization(harness, {
    scope: { requestId: "request", callerWorkloadRef: "prime-agent", subjectRef: "employee-7", deviceRef: "device-7", deadlineAt: Date.now() + 30_000 },
    pdp: {
      decideBatch(input) {
        decisions.push({ subjectRef: input.subjectRef, resourceRefs: input.resourceRefs });
        if (options.throwDecision) throw new Error("authority unavailable for classified resources");
        return { allowed: options.allowed ?? [ALLOWED_REF] };
      },
    },
    log: { emit: (event) => { logs.push(event); } },
  });

  try {
    const lane = await harness.lane("main", TODO_CONTEXT);
    await lane.prompt("Compare the policies without embedding document text", [], TODO_CONTEXT);
    const entries = await session.findEntries(undefined, TODO_CONTEXT);
    return { payloads, decisions, logs, transcript: JSON.stringify(entries), finalMessage: JSON.stringify(entries[0]) };
  } finally {
    await harness.close(TODO_CONTEXT);
    await repo.close(TODO_CONTEXT);
    rmSync(root, { recursive: true, force: true });
  }
}

describe("M4 context binding", () => {
  it("context.only-allowed-text", async () => {
    const result = await runContext();
    const outgoing = JSON.stringify(result.payloads.at(-1));
    expect(outgoing).toContain(ALLOWED_TEXT);
    expect(outgoing).not.toContain(DENIED_TEXT);
    expect(result.decisions).toEqual([{ subjectRef: "employee-7", resourceRefs: [ALLOWED_REF, DENIED_REF] }]);
  });

  it("context.deny-all-yields-empty", async () => {
    const result = await runContext({ allowed: [] });
    const outgoing = JSON.stringify(result.payloads.at(-1));
    expect(result.payloads).toHaveLength(2);
    expect(outgoing).not.toContain(ALLOWED_TEXT);
    expect(outgoing).not.toContain(DENIED_TEXT);
  });

  it("context.fail-closed", async () => {
    const result = await runContext({ throwDecision: true });
    expect(result.payloads).toHaveLength(1);
    expect(result.transcript).toContain("Not permitted");
    expect(result.transcript).not.toContain("authority unavailable");
    expect(result.finalMessage).not.toContain(DENIED_REF);
  });

  it("context.citations-match-allowed", async () => {
    const result = await runContext();
    const outgoing = JSON.stringify(result.payloads.at(-1));
    const citations = [...result.finalMessage.matchAll(/\[document-[a-z]+\]/g)].map(([citation]) => citation);
    expect(outgoing).toContain("[document-allowed]");
    expect(outgoing).not.toContain("[document-denied]");
    expect(new Set(citations)).not.toContain("[document-denied]");
  });

  it("context.system-prompt-clean", async () => {
    const result = await runContext();
    const outgoing = result.payloads.at(-1)!;
    expect(outgoing.messages).toEqual(expect.arrayContaining([
      { role: "system", content: "Lens system prompt without document text" },
      { role: "user", content: "Compare the policies without embedding document text" },
    ]));
    expect(JSON.stringify(outgoing.messages.filter((message) => message.role === "system" || message.role === "user"))).not.toContain(DENIED_TEXT);
  });

  it("context.no-leak-in-errors", async () => {
    const result = await runContext({ throwDecision: true });
    expect(result.transcript).toContain("Not permitted");
    expect(result.transcript).not.toContain("classified resources");
    expect(result.transcript).not.toMatch(/\d+ documents? (?:excluded|denied)/);
  });

  it("context.unbacked-tool-result-dropped", async () => {
    const result = await runContext({ unbacked: true });
    const outgoing = JSON.stringify(result.payloads.at(-1));
    expect(outgoing).not.toContain(ALLOWED_TEXT);
    expect(outgoing).not.toContain(DENIED_TEXT);
    expect(result.decisions).toEqual([]);
  });

  it("context.partially-authorized-result-dropped-whole", async () => {
    const result = await runContext({ mixedRefs: true });
    const outgoing = JSON.stringify(result.payloads.at(-1));
    expect(outgoing).not.toContain(ALLOWED_TEXT);
    expect(outgoing).not.toContain(DENIED_TEXT);
    expect(result.decisions).toHaveLength(1);
  });

  it("context.filtered-log-counts-only", async () => {
    const result = await runContext();
    expect(result.logs.at(-1)).toEqual({ event: "context_filtered", total: 2, kept: 1, dropped: 1 });
    expect(JSON.stringify(result.logs)).not.toContain(ALLOWED_REF);
    expect(JSON.stringify(result.logs)).not.toContain(DENIED_REF);
    expect(JSON.stringify(result.logs)).not.toContain("policy");
  });
});
