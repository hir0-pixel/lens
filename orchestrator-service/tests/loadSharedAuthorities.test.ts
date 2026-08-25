import { describe, expect, it } from "vitest";
import { loadSharedAuthorities, type OrchestratorMainDependencies, type OrchestratorServiceEnv } from "../src/main";
import { FailClosedModelUseAuthorityPort } from "../../services/pdp/ModelUseAuthority";
import { FailClosedCostAuthority } from "../../services/cost-authority/CostAuthority";
import { FailClosedAgentRunAuthority } from "../../services/agent-run-authority/AgentRunAuthority";
import { FailClosedReceiptVerifier } from "../../services/security/authorityReceipt";
import { FailClosedClaimStore } from "../../services/security/replayClaimStore";

const NOW = 1_700_000_000_000;

function baseEnv(overrides: Partial<OrchestratorServiceEnv> = {}): OrchestratorServiceEnv {
  return {
    ORCHESTRATOR_WORKLOAD_TOKEN: "x".repeat(32),
    RETRIEVAL_URL: "http://retrieval.internal",
    RETRIEVAL_WORKLOAD_TOKEN: "x".repeat(32),
    MODEL_RUNTIME_URL: "http://runtime.internal",
    MODEL_RUNTIME_WORKLOAD_TOKEN: "x".repeat(32),
    MODEL_ARTIFACT_DIGEST: `sha256:${"a".repeat(64)}`,
    AUTHORITY_URL: "http://authority.internal",
    AUTHORITY_WORKLOAD_TOKEN: "x".repeat(32),
    ...overrides,
  };
}

const modelEligibility = {
  resolveEndpoint: async () => ({ endpointRef: "endpoint-1", snapshotExpiresAt: NOW + 60_000, external: false }),
  currentDenyEpoch: () => 0,
};

describe("loadSharedAuthorities", () => {
  it("throws when ORCHESTRATOR_AUTHORITY_PROFILE is unset or not one of development/test/production", () => {
    expect(() => loadSharedAuthorities(baseEnv(), {}, modelEligibility, () => NOW)).toThrow(/ORCHESTRATOR_AUTHORITY_PROFILE/);
    expect(() => loadSharedAuthorities(baseEnv({ ORCHESTRATOR_AUTHORITY_PROFILE: "staging" }), {}, modelEligibility, () => NOW)).toThrow(/ORCHESTRATOR_AUTHORITY_PROFILE/);
  });

  it("production without every injected adapter throws — local stand-ins are never accepted", () => {
    const env = baseEnv({ ORCHESTRATOR_AUTHORITY_PROFILE: "production" });
    expect(() => loadSharedAuthorities(env, {}, modelEligibility, () => NOW)).toThrow(/LENS_COST_AUTHORITY_URL/);
    const partial: OrchestratorMainDependencies = {
      productionModelUseAuthority: new FailClosedModelUseAuthorityPort(),
      productionCostAuthority: new FailClosedCostAuthority(),
      // agentRunAuthority, receiptVerifier, claimStore, and readiness are still missing.
    };
    expect(() => loadSharedAuthorities(env, partial, modelEligibility, () => NOW)).toThrow(/LENS_COST_AUTHORITY_URL/);
  });

  it("production rejects in-memory/SQLite escape hatches even when adapters are otherwise fully supplied", () => {
    const full: OrchestratorMainDependencies = {
      productionModelUseAuthority: new FailClosedModelUseAuthorityPort(),
      productionCostAuthority: new FailClosedCostAuthority(),
      productionAgentRunAuthority: new FailClosedAgentRunAuthority(),
      productionReceiptVerifier: new FailClosedReceiptVerifier(),
      productionClaimStore: new FailClosedClaimStore(),
      productionAuthoritiesReady: async () => true,
    };
    const env = baseEnv({ ORCHESTRATOR_AUTHORITY_PROFILE: "production", ALLOW_IN_MEMORY_AUTHORITIES: "true" });
    expect(() => loadSharedAuthorities(env, full, modelEligibility, () => NOW)).toThrow(/development\/test-only/);
  });

  it("production with every adapter injected returns exactly those adapters, unmodified", () => {
    const modelUseAuthority = new FailClosedModelUseAuthorityPort();
    const costAuthority = new FailClosedCostAuthority();
    const agentRunAuthority = new FailClosedAgentRunAuthority();
    const receiptVerifier = new FailClosedReceiptVerifier();
    const claimStore = new FailClosedClaimStore();
    const ready = async () => true;
    const env = baseEnv({ ORCHESTRATOR_AUTHORITY_PROFILE: "production" });
    const result = loadSharedAuthorities(env, {
      productionModelUseAuthority: modelUseAuthority,
      productionCostAuthority: costAuthority,
      productionAgentRunAuthority: agentRunAuthority,
      productionReceiptVerifier: receiptVerifier,
      productionClaimStore: claimStore,
      productionAuthoritiesReady: ready,
    }, modelEligibility, () => NOW);
    expect(result.modelUseAuthority).toBe(modelUseAuthority);
    expect(result.costAuthority).toBe(costAuthority);
    expect(result.agentRunAuthority).toBe(agentRunAuthority);
    expect(result.receiptVerifier).toBe(receiptVerifier);
    expect(result.claimStore).toBe(claimStore);
    expect(result.ready).toBe(ready);
  });

  it("development without a durable path or the in-memory flag throws", () => {
    const env = baseEnv({ ORCHESTRATOR_AUTHORITY_PROFILE: "development" });
    expect(() => loadSharedAuthorities(env, {}, modelEligibility, () => NOW)).toThrow(/LENS_COST_AUTHORITY_DB_PATH/);
  });

  it("development with LENS_ALLOW_IN_MEMORY_AUTHORITIES=true builds a real, working bundle end-to-end", async () => {
    const env = baseEnv({ ORCHESTRATOR_AUTHORITY_PROFILE: "development", ALLOW_IN_MEMORY_AUTHORITIES: "true" });
    const bundle = loadSharedAuthorities(env, {}, modelEligibility, () => NOW);
    expect(await bundle.ready()).toBe(true);

    const signal = new AbortController().signal;
    const generate = await bundle.modelUseAuthority.authorizeGenerate({
      requestId: "req-1",
      requestDigest: `sha256:${"b".repeat(64)}`,
      subjectRef: "subject-1",
      deviceRef: "device-1",
      sessionRef: "session-1",
      applicationRef: "lens-employee-client",
      workspaceRef: "default-workspace",
      purposeRef: "assistant",
      requestClass: "enterprise-grounded",
      deadlineAt: NOW + 30_000,
    }, signal);
    const claims = bundle.receiptVerifier.verify(generate.token, { purpose: "authorize_generate", requestId: "req-1" });
    expect(claims.subjectRef).toBe("subject-1");

    const { reservationRef } = await bundle.costAuthority.reserveWorkflowBudget({
      requestId: "req-1",
      turnId: "turn-1",
      reservationRef: "workflow:req-1",
      idempotencyKey: "req-1",
      subEnvelopes: { route: { maximumUnits: 1 }, retrieval: { maximumUnits: 1 }, final_generation: { maximumUnits: 1 }, tool: { maximumUnits: 1 } },
      expiresAt: NOW + 30_000,
    }, signal);
    expect(reservationRef).toBe("workflow:req-1");

    const claimed = await bundle.claimStore.claim("test-kind", "claim-1", "req-1", NOW);
    expect(claimed).toBe(true);
    expect(await bundle.claimStore.claim("test-kind", "claim-1", "req-1", NOW)).toBe(false);
  });
});
