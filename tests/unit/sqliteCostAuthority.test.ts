import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteCostAuthority } from "../../services/cost-authority/SqliteCostAuthority";
import { CostAuthorityError, type ReserveWorkflowBudgetInput } from "../../services/cost-authority/CostAuthority";
import { AuthorityReceiptIssuer, Ed25519ReceiptVerifier } from "../../services/security/authorityReceipt";

const keys = generateKeyPairSync("ed25519");
const NOW = 1_700_000_000_000;

function reservationInput(overrides: Partial<ReserveWorkflowBudgetInput> = {}): ReserveWorkflowBudgetInput {
  return {
    requestId: "req-1",
    turnId: "turn-1",
    reservationRef: "workflow:req-1",
    idempotencyKey: "req-1",
    expiresAt: NOW + 30_000,
    subEnvelopes: {
      route: { maximumUnits: 100 },
      retrieval: { maximumUnits: 100 },
      final_generation: { maximumUnits: 100 },
      tool: { maximumUnits: 100 },
    },
    ...overrides,
  };
}

describe("SqliteCostAuthority", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cost-authority-"));
    dbPath = join(dir, "cost.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reserves one workflow budget with four independent sub-envelopes", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const authority = new SqliteCostAuthority(dbPath, issuer, () => NOW);
    const { reservationRef, revision } = await authority.reserveWorkflowBudget(reservationInput(), new AbortController().signal);
    expect(reservationRef).toBe("workflow:req-1");
    expect(revision).toBe(1);
    const status = await authority.getWorkflowBudgetStatus(reservationRef, new AbortController().signal);
    expect(Object.keys(status.subEnvelopes).sort()).toEqual(["final_generation", "retrieval", "route", "tool"]);
    authority.close();
  });

  it("consuming a sub-envelope issues a valid, verifiable receipt", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const verifier = new Ed25519ReceiptVerifier(keys.publicKey, { now: () => NOW + 10 });
    const authority = new SqliteCostAuthority(dbPath, issuer, () => NOW);
    await authority.reserveWorkflowBudget(reservationInput(), new AbortController().signal);
    const receipt = await authority.consumeSubEnvelope(
      { reservationRef: "workflow:req-1", subEnvelope: "route", units: 10, requestId: "req-1", turnId: "turn-1", stepId: "step-route", idempotencyKey: "consume-1", expiresAt: NOW + 30_000 },
      new AbortController().signal,
    );
    const claims = verifier.verify(receipt.token, { purpose: "cost_sub_envelope_consumption", requestId: "req-1", reservationRef: "workflow:req-1", subEnvelope: "route" });
    expect(claims.stepId).toBe("step-route");
    authority.close();
  });

  it("rejects consumption that would exceed a sub-envelope's own maximum (no overspend)", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const authority = new SqliteCostAuthority(dbPath, issuer, () => NOW);
    await authority.reserveWorkflowBudget(reservationInput({ subEnvelopes: { route: { maximumUnits: 10 }, retrieval: { maximumUnits: 10 }, final_generation: { maximumUnits: 10 }, tool: { maximumUnits: 10 } } }), new AbortController().signal);
    await expect(
      authority.consumeSubEnvelope({ reservationRef: "workflow:req-1", subEnvelope: "route", units: 20, requestId: "req-1", turnId: "turn-1", stepId: "step-route", idempotencyKey: "c1", expiresAt: NOW + 30_000 }, new AbortController().signal),
    ).rejects.toThrow(CostAuthorityError);
    authority.close();
  });

  it("sub-envelopes are non-interchangeable: consuming route does not reduce final_generation's remaining budget (no cross-envelope borrowing)", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const authority = new SqliteCostAuthority(dbPath, issuer, () => NOW);
    await authority.reserveWorkflowBudget(reservationInput({ subEnvelopes: { route: { maximumUnits: 5 }, retrieval: { maximumUnits: 5 }, final_generation: { maximumUnits: 5 }, tool: { maximumUnits: 5 } } }), new AbortController().signal);
    await authority.consumeSubEnvelope({ reservationRef: "workflow:req-1", subEnvelope: "route", units: 5, requestId: "req-1", turnId: "turn-1", stepId: "step-route", idempotencyKey: "c1", expiresAt: NOW + 30_000 }, new AbortController().signal);
    // route is now fully consumed; final_generation must still accept its own full 5 units.
    const receipt = await authority.consumeSubEnvelope({ reservationRef: "workflow:req-1", subEnvelope: "final_generation", units: 5, requestId: "req-1", turnId: "turn-1", stepId: "step-final", idempotencyKey: "c2", expiresAt: NOW + 30_000 }, new AbortController().signal);
    expect(receipt.claims.subEnvelope).toBe("final_generation");
    // and route itself now rejects any further consumption, proving it wasn't topped back up.
    await expect(
      authority.consumeSubEnvelope({ reservationRef: "workflow:req-1", subEnvelope: "route", units: 1, requestId: "req-1", turnId: "turn-1", stepId: "step-route-2", idempotencyKey: "c3", expiresAt: NOW + 30_000 }, new AbortController().signal),
    ).rejects.toThrow(CostAuthorityError);
    authority.close();
  });

  it("a retried consumption with the same idempotency key and unit amount returns the same receipt, not a second charge", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const authority = new SqliteCostAuthority(dbPath, issuer, () => NOW);
    await authority.reserveWorkflowBudget(reservationInput(), new AbortController().signal);
    const first = await authority.consumeSubEnvelope({ reservationRef: "workflow:req-1", subEnvelope: "route", units: 10, requestId: "req-1", turnId: "turn-1", stepId: "step-route", idempotencyKey: "same-key", expiresAt: NOW + 30_000 }, new AbortController().signal);
    const second = await authority.consumeSubEnvelope({ reservationRef: "workflow:req-1", subEnvelope: "route", units: 10, requestId: "req-1", turnId: "turn-1", stepId: "step-route", idempotencyKey: "same-key", expiresAt: NOW + 30_000 }, new AbortController().signal);
    expect(second.claims.receiptId).toBe(first.claims.receiptId);
    const status = await authority.getWorkflowBudgetStatus("workflow:req-1", new AbortController().signal);
    expect(status.subEnvelopes.route.consumedUnits).toBe(10);
    authority.close();
  });

  it("two replicas racing to overspend the same sub-envelope: concurrent consumption cannot together exceed the cap", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const replicaA = new SqliteCostAuthority(dbPath, issuer, () => NOW);
    const replicaB = new SqliteCostAuthority(dbPath, issuer, () => NOW);
    await replicaA.reserveWorkflowBudget(reservationInput({ subEnvelopes: { route: { maximumUnits: 10 }, retrieval: { maximumUnits: 10 }, final_generation: { maximumUnits: 10 }, tool: { maximumUnits: 10 } } }), new AbortController().signal);

    const attempts = await Promise.allSettled([
      replicaA.consumeSubEnvelope({ reservationRef: "workflow:req-1", subEnvelope: "route", units: 7, requestId: "req-1", turnId: "turn-1", stepId: "a", idempotencyKey: "race-a", expiresAt: NOW + 30_000 }, new AbortController().signal),
      replicaB.consumeSubEnvelope({ reservationRef: "workflow:req-1", subEnvelope: "route", units: 7, requestId: "req-1", turnId: "turn-1", stepId: "b", idempotencyKey: "race-b", expiresAt: NOW + 30_000 }, new AbortController().signal),
    ]);
    const succeeded = attempts.filter((a) => a.status === "fulfilled");
    expect(succeeded).toHaveLength(1);
    const status = await replicaA.getWorkflowBudgetStatus("workflow:req-1", new AbortController().signal);
    expect(status.subEnvelopes.route.consumedUnits).toBeLessThanOrEqual(10);
    replicaA.close();
    replicaB.close();
  });

  it("reservation and envelopes commit atomically; crash after parent insert leaves no reservation", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const authority = new SqliteCostAuthority(dbPath, issuer, () => NOW, 30_000, {
      afterReserveParent: () => { throw new Error("crash-after-parent"); },
    });
    await expect(authority.reserveWorkflowBudget(reservationInput(), new AbortController().signal)).rejects.toThrow(/crash-after-parent/);
    await expect(authority.getWorkflowBudgetStatus("workflow:req-1", new AbortController().signal)).rejects.toThrow(CostAuthorityError);
    authority.close();
  });

  it("concurrent identical consume keys charge once; different keys cannot overspend", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const a = new SqliteCostAuthority(dbPath, issuer, () => NOW);
    const b = new SqliteCostAuthority(dbPath, issuer, () => NOW);
    await a.reserveWorkflowBudget(reservationInput({ subEnvelopes: { route: { maximumUnits: 10 }, retrieval: { maximumUnits: 10 }, final_generation: { maximumUnits: 10 }, tool: { maximumUnits: 10 } } }), new AbortController().signal);
    const consume = (replica: SqliteCostAuthority, key: string, units: number, step: string) => replica.consumeSubEnvelope({
      reservationRef: "workflow:req-1", subEnvelope: "route", units, requestId: "req-1", turnId: "turn-1", stepId: step, idempotencyKey: key, expiresAt: NOW + 30_000,
    }, new AbortController().signal);
    const [x, y] = await Promise.all([consume(a, "same", 4, "s1"), consume(b, "same", 4, "s1")]);
    expect(x.claims.receiptId).toBe(y.claims.receiptId);
    await expect(consume(a, "same", 5, "s1")).rejects.toThrow(CostAuthorityError);
    const raced = await Promise.allSettled([consume(a, "k-a", 5, "sa"), consume(b, "k-b", 5, "sb")]);
    expect(raced.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    a.close();
    b.close();
  });

  it("finalizing a sub-envelope with measured usage locks it against further consumption", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const authority = new SqliteCostAuthority(dbPath, issuer, () => NOW);
    await authority.reserveWorkflowBudget(reservationInput(), new AbortController().signal);
    await authority.consumeSubEnvelope({ reservationRef: "workflow:req-1", subEnvelope: "route", units: 10, requestId: "req-1", turnId: "turn-1", stepId: "step-route", idempotencyKey: "c1", expiresAt: NOW + 30_000 }, new AbortController().signal);
    await authority.finalizeSubEnvelope({ reservationRef: "workflow:req-1", subEnvelope: "route", measuredUnits: 8, idempotencyKey: "f1" }, new AbortController().signal);
    const status = await authority.getWorkflowBudgetStatus("workflow:req-1", new AbortController().signal);
    expect(status.subEnvelopes.route.consumedUnits).toBe(10);
    expect(status.subEnvelopes.route.state).toBe("FINALIZED");
    await expect(
      authority.consumeSubEnvelope({ reservationRef: "workflow:req-1", subEnvelope: "route", units: 1, requestId: "req-1", turnId: "turn-1", stepId: "step-route-2", idempotencyKey: "c2", expiresAt: NOW + 30_000 }, new AbortController().signal),
    ).rejects.toThrow(CostAuthorityError);
    authority.close();
  });

  it("a reservation persists across process/instance boundaries over the same shared database file", async () => {
    const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW });
    const first = new SqliteCostAuthority(dbPath, issuer, () => NOW);
    await first.reserveWorkflowBudget(reservationInput(), new AbortController().signal);
    first.close();
    const second = new SqliteCostAuthority(dbPath, new AuthorityReceiptIssuer(keys.privateKey, { now: () => NOW }), () => NOW);
    const status = await second.getWorkflowBudgetStatus("workflow:req-1", new AbortController().signal);
    expect(status.requestId).toBe("req-1");
    second.close();
  });
});
