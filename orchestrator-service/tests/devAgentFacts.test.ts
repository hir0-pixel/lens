import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CompanyRagProfile } from "../../services/rag-profile/companyRagProfile";
import type { OrchestratorChatRequest } from "../src/http";
import { loadAgentPolicyReplica, main, type OrchestratorServiceEnv } from "../src/main";
import { ProductionOrchestratorService } from "../src/service";

const assertionKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
const ragProfile: CompanyRagProfile = {
  profileVersion: 1,
  companyId: "acme",
  corpora: ["hr-handbook"],
  connectors: [],
  chunking: { maxTokens: 400, overlapTokens: 40 },
  embeddingAdapterRef: "embed",
  groundingPolicyRef: "signed",
  tools: [],
  retentionDays: 30,
  eligibleModelPatterns: ["*"],
  retrievalProfiles: { default: { corpusRef: "hr-handbook", mode: "semantic" } },
};

function env(overrides: Partial<OrchestratorServiceEnv> = {}): OrchestratorServiceEnv {
  return {
    ORCHESTRATOR_WORKLOAD_TOKEN: "o".repeat(40),
    RETRIEVAL_URL: "http://127.0.0.1:1/",
    RETRIEVAL_WORKLOAD_TOKEN: "r".repeat(40),
    MODEL_RUNTIME_URL: "http://127.0.0.1:1/",
    MODEL_RUNTIME_WORKLOAD_TOKEN: "m".repeat(40),
    MODEL_ARTIFACT_DIGEST: `sha256:${"a".repeat(64)}`,
    AUTHORITY_URL: "http://127.0.0.1:1/",
    AUTHORITY_WORKLOAD_TOKEN: "a".repeat(40),
    ASSERTION_VERIFY_KEY: assertionKey,
    MEMORY_ASSERTION_VERIFY_KEY: assertionKey,
    ORCHESTRATOR_AUTHORITY_PROFILE: "test",
    CONVERSATION_HISTORY_PROFILE: "test",
    ...overrides,
  };
}

function agentRequest(): OrchestratorChatRequest {
  return {
    requestId: "request-1",
    turnId: "turn-1",
    subjectRef: "employee-1",
    sessionRef: "session-1",
    conversationRef: "conversation-1",
    deviceRef: "device-1",
    applicationId: "lens-employee-client",
    workspaceRef: "default-workspace",
    purposeRef: "assistant",
    retrievalClass: "enterprise-grounded",
    capability: "grounded-assistant",
    inputText: "summarize my documents",
    queryDigest: `sha256:${"b".repeat(64)}`,
    deadlineAt: Date.now() - 1,
    retryBudget: 0,
    bulkhead: "interactive",
    delegatedSessionAssertion: "test-proof",
    agentMode: true,
  };
}

function service(agentPolicyReplica?: ReturnType<typeof loadAgentPolicyReplica>): ProductionOrchestratorService {
  return new ProductionOrchestratorService({
    ragProfile,
    agentPolicyReplica,
    retrieval: { retrieve: async () => { throw new Error("Agent policy gate must run before retrieval."); } },
  });
}

describe("M7 dev agent facts", () => {
  it("devfacts.production-refuses-flag", async () => {
    await expect(main(env({
      ORCHESTRATOR_AUTHORITY_PROFILE: "production",
      LENS_ORCHESTRATOR_ALLOW_DEV_AGENT_FACTS: "true",
      LENS_ORCHESTRATOR_DEV_AGENT_SIGNING_KEY: "a".repeat(64),
    }))).rejects.toThrow("Production must not enable LENS_ORCHESTRATOR_ALLOW_DEV_AGENT_FACTS.");
  });

  it("devfacts.missing-key-refuses", async () => {
    await expect(main(env({ LENS_ORCHESTRATOR_ALLOW_DEV_AGENT_FACTS: "true" }))).rejects.toThrow(/LENS_ORCHESTRATOR_DEV_AGENT_SIGNING_KEY/);
  });

  it("devfacts.absent-is-fail-closed", async () => {
    expect(loadAgentPolicyReplica(env(), {})).toBeUndefined();
    await expect(service().handleChat(agentRequest(), new AbortController().signal)).resolves.toMatchObject({
      status: "DENIED",
      error: "FORBIDDEN",
    });
  });

  it("devfacts.enabled-wires-replica", async () => {
    const replica = loadAgentPolicyReplica(env({ LENS_ORCHESTRATOR_ALLOW_DEV_AGENT_FACTS: "true", LENS_ORCHESTRATOR_DEV_AGENT_SIGNING_KEY: "a".repeat(64) }), {});
    const decision = replica!.pdp.decideBatch({
      requestId: "request-1",
      callerWorkloadRef: "orchestrator-agent-harness",
      subjectRef: "employee-1",
      deviceRef: "device-1",
      action: "agent-tool",
      resourceRefs: ["doc-1"],
      normalizedContextDigest: `sha256:${"b".repeat(64)}`,
      useBoundary: "tool_boundary",
      deadlineAt: Date.now() + 30_000,
    });
    expect(decision.allowed).toEqual(["doc-1"]);
    expect(decision.fence).toBeDefined();
    await expect(service(replica).handleChat(agentRequest(), new AbortController().signal)).resolves.toMatchObject({ status: "INCOMPLETE" });
  });

  it("devfacts.bundle-digest-is-marked", () => {
    const replica = loadAgentPolicyReplica(env({ LENS_ORCHESTRATOR_ALLOW_DEV_AGENT_FACTS: "true", LENS_ORCHESTRATOR_DEV_AGENT_SIGNING_KEY: "a".repeat(64) }), {});
    expect(replica!.policyDigest).toMatch(/^dev-agent-facts:/);
    expect(replica!.policyDigest).not.toMatch(/^sha256:/);
  });
});
