import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "../../services/agent-runtime/AgentRuntime";
import type { AgentRunAuthorityPort } from "../../services/agent-run-authority/AgentRunAuthority";
import type { CostAuthorityPort } from "../../services/cost-authority/CostAuthority";
import type { ModelUseAuthorityPort } from "../../services/pdp/ModelUseAuthority";
import { PolicyDecisionPoint, type PolicyBundle } from "../../services/pdp/PolicyDecisionPoint";
import { DelegatedSessionAssertionIssuer, DelegatedSessionAssertionVerifier } from "../../services/security/delegatedSessionAssertion";
import { LENS_PURPOSE_REF, LENS_REQUEST_CLASS, LENS_WORKSPACE_REF } from "../../services/security/workspaceContext";
import { createRetrievalWiring } from "../../services/retrieval/ProductionRetrievalWiring";
import type { CompanyRagProfile } from "../../services/rag-profile/companyRagProfile";
import { createProductionAgentHarness, type AgentHarnessRequest } from "../src/agentHarness";
import { createAgentAuditLedger, createAgentPolicyReplica } from "../src/agentPdpReplica";
import { createOrchestratorHttp } from "../src/http";

const roots: string[] = [];
const hash = (value: string): `sha256:${string}` => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const policyBundle: PolicyBundle = {
  revision: 1,
  digest: "sha256:policy-v1",
  signed: true,
  evaluate: () => true,
};
const profile: CompanyRagProfile = {
  profileVersion: 1,
  companyId: "company-1",
  corpora: ["company-corpus"],
  connectors: [],
  chunking: { maxTokens: 512, overlapTokens: 32 },
  embeddingAdapterRef: "embedding-1",
  groundingPolicyRef: "grounding-1",
  tools: ["search_corpus"],
  retentionDays: 30,
  eligibleModelPatterns: ["model"],
  retrievalProfiles: { default: { corpusRef: "company-corpus", mode: "hybrid" } },
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function request(index: number): AgentHarnessRequest {
  const subjectRef = `employee-${index}`;
  return {
    requestId: `request-${index}`,
    turnId: `turn-${index}`,
    subjectRef,
    sessionRef: `session-${index}`,
    conversationRef: `conversation-${index}`,
    deviceRef: `device-${index}`,
    applicationId: "lens-employee-client",
    workspaceRef: "workspace:lens",
    purposeRef: "employee-assistance",
    retrievalClass: "enterprise-grounded",
    inputText: "find my private terms",
    queryDigest: hash("find my private terms"),
    deadlineAt: Date.now() + 30_000,
    modelRef: "model",
  };
}

function authorities(lifecycle: string[]) {
  const receipt = (name: string) => ({ token: name, claims: { receiptId: name } }) as never;
  const pendingSteps = new Set<string>();
  const modelUseAuthority: ModelUseAuthorityPort = {
    authorizeGenerate: async (input) => receipt(`generation:${input.requestId}`),
    authorizeModelUse: async (input) => receipt(`model:${input.stepId}`),
  };
  const costAuthority: CostAuthorityPort = {
    reserveWorkflowBudget: async (input) => ({ reservationRef: input.reservationRef, revision: 1 }),
    consumeSubEnvelope: async (input) => receipt(`cost:${input.stepId}`),
    finalizeSubEnvelope: async () => { lifecycle.push("cost-finalized"); },
    closeWorkflowBudget: async () => { lifecycle.push("budget-closed"); },
    getWorkflowBudgetStatus: async () => { throw new Error("unused"); },
  };
  const agentRunAuthority: AgentRunAuthorityPort = {
    beginAgentRun: async (input) => ({ runId: input.runId, envelopeRevision: 1 }),
    reserveAgentStep: async (input) => {
      pendingSteps.add(input.stepId);
      return receipt(`agent-step:${input.stepId}`);
    },
    consumeAgentStep: async (_runId, stepId) => {
      if (!pendingSteps.has(stepId)) throw new Error("step is not reserved");
    },
    finalizeAgentStep: async (_runId, stepId) => {
      if (!pendingSteps.delete(stepId)) throw new Error("step is not reserved");
    },
    closeAgentRun: async () => {
      if (pendingSteps.size > 0) throw new Error("run has nonterminal steps");
      lifecycle.push("run-closed");
    },
    getAgentRunStatus: async () => { throw new Error("unused"); },
  };
  return { modelUseAuthority, costAuthority, agentRunAuthority };
}

function fixture(options: {
  maxSteps?: number;
  maxCostUnits?: number;
  unknownTool?: boolean;
  repeatedTool?: boolean;
  includeForeignDocument?: boolean;
  denyCorpus?: boolean;
  deniedResources?: readonly string[];
  gatewayThrows?: boolean;
  policyBundle?: PolicyBundle;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "lens-m5-"));
  roots.push(root);
  const ledger = createAgentAuditLedger();
  const audit = vi.spyOn(ledger, "appendIntent");
  const replica = createAgentPolicyReplica({
    factReaders: {
      subject: (subjectRef) => ({ revision: 1, active: true, groups: [`doc-${subjectRef}`] }),
      device: () => ({ revision: 1, compliant: true }),
      resources: (refs) => refs.map((resourceRef) => ({
        resourceRef,
        revision: 1,
        published: true,
        integrityValid: true,
        aclAllows: !(options.denyCorpus && resourceRef === "company-corpus")
          && !(options.includeForeignDocument && resourceRef === "doc-employee-other")
          && !options.deniedResources?.includes(resourceRef),
      })),
    },
    policyBundle: options.policyBundle ?? policyBundle,
    signer: {
      sign: (fence) => `signed:${fence.fenceId}`,
      verify: (fence) => fence.signature === `signed:${fence.fenceId}`,
    },
    auditLedger: ledger,
  });
  const calls = new Map<string, number>();
  const lifecycle: string[] = [];
  let retrievalCalls = 0;
  const gateway = {
    async generateChat(input: { requestId: string; messages: readonly { role: string; content: string }[] }) {
      if (options.gatewayThrows) throw new Error("model unavailable");
      const call = (calls.get(input.requestId) ?? 0) + 1;
      calls.set(input.requestId, call);
      if (call === 1 || options.repeatedTool && call === 2) {
        return {
          deltas: [{
            type: "tool-call" as const,
            index: 0,
            id: `${input.requestId}-call-${call}`,
            name: options.unknownTool ? "unknown_tool" : "search_corpus",
            argumentsDelta: '{"query":"terms"}',
          }],
          receipt: { measuredUnits: 1 } as never,
        };
      }
      const toolText = input.messages.filter((message) => message.role === "tool").map((message) => message.content).join("\n");
      return { deltas: [{ type: "text" as const, text: toolText || "done" }], receipt: { measuredUnits: 1 } as never };
    },
  };
  const runtime = new AgentRuntime({ authorize: () => true });
  const harness = createProductionAgentHarness({
    gateway: gateway as never,
    retrieval: {
      async retrieve(input) {
        retrievalCalls += 1;
        const ownRef = `doc-${input.subject_ref}`;
        const refs = options.includeForeignDocument ? [ownRef, "doc-employee-other"] : [ownRef];
        return {
          status: "context" as const,
          request_id: input.request_id,
          turn_id: input.turn_id,
          index_generation: "generation-1",
          profile_version: profile.profileVersion,
          profile_digest: hash(JSON.stringify(profile)),
          manifest: {
            digest: hash(`manifest:${input.request_id}`),
            retrieved_at: Date.now(),
            source_revision_digest: hash("sources"),
            operation_decision_ref: "operation",
            candidate_decision_ref: "candidate",
            policy_revision: 1,
            subject_security_revision: 1,
            resource_security_revision_digest: hash("resources"),
            expires_at: input.deadline_at,
            profile_version: profile.profileVersion,
            profile_digest: hash(JSON.stringify(profile)),
            sources: refs.map((ref) => ({ resource_ref: ref, version_ref: ref, chunk_ref: `chunk-${ref}`, content_hash: hash(ref) })),
          },
          sources: refs.map((ref) => ({
            document_version_ref: ref,
            chunk_ref: `chunk-${ref}`,
            text: `private text for ${ref}`,
            citation_anchor: `${ref}:1`,
            content_digest: hash(ref),
            classification_ref: "confidential" as const,
          })),
        };
      },
    },
    profile,
    pdp: replica.pdp,
    auditLedger: ledger,
    modelSelection: { resolve: () => ({ artifactDigest: hash("model") }) },
    modelEligibility: {
      resolveEndpoint: async () => ({ endpointRef: "runtime", snapshotExpiresAt: Date.now() + 30_000, external: false }),
      currentDenyEpoch: () => 0,
    },
    ...authorities(lifecycle),
    sessionRoot: join(root, "sessions"),
    environment: {},
    runtime,
    maxSteps: options.maxSteps,
    maxCostUnits: options.maxCostUnits,
  });
  return { harness, runtime, audit, replica, lifecycle, getRetrievalCalls: () => retrievalCalls };
}

