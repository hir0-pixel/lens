import { describe, expect, it } from "vitest";
import {
  FakeInferenceAdapter,
  Orchestrator,
  OrchestratorError,
  type ChatRequest,
  type OrchestratorDependencies,
} from "../../services/orchestrator";

const digest = (letter: string) => `sha256:${letter.repeat(64)}` as const;
const request = (overrides: Partial<ChatRequest> = {}): ChatRequest => ({
  requestId: "request-1",
  subjectRef: "subject-1",
  deviceRef: "device-1",
  conversationRef: "conversation-1",
  inputDigest: digest("a"),
  deadlineAt: 2_000,
  ...overrides,
});

function dependencies(
  chunks: readonly string[] = ["protected ", "answer"],
  overrides: Partial<OrchestratorDependencies> = {},
) {
  const calls: string[] = [];
  const model = new FakeInferenceAdapter(chunks);
  const deps: OrchestratorDependencies = {
    authorizeGenerate: async () => { calls.push("authorize-generate"); },
    beginTurn: async () => { calls.push("begin-turn"); return { turnId: "turn-1", sequence: 1 }; },
    reserveWorkflowBudget: async () => { calls.push("reserve-workflow-budget"); return "workflow-reservation-1"; },
    beginAgentRun: async () => { calls.push("begin-run"); return { runId: "run-1", envelopeRevision: 1 }; },
    classifyRoute: async () => { calls.push("classify-route"); return { route: "KNOWLEDGE_QUERY" }; },
    resolveContext: async () => { calls.push("resolve-context"); return { digest: digest("b"), noContext: false }; },
    authorizeContextUse: async () => { calls.push("authorize-context"); },
    admitAudit: async (kind) => { calls.push(`audit-${kind}`); return `${kind}-audit-receipt`; },
    generate: (input, signal) => { calls.push("generate"); return model.generate(input, signal); },
    closeAgentRun: async () => { calls.push("close-run"); return "run-close-receipt"; },
    stageOutput: async (_turn, output) => { calls.push(`stage:${output}`); return { outputRef: "output-1", outputDigest: digest("c"), commitProof: "commit-proof" }; },
    reserveDisclosure: async () => { calls.push("reserve-disclosure"); return { reservationRef: "reservation-1", classificationRef: "confidential" }; },
    authorizeOutput: async () => { calls.push("authorize-output"); return { releaseFence: "release-fence", obligations: ["audit"] }; },
    finalizeTurn: async (_turn, _staged, _release, receipt) => { calls.push(`finalize:${receipt}`); },
    commitDisclosure: async () => { calls.push("commit-disclosure"); },
    failTurn: async (_turn, code) => { calls.push(`fail:${code}`); },
    ...overrides,
  };
  return { deps, calls };
}

