import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AgentRunAuthorityHttpClient } from "../../services/agent-run-authority/AgentRunAuthorityHttpClient";
import { RelationalRuntimeAttemptStore } from "../../services/runtime-attempt/RelationalRuntimeAttemptStore";
import { createSqlitePgCompatPool } from "../../services/storage/pgPool";
import { PostgresCostAuthority } from "../../services/cost-authority/PostgresCostAuthority";
import { AuthorityReceiptIssuer } from "../../services/security/authorityReceipt";
import { loadSharedAuthorities, type OrchestratorServiceEnv } from "../src/main";
import { ModelUseAuthorityHttpClient } from "../../services/pdp/ModelUseAuthorityHttpClient";
import { CostAuthorityHttpClient } from "../../services/cost-authority/CostAuthorityHttpClient";
import { CompositeReceiptVerifier } from "../../services/security/compositeReceiptVerifier";

const TOKEN = "c".repeat(40);

function pemPair() {
  return generateKeyPairSync("ed25519");
}

describe("production network authorities and Doc 012 attempt store", () => {
  it("production loadSharedAuthorities constructs network clients from env without injection", () => {
    const keys = pemPair();
    const pub = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    const env: OrchestratorServiceEnv = {
      ORCHESTRATOR_WORKLOAD_TOKEN: TOKEN,
      RETRIEVAL_URL: "http://127.0.0.1:1",
      RETRIEVAL_WORKLOAD_TOKEN: TOKEN,
      MODEL_RUNTIME_URL: "http://127.0.0.1:1",
      MODEL_RUNTIME_WORKLOAD_TOKEN: TOKEN,
      MODEL_ARTIFACT_DIGEST: `sha256:${"a".repeat(64)}`,
      AUTHORITY_URL: "http://127.0.0.1:8790",
      AUTHORITY_WORKLOAD_TOKEN: TOKEN,
      ORCHESTRATOR_AUTHORITY_PROFILE: "production",
      COST_AUTHORITY_URL: "http://127.0.0.1:8791",
      COST_AUTHORITY_WORKLOAD_TOKEN: TOKEN,
      AGENT_RUN_AUTHORITY_URL: "http://127.0.0.1:8792",
      AGENT_RUN_AUTHORITY_WORKLOAD_TOKEN: TOKEN,
      MODEL_USE_RECEIPT_PUBLIC_KEY: pub,
      COST_RECEIPT_PUBLIC_KEY: pub,
      AGENT_RUN_RECEIPT_PUBLIC_KEY: pub,
      SCHEDULER_LEASE_PUBLIC_KEY: pub,
    };
    const bundle = loadSharedAuthorities(env, {}, { resolveEndpoint: async () => ({ endpointRef: "e", snapshotExpiresAt: Date.now() + 1_000, external: false }), currentDenyEpoch: () => 0 });
    expect(bundle.modelUseAuthority).toBeInstanceOf(ModelUseAuthorityHttpClient);
    expect(bundle.costAuthority).toBeInstanceOf(CostAuthorityHttpClient);
    expect(bundle.agentRunAuthority).toBeInstanceOf(AgentRunAuthorityHttpClient);
    expect(bundle.receiptVerifier).toBeInstanceOf(CompositeReceiptVerifier);
  });

  it("two replicas cannot overspend or borrow envelopes; duplicate reservation has one winner", async () => {
    const keys = pemPair();
    const issuer = new AuthorityReceiptIssuer(keys.privateKey);
    const pool = createSqlitePgCompatPool(":memory:");
    const a = new PostgresCostAuthority(pool, issuer);
    const b = new PostgresCostAuthority(pool, issuer);
    await a.ready();
    const signal = new AbortController().signal;
    const input = {
      requestId: "r1",
      turnId: "t1",
      reservationRef: "workflow:r1",
      idempotencyKey: "r1",
      subEnvelopes: { route: { maximumUnits: 10 }, retrieval: { maximumUnits: 10 }, final_generation: { maximumUnits: 10 }, tool: { maximumUnits: 10 } },
      expiresAt: Date.now() + 30_000,
      workflowProfileDigest: `sha256:${"b".repeat(64)}` as const,
    };
    const first = await a.reserveWorkflowBudget(input, signal);
    const second = await b.reserveWorkflowBudget(input, signal);
    expect(first.reservationRef).toBe(second.reservationRef);
    await a.consumeSubEnvelope({ reservationRef: "workflow:r1", subEnvelope: "route", units: 6, requestId: "r1", turnId: "t1", stepId: "s1", idempotencyKey: "s1", expiresAt: Date.now() + 30_000 }, signal);
    await expect(b.consumeSubEnvelope({ reservationRef: "workflow:r1", subEnvelope: "route", units: 6, requestId: "r1", turnId: "t1", stepId: "s2", idempotencyKey: "s2", expiresAt: Date.now() + 30_000 }, signal)).rejects.toThrow(/exceed/);
    await b.consumeSubEnvelope({ reservationRef: "workflow:r1", subEnvelope: "retrieval", units: 6, requestId: "r1", turnId: "t1", stepId: "s3", idempotencyKey: "s3", expiresAt: Date.now() + 30_000 }, signal);
    const status = await a.getWorkflowBudgetStatus("workflow:r1", signal);
    expect(status.subEnvelopes.route.consumedUnits).toBe(6);
    expect(status.subEnvelopes.retrieval.consumedUnits).toBe(6);
    await a.finalizeSubEnvelope({ reservationRef: "workflow:r1", subEnvelope: "route", measuredUnits: 1, idempotencyKey: "f-route" }, signal);
    expect((await a.getWorkflowBudgetStatus("workflow:r1", signal)).subEnvelopes.route.consumedUnits).toBe(6);
  });

  it("crash between attempt-store writes yields NOT_STARTED or OUTCOME_UNKNOWN and never auto-replays UNKNOWN", async () => {
    const pool = createSqlitePgCompatPool(":memory:");
    let crash: "accept" | "contact" | undefined = "accept";
    const store = new RelationalRuntimeAttemptStore(pool, {
      afterAccept: () => { if (crash === "accept") throw new Error("crash-after-accept"); },
      afterContactIntent: () => { if (crash === "contact") throw new Error("crash-after-contact"); },
    });
    await store.ready();
    const input = {
      reservationId: "reservation:crash",
      logicalAttemptId: "r:t:s",
      attemptGeneration: 1,
      requestId: "r",
      turnId: "t",
      stepId: "s",
      requestDigest: "digest",
      modelRef: "m",
      artifactDigest: `sha256:${"c".repeat(64)}` as const,
      endpointGeneration: "1",
      deadlineAt: Date.now() + 5_000,
    };
    await expect(store.accept(input)).rejects.toThrow(/crash-after-accept/);
    const afterAccept = await store.getAttemptStatus(input.reservationId);
    expect(afterAccept.state).toBe("ACCEPTED_NOT_CONTACTED");
    await store.markNotStarted(input.reservationId, true);
    expect((await store.getAttemptStatus(input.reservationId)).state).toBe("NOT_STARTED");

    crash = undefined;
    await store.accept({ ...input, reservationId: "reservation:crash-2", attemptGeneration: 2 });
    await store.bindSchedulerLease("reservation:crash-2", {
      fence: 1,
      endpointRef: "endpoint",
      endpointGeneration: "1",
      requestDigest: "digest",
      expiresAt: Date.now() + 5_000,
    });
    crash = "contact";
    await expect(store.commitContactIntent("reservation:crash-2")).rejects.toThrow(/crash-after-contact/);
    const mid = await store.getAttemptStatus("reservation:crash-2");
    expect(mid.state).toBe("CONTACT_INTENT_COMMITTED");
    await store.markOutcomeUnknown("reservation:crash-2");
    expect((await store.getAttemptStatus("reservation:crash-2")).state).toBe("OUTCOME_UNKNOWN");
    await expect(store.accept({ ...input, reservationId: "reservation:crash-2" })).rejects.toThrow(/already exists/);
  });
});
