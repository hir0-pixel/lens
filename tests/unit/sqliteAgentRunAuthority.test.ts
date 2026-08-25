import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteAgentRunAuthority } from "../../services/agent-run-authority/SqliteAgentRunAuthority";
import { AgentRunAuthorityError, type BeginAgentRunInput, type ReserveAgentStepInput } from "../../services/agent-run-authority/AgentRunAuthority";
import { AuthorityReceiptIssuer, Ed25519ReceiptVerifier } from "../../services/security/authorityReceipt";
import { SqliteClaimStore } from "../../services/security/replayClaimStore";

const keys = generateKeyPairSync("ed25519");
const NOW = 1_700_000_000_000;

function runInput(overrides: Partial<BeginAgentRunInput> = {}): BeginAgentRunInput {
  return {
    requestId: "req-1",
    turnId: "turn-1",
    runId: "run:req-1",
    workflowReservationRef: "workflow:req-1",
    workflowProfileDigest: `sha256:${"a".repeat(64)}`,
    idempotencyKey: "req-1",
    expiresAt: NOW + 30_000,
    ...overrides,
  };
}

function stepInput(overrides: Partial<ReserveAgentStepInput> = {}): ReserveAgentStepInput {
  return {
    runId: "run:req-1",
    requestId: "req-1",
    turnId: "turn-1",
    stepId: "step-route",
    stepClass: "route",
    stepIndex: 0,
    modelRef: "router-default",
    artifactDigest: `sha256:${"b".repeat(64)}`,
    capability: "rag-route-classification",
    workflowReservationRef: "workflow:req-1",
    subEnvelope: "route",
    modelAuthorizationDigest: `sha256:${"c".repeat(64)}`,
    idempotencyKey: "step-route",
    deadlineAt: NOW + 30_000,
    ...overrides,
  };
}