describe("M04 Orchestrator", () => {
  it("runs the protected final-output pipeline in order and exposes content only after completion", async () => {
    const { deps, calls } = dependencies();
    const orchestrator = new Orchestrator(deps, { now: () => 1_000 });
    const result = await orchestrator.execute(request());

    expect(result).toMatchObject({ output: "protected answer", outputDigest: digest("c"), status: { state: "COMPLETED", turnId: "turn-1" } });
    expect(calls).toEqual([
      "authorize-generate", "begin-turn", "reserve-workflow-budget", "begin-run", "classify-route",
      "resolve-context", "authorize-context", "audit-generation", "generate", "close-run",
      "stage:protected answer", "reserve-disclosure", "authorize-output", "audit-release",
      "finalize:release-audit-receipt", "commit-disclosure",
    ]);
    expect(orchestrator.getStatus("request-1")).toEqual({ requestId: "request-1", turnId: "turn-1", state: "COMPLETED" });
    expect(orchestrator.getStatus("request-1")).not.toHaveProperty("output");
  });

  it("never calls beginTurn, classifyRoute, or resolveContext/generate when top-level authorization is denied", async () => {
    const { deps, calls } = dependencies(undefined, {
      authorizeGenerate: async () => { calls.push("authorize-generate"); throw new OrchestratorError("FORBIDDEN", "Denied."); },
    });
    const result = await new Orchestrator(deps, { now: () => 1_000 }).execute(request());

    expect(result).toEqual({ status: { requestId: "request-1", state: "DENIED", code: "FORBIDDEN" } });
    expect(calls).toEqual(["authorize-generate"]);
  });

  it("classifies the route only after authorizeGenerate, beginTurn, the workflow budget reservation, and beginAgentRun", async () => {
    const { deps, calls } = dependencies(undefined, {
      classifyRoute: async () => {
        calls.push("classify-route");
        expect(calls.slice(0, 4)).toEqual(["authorize-generate", "begin-turn", "reserve-workflow-budget", "begin-run"]);
        return { route: "KNOWLEDGE_QUERY" };
      },
    });
    await new Orchestrator(deps, { now: () => 1_000 }).execute(request());
    expect(calls).toContain("classify-route");
  });

  it("does not release or finalize output when final disclosure authorization is denied", async () => {
    const { deps, calls } = dependencies(undefined, {
      authorizeOutput: async () => { throw new OrchestratorError("FORBIDDEN", "Denied."); },
    });
    const result = await new Orchestrator(deps, { now: () => 1_000 }).execute(request());

    expect(result).toEqual({ status: { requestId: "request-1", turnId: "turn-1", state: "DENIED", code: "FORBIDDEN" } });
    expect(calls).not.toContain("commit-disclosure");
    expect(calls.some((call) => call.startsWith("finalize:"))).toBe(false);
    expect(calls).toContain("fail:FORBIDDEN");
  });

  it("propagates cancellation, discards buffered output, and never retries generation", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const { deps, calls } = dependencies(undefined, {
      generate: async function* () {
        attempts += 1;
        yield "protected";
        controller.abort();
        yield " output";
      },
    });
    const result = await new Orchestrator(deps, { now: () => 1_000 }).execute(request(), controller.signal);

    expect(result).toEqual({ status: { requestId: "request-1", turnId: "turn-1", state: "CANCELLED", code: "CANCELLED" } });
    expect(attempts).toBe(1);
    expect(calls).not.toContain("commit-disclosure");
    expect(calls.some((call) => call.startsWith("stage:"))).toBe(false);
  });

  it("fails closed for output-buffer overload and grounded-route no-context", async () => {
    const overrun = dependencies(["four"]);
    const first = await new Orchestrator(overrun.deps, { now: () => 1_000, maxOutputBytes: 3 }).execute(request());
    expect(first).toEqual({ status: { requestId: "request-1", turnId: "turn-1", state: "FAILED", code: "OVERLOADED" } });
    expect(overrun.calls.some((call) => call.startsWith("stage:"))).toBe(false);

    const grounded = dependencies(undefined, {
      resolveContext: async () => ({ digest: digest("b"), noContext: true }),
    });
    const second = await new Orchestrator(grounded.deps, { now: () => 1_000 }).execute(request());
    expect(second).toEqual({ status: { requestId: "request-1", turnId: "turn-1", state: "DENIED", code: "FORBIDDEN" } });
    expect(grounded.calls).not.toContain("generate");
  });

  it("skips Retrieval entirely for ungrounded routes (acknowledgement) but still authorizes and audits", async () => {
    const { deps, calls } = dependencies(["You're welcome."], {
      classifyRoute: async () => { calls.push("classify-route"); return { route: "ACKNOWLEDGEMENT" }; },
    });
    const result = await new Orchestrator(deps, { now: () => 1_000 }).execute(request());

    expect(result).toMatchObject({ output: "You're welcome.", status: { state: "COMPLETED" } });
    expect(calls).toContain("authorize-generate");
    expect(calls).toContain("audit-generation");
    expect(calls).not.toContain("resolve-context");
    expect(calls).not.toContain("authorize-context");
  });

  it("returns only a safe status when every protected dependency boundary fails", async () => {
    const boundaries = [
      "authorizeGenerate", "beginTurn", "reserveWorkflowBudget", "beginAgentRun", "classifyRoute",
      "resolveContext", "authorizeContextUse", "admitAudit", "closeAgentRun", "stageOutput",
      "reserveDisclosure", "authorizeOutput", "finalizeTurn", "commitDisclosure",
    ] as const;

    for (const boundary of boundaries) {
      const failure = async () => { throw new Error(`${boundary} unavailable`); };
      const { deps, calls } = dependencies(undefined, { [boundary]: failure } as unknown as Partial<OrchestratorDependencies>);
      const result = await new Orchestrator(deps, { now: () => 1_000 }).execute(request({ requestId: `request-${boundary}` }));

      expect(result.status).toMatchObject({ requestId: `request-${boundary}`, state: "FAILED", code: "DEPENDENCY_UNAVAILABLE" });
      expect(result).not.toHaveProperty("output");
      expect(calls).not.toContain("commit-disclosure");
    }

    const generationFailure = dependencies(undefined, {
      generate: async function* () {
        for (const chunk of [] as string[]) yield chunk;
        throw new Error("generation unavailable");
      },
    });
    const result = await new Orchestrator(generationFailure.deps, { now: () => 1_000 }).execute(request({ requestId: "request-generation" }));
    expect(result).toEqual({ status: { requestId: "request-generation", turnId: "turn-1", state: "FAILED", code: "DEPENDENCY_UNAVAILABLE" } });
    expect(generationFailure.calls).not.toContain("commit-disclosure");
  });
});