describe("M5 routing seam", () => {
  it("routing.orchestrator-ingress-preserves-opt-in", async () => {
    const now = 1_700_000_000_000;
    const keys = generateKeyPairSync("ed25519");
    const memoryKeys = generateKeyPairSync("ed25519");
    const assertion = {
      issuer: "bff" as const,
      requestId: "request-http",
      subjectRef: "employee-http",
      sessionRef: "session-http",
      deviceRef: "device-http",
      conversationRef: "conversation-http",
      queryDigest: hash("find policy"),
      workspaceRef: LENS_WORKSPACE_REF,
      requestClass: LENS_REQUEST_CLASS,
      purposeRef: LENS_PURPOSE_REF,
    };
    const seen: { agentMode?: true }[] = [];
    const http = createOrchestratorHttp({
      workloadToken: "w".repeat(40),
      now: () => now,
      sessionAssertionVerifier: new DelegatedSessionAssertionVerifier(keys.publicKey, { now: () => now }),
      memoryAssertionVerifier: new DelegatedSessionAssertionVerifier(memoryKeys.publicKey, { now: () => now }),
      handleChat: async (input) => {
        seen.push(input);
        return { status: "INCOMPLETE", requestId: input.requestId, output: "Agent run incomplete.", citations: [] };
      },
    });
    await http.listen(0, "127.0.0.1");
    try {
      const address = http.server.address();
      if (!address || typeof address === "string") throw new Error("missing address");
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-lens-orchestrator-token": "w".repeat(40) },
        body: JSON.stringify({
          request_id: assertion.requestId,
          turn_id: "turn-http",
          subject_ref: assertion.subjectRef,
          session_ref: assertion.sessionRef,
          conversation_ref: assertion.conversationRef,
          device_ref: assertion.deviceRef,
          application_id: "lens-employee-client",
          purpose_ref: "assistant",
          retrieval_class: "enterprise-grounded",
          capability: "grounded-assistant",
          input_text: "find policy",
          query_digest: assertion.queryDigest,
          deadline_at: now + 30_000,
          retry_budget: 0,
          bulkhead: "interactive",
          agent_mode: true,
          session_assertion: new DelegatedSessionAssertionIssuer(keys.privateKey, { now: () => now }).issue({ ...assertion, audience: "orchestrator" }),
          memory_session_assertion: new DelegatedSessionAssertionIssuer(memoryKeys.privateKey, { now: () => now }).issue({ ...assertion, audience: "memory" }),
        }),
      });
      expect(response.status).toBe(200);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ agentMode: true });
      expect(await response.json()).toMatchObject({ status: "INCOMPLETE" });
    } finally {
      await http.close();
    }
  });

  it("routing.opt-in-routes-to-agent", async () => {
    const { harness } = fixture();
    const result = await harness.run(request(1), new AbortController().signal);
    expect(result.status).toBe("COMPLETED");
    expect(result).not.toHaveProperty("incomplete");
    expect(result.output).toContain("private text for doc-employee-1");
  });

  it("routing.concurrent-isolation", async () => {
    const { harness } = fixture();
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => harness.run(request(index), new AbortController().signal)));
    expect(results).toHaveLength(10);
    results.forEach((result, index) => {
      expect(result.output).toContain(`doc-employee-${index}`);
      expect(result.output).not.toMatch(new RegExp(`doc-employee-(?!${index}(?:\\D|$))\\d+`));
    });
  });

  it("routing.envelope-steps and routing.termination-is-explicit", async () => {
    const { harness } = fixture({ repeatedTool: true, maxSteps: 1 });
    const result = await harness.run(request(20), new AbortController().signal);
    expect(result).toMatchObject({ status: "INCOMPLETE", incomplete: true });
    expect(result.output).toContain("Agent run incomplete.");
  });

  it("routing.envelope-cost", async () => {
    const { harness } = fixture({ maxCostUnits: 1 });
    const result = await harness.run(request(21), new AbortController().signal);
    expect(result).toMatchObject({ status: "INCOMPLETE", incomplete: true });
  });

  it("routing.envelope-deadline", async () => {
    const { harness } = fixture();
    const expired = { ...request(22), deadlineAt: Date.now() + 1 };
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(harness.run(expired, new AbortController().signal)).resolves.toMatchObject({ status: "INCOMPLETE", incomplete: true });
  });

  it("routing.unknown-tool-blocked", async () => {
    const fixtureValue = fixture({ unknownTool: true });
    const result = await fixtureValue.harness.run(request(23), new AbortController().signal);
    expect(result).toMatchObject({ status: "DENIED", output: "Not permitted" });
    expect(fixtureValue.getRetrievalCalls()).toBe(0);
  });

  it("routing.forced-pdp-failure", async () => {
    const fixtureValue = fixture({ denyCorpus: true });
    const result = await fixtureValue.harness.run(request(25), new AbortController().signal);
    expect(result).toEqual({ status: "DENIED", output: "Not permitted", citations: [] });
    expect(fixtureValue.getRetrievalCalls()).toBe(0);
    expect(fixtureValue.audit.mock.calls.map((call) => call[1].action)).toEqual(expect.arrayContaining([
      "decision_requested",
      "agent.tool.search_corpus",
      "tool_blocked",
    ]));
  });

  it("routing.agent-path-still-gated", async () => {
    const { harness, audit } = fixture({ includeForeignDocument: true });
    const result = await harness.run(request(24), new AbortController().signal);
    expect(result.output).toBe("[withheld]");
    expect(result.output).not.toContain("doc-employee-other");
    expect(result.citations).toEqual([]);
    const eventTypes = audit.mock.calls.map((call) => call[1].eventType);
    expect(eventTypes).toContain("agent.tool.decision_requested");
    expect(eventTypes).toContain("agent.context.context_filtered");
    const actions = audit.mock.calls.map((call) => call[1].action);
    expect(actions.indexOf("decision_requested")).toBeLessThan(actions.indexOf("fence_consumed"));
    expect(actions.indexOf("fence_consumed")).toBeLessThan(actions.indexOf("tool_completed"));
  });

  it("routing.authorities-close-on-failure", async () => {
    const fixtureValue = fixture({ gatewayThrows: true });
    await expect(fixtureValue.harness.run(request(26), new AbortController().signal)).resolves.toMatchObject({ status: "INCOMPLETE" });
    expect(fixtureValue.lifecycle).toEqual(expect.arrayContaining(["cost-finalized", "run-closed", "budget-closed"]));
  });

  it("routing.catalog-registered", () => {
    const registered = vi.spyOn(AgentRuntime.prototype, "registerTool");
    fixture();
    expect(registered).toHaveBeenCalledWith(expect.objectContaining({ toolId: "search_corpus", risk: "read" }));
  });

  it("routing.pdp-bundle-matches-retrieval", () => {
    const activate = vi.spyOn(PolicyDecisionPoint.prototype, "activate");
    const retrieval = createRetrievalWiring();
    retrieval.activation.activatePolicy();
    const retrievalBundle = activate.mock.calls[0]?.[0];
    expect(retrievalBundle).toBeDefined();
    retrieval.activation.registerContent({ documentVersionRef: "doc", classification: "internal", aclDigest: hash("acl"), active: true });
    const retrievalDecision = retrieval.pdp.decideBatch({
      requestId: "retrieval",
      callerWorkloadRef: "retrieval",
      subjectRef: "employee",
      deviceRef: "device",
      action: "retrieve",
      resourceRefs: ["doc"],
      normalizedContextDigest: hash("retrieval"),
      deadlineAt: Date.now() + 1_000,
    });
    const { replica } = fixture({ policyBundle: retrievalBundle! });
    expect(activate.mock.calls[1]?.[0]).toBe(retrievalBundle);
    expect(replica.policyDigest).toBe(retrievalDecision.fence?.policyDigest);
  });

  it("routing.pdp-agrees-with-retrieval", () => {
    const activate = vi.spyOn(PolicyDecisionPoint.prototype, "activate");
    const retrieval = createRetrievalWiring({ subject: () => ({ revision: 1, active: true, groups: ["doc-employee-1"] }) });
    retrieval.activation.activatePolicy();
    const retrievalBundle = activate.mock.calls[0]?.[0];
    expect(retrievalBundle).toBeDefined();
    retrieval.activation.registerContent({ documentVersionRef: "doc-employee-1", classification: "internal", aclDigest: hash("acl"), active: true });
    retrieval.activation.registerContent({ documentVersionRef: "doc-denied", classification: "internal", aclDigest: hash("acl-denied") });
    const { replica, audit } = fixture({
      deniedResources: ["doc-denied"],
      policyBundle: retrievalBundle!,
    });
    const input = {
      requestId: "agreement",
      callerWorkloadRef: "orchestrator-agent-harness",
      subjectRef: "employee-1",
      deviceRef: "device",
      action: "agent.context.use",
      resourceRefs: ["doc-employee-1", "doc-denied"],
      normalizedContextDigest: hash("agreement"),
      deadlineAt: Date.now() + 1_000,
    };
    const agentDecision = replica.pdp.decideBatch(input);
    const retrievalDecision = retrieval.pdp.decideBatch(input);
    expect(agentDecision.allowed).toEqual(retrievalDecision.allowed);
    expect(agentDecision.allowed).toEqual(["doc-employee-1"]);
    expect(input.resourceRefs.filter((ref) => !agentDecision.allowed.includes(ref))).toEqual(["doc-denied"]);
    expect(audit.mock.calls.filter((call) => call[1].eventType === "pdp.decision")).toHaveLength(1);
  });

  it("routing.pdp-decisions-audited", async () => {
    const { harness, replica, audit } = fixture();
    const decisions = vi.spyOn(replica.pdp, "decideBatch");
    await harness.run(request(27), new AbortController().signal);
    const admissions = audit.mock.calls.filter((call) => call[1].eventType === "pdp.decision");
    expect(admissions).toHaveLength(decisions.mock.calls.length);
  });
});