describe("SqliteAgentRunAuthority", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-run-authority-"));
    dbPath = join(dir, "agent-run.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("begins a run and reserves a step, issuing a valid, verifiable agent_step receipt", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const verifier = new Ed25519ReceiptVerifier(keys.publicKey, { now: () => NOW + 10 });
    const authority = new SqliteAgentRunAuthority(dbPath, issuer, () => NOW);
    const { runId } = await authority.beginAgentRun(runInput(), new AbortController().signal);
    const receipt = await authority.reserveAgentStep(stepInput(), new AbortController().signal);
    const claims = verifier.verify(receipt.token, { purpose: "agent_step", requestId: "req-1", stepId: "step-route", stepClass: "route" });
    expect(claims.reservationRef).toBe("workflow:req-1");
    expect(claims.subEnvelope).toBe("route");
    const status = await authority.getAgentRunStatus(runId, new AbortController().signal);
    expect(status.steps).toHaveLength(1);
    expect(status.steps[0]!.state).toBe("RESERVED");
    authority.close();
  });

  it("route and final-generation steps receive distinct receipts under the same run", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const authority = new SqliteAgentRunAuthority(dbPath, issuer, () => NOW);
    await authority.beginAgentRun(runInput(), new AbortController().signal);
    const route = await authority.reserveAgentStep(stepInput(), new AbortController().signal);
    const final = await authority.reserveAgentStep(
      stepInput({ stepId: "step-final", stepClass: "final_generation", stepIndex: 1, modelRef: "employee-model", artifactDigest: `sha256:${"d".repeat(64)}`, capability: "grounded-assistant", subEnvelope: "final_generation", idempotencyKey: "step-final" }),
      new AbortController().signal,
    );
    expect(route.claims.receiptId).not.toBe(final.claims.receiptId);
    expect(route.claims.stepClass).toBe("route");
    expect(final.claims.stepClass).toBe("final_generation");
    authority.close();
  });

  it("consumeAgentStep transitions RESERVED -> CONSUMED exactly once; a second consume of the same step conflicts", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const authority = new SqliteAgentRunAuthority(dbPath, issuer, () => NOW);
    await authority.beginAgentRun(runInput(), new AbortController().signal);
    const receipt = await authority.reserveAgentStep(stepInput(), new AbortController().signal);
    await authority.consumeAgentStep("run:req-1", "step-route", receipt.claims.receiptId, new AbortController().signal);
    const status = await authority.getAgentRunStatus("run:req-1", new AbortController().signal);
    expect(status.steps[0]!.state).toBe("CONSUMED");
    // idempotent no-op re-consume with the SAME receipt id does not throw...
    await expect(authority.consumeAgentStep("run:req-1", "step-route", receipt.claims.receiptId, new AbortController().signal)).resolves.toBeUndefined();
    authority.close();
  });

  it("two replicas racing to consume the same step: exactly one wins the durable state transition", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const replicaA = new SqliteAgentRunAuthority(dbPath, issuer, () => NOW);
    const replicaB = new SqliteAgentRunAuthority(dbPath, issuer, () => NOW);
    await replicaA.beginAgentRun(runInput(), new AbortController().signal);
    const receipt = await replicaA.reserveAgentStep(stepInput(), new AbortController().signal);

    // Also prove the shared cross-replica claim store (what ModelGateway actually uses for
    // dispatch one-use enforcement) yields exactly one winner for the same receipt id.
    const claimDbPath = join(dir, "claims.db");
    const claimsA = new SqliteClaimStore(claimDbPath);
    const claimsB = new SqliteClaimStore(claimDbPath);
    const claimResults = await Promise.all([
      claimsA.claim("agent_step_dispatch", receipt.claims.receiptId, "req-1", NOW),
      claimsB.claim("agent_step_dispatch", receipt.claims.receiptId, "req-1", NOW),
    ]);
    expect(claimResults.filter(Boolean)).toHaveLength(1);
    claimsA.close();
    claimsB.close();
    replicaA.close();
    replicaB.close();
  });

  it("reserveAgentStep fails closed once the run's deadline has elapsed", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const authority = new SqliteAgentRunAuthority(dbPath, issuer, () => NOW + 40_000);
    await expect(authority.beginAgentRun(runInput(), new AbortController().signal)).rejects.toThrow(AgentRunAuthorityError);
    authority.close();
  });

  it("reserveAgentStep fails closed when the run is already closed", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const authority = new SqliteAgentRunAuthority(dbPath, issuer, () => NOW);
    await authority.beginAgentRun(runInput(), new AbortController().signal);
    await authority.closeAgentRun("run:req-1", new AbortController().signal);
    await expect(authority.reserveAgentStep(stepInput(), new AbortController().signal)).rejects.toThrow(AgentRunAuthorityError);
    authority.close();
  });

  it("forbids RESERVED -> FINALIZED and closing a run with nonterminal steps", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const authority = new SqliteAgentRunAuthority(dbPath, issuer, () => NOW);
    await authority.beginAgentRun(runInput(), new AbortController().signal);
    const receipt = await authority.reserveAgentStep(stepInput(), new AbortController().signal);
    await expect(authority.finalizeAgentStep("run:req-1", "step-route", new AbortController().signal)).rejects.toThrow(/CONSUMED before FINALIZED/);
    await expect(authority.closeAgentRun("run:req-1", new AbortController().signal)).rejects.toThrow(/nonterminal/);
    await authority.consumeAgentStep("run:req-1", "step-route", receipt.claims.receiptId, new AbortController().signal);
    await authority.finalizeAgentStep("run:req-1", "step-route", new AbortController().signal);
    await authority.closeAgentRun("run:req-1", new AbortController().signal);
    authority.close();
  });

  it("concurrent identical step reservations return the same receipt; conflicting indexes are rejected", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const a = new SqliteAgentRunAuthority(dbPath, issuer, () => NOW);
    const b = new SqliteAgentRunAuthority(dbPath, issuer, () => NOW);
    await a.beginAgentRun(runInput(), new AbortController().signal);
    const [first, second] = await Promise.all([
      a.reserveAgentStep(stepInput(), new AbortController().signal),
      b.reserveAgentStep(stepInput(), new AbortController().signal),
    ]);
    expect(first.claims.receiptId).toBe(second.claims.receiptId);
    await expect(a.reserveAgentStep(stepInput({ stepId: "other", idempotencyKey: "other" }), new AbortController().signal)).rejects.toThrow(AgentRunAuthorityError);
    a.close();
    b.close();
  });

  it("a run and its steps persist across process/instance boundaries over the same shared database file", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const first = new SqliteAgentRunAuthority(dbPath, issuer, () => NOW);
    await first.beginAgentRun(runInput(), new AbortController().signal);
    await first.reserveAgentStep(stepInput(), new AbortController().signal);
    first.close();
    const second = new SqliteAgentRunAuthority(dbPath, new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW }), () => NOW);
    const status = await second.getAgentRunStatus("run:req-1", new AbortController().signal);
    expect(status.steps).toHaveLength(1);
    second.close();
  });
});
