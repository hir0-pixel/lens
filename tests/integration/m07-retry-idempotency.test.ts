import { createHash, generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GpuScheduler } from "../../services/gpu-scheduler/GpuScheduler";
import { ModelGateway, ModelGatewayError, type ModelGatewayAuthority, type ModelGatewayDispatchInput, type RuntimeReceipt, type RuntimePort } from "../../services/model-gateway/ModelGateway";
import { AuthorityReceiptIssuer, Ed25519ReceiptVerifier } from "../../services/security/authorityReceipt";
import { SqliteClaimStore } from "../../services/security/replayClaimStore";
import { RelationalRuntimeAttemptStore } from "../../services/runtime-attempt/RelationalRuntimeAttemptStore";
import { createSqlitePgCompatPool } from "../../services/storage/pgPool";

const now = () => 1_000;
const keys = generateKeyPairSync("ed25519");
const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now });
const verifier = new Ed25519ReceiptVerifier(keys.publicKey, { now });
const ARTIFACT: `sha256:${string}` = "sha256:model-digest-1234567890123456789012345678901234567890";

function digestOf(token: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

function mintAuthority(overrides: { stepId?: string; stepClass?: "route" | "final_generation" | "tool" } = {}): ModelGatewayAuthority {
  const stepId = overrides.stepId ?? "step-1";
  const stepClass = overrides.stepClass ?? "final_generation";
  const generationDecision = issuer.issue({ purpose: "authorize_generate", issuer: "authority-model-use", requestId: "request-1", boundDigest: "sha256:1234567890123456789012345678901234567890123456789012345678", revision: 1 }, 5_000).token;
  const modelUseDecision = issuer.issue({ purpose: "authorize_model_use", issuer: "authority-model-use", requestId: "request-1", turnId: "turn-1", stepId, stepClass, modelRef: "model-default", artifactDigest: ARTIFACT, capability: "chat", boundDigest: "sha256:1234567890123456789012345678901234567890123456789012345678", revision: 1 }, 5_000).token;
  const costConsumption = issuer.issue({ purpose: "cost_sub_envelope_consumption", issuer: "authority-cost", requestId: "request-1", turnId: "turn-1", stepId, reservationRef: "budget-1", subEnvelope: stepClass, boundDigest: "sha256:1234567890123456789012345678901234567890123456789012345678", revision: 1 }, 5_000).token;
  const agentStep = issuer.issue({ purpose: "agent_step", issuer: "authority-agent-run", requestId: "request-1", turnId: "turn-1", stepId, stepClass, boundDigest: digestOf(modelUseDecision), revision: 1 }, 5_000).token;
  return { generationDecision, modelUseDecision, costConsumption, agentStep };
}

const request = (overrides: Partial<ModelGatewayDispatchInput> = {}): ModelGatewayDispatchInput => ({
  requestId: "request-1", turnId: "turn-1", stepId: "step-1", stepClass: "final_generation", requestDigest: "request-digest",
  capability: "chat", artifactDigest: ARTIFACT, modelRef: "model-default", denyEpoch: 1,
  workflowReservationRef: "budget-1", deadlineAt: 2_000, scopeId: "scope:subject:revision", chunks: ["protected ", "answer"],
  authority: mintAuthority(),
  ...overrides,
});

interface Harness {
  gateway: ModelGateway;
  runtimeContacts: { count: number };
}

function makeHarness(attempts: RelationalRuntimeAttemptStore, claims: SqliteClaimStore, options: { overloaded?: boolean; runtime?: RuntimePort } = {}): Harness {
  const scheduler = new GpuScheduler(options.overloaded ? 0 : 5, now, issuer);
  const runtimeContacts = { count: 0 };
  const runtime: RuntimePort = options.runtime ?? {
    execute: (input) => {
      runtimeContacts.count += 1;
      return Promise.resolve({
        output: "protected answer",
        receipt: {
          schemaVersion: 1,
          reservationId: input.reservationId,
          requestId: input.requestId ?? "request-1",
          turnId: input.turnId ?? "turn-1",
          stepId: input.stepId ?? "step-1",
          fence: input.fence,
          artifactDigest: input.artifactDigest ?? "",
          endpointGeneration: input.endpointGeneration ?? "",
          usageEventId: `usage-${runtimeContacts.count}`,
          measuredUnits: 1,
          terminal: "completed",
        } as RuntimeReceipt,
      });
    },
  };
  const gateway = new ModelGateway(
    { resolve: async () => ({ endpointRef: "inference-1", snapshotExpiresAt: 2_000, external: false, endpointGeneration: "gen-1" }) },
    { reserve: async (input) => scheduler.reserve(input), start: async (...args) => { scheduler.start(...args); }, release: async (...args) => { scheduler.release(...args); } },
    runtime,
    verifier,
    claims,
    attempts,
    now,
  );
  return { gateway, runtimeContacts };
}

function sharedStores() {
  const dbPath = join(tmpdir(), `mgw-attempts-${Math.random().toString(36).slice(2)}.db`);
  const claimsPath = join(tmpdir(), `mgw-claims-${Math.random().toString(36).slice(2)}.db`);
  const attempts = new RelationalRuntimeAttemptStore(createSqlitePgCompatPool(dbPath));
  const claims = new SqliteClaimStore(claimsPath);
  return { attempts, claims, dbPath, claimsPath };
}

describe("ModelGateway durable retry authorization and idempotency", () => {
  it("preContactRetryGetsNewGenerationAndFreshReservation", async () => {
    const { attempts, claims } = sharedStores();
    // First dispatch fails at the scheduler (overloaded): creates gen1, reverts to NOT_STARTED, no runtime contact.
    const setup = makeHarness(attempts, claims, { overloaded: true });
    await expect(setup.gateway.generate(request(), new AbortController().signal)).rejects.toMatchObject<Partial<ModelGatewayError>>({ code: "OVERLOADED" });
    expect(setup.runtimeContacts.count).toBe(0);

    // Retry with a healthy scheduler: must allocate a fresh generation and reservation and contact the runtime exactly once.
    const retry = makeHarness(attempts, claims);
    const result = await retry.gateway.generate(request(), new AbortController().signal);
    expect(retry.runtimeContacts.count).toBe(1);
    expect(result.receipt.reservationId).toMatch(/^reservation:request-1:turn-1:step-1:g2$/);
    const listed = await attempts.listLogicalAttempts("request-1:turn-1:step-1");
    expect(listed.map((r) => r.attemptGeneration)).toEqual([1, 2]);
  });

  it("concurrentRetryYieldsAtMostOneRuntimeContact", async () => {
    const { attempts, claims } = sharedStores();
    // Establish a single pre-contact NOT_STARTED prior generation (gen1) shared by both racing replicas.
    const setup = makeHarness(attempts, claims, { overloaded: true });
    await expect(setup.gateway.generate(request(), new AbortController().signal)).rejects.toMatchObject<Partial<ModelGatewayError>>({ code: "OVERLOADED" });

    // Two replicas racing the same retry, sharing the durable claim store and attempt store.
    const replicaA = makeHarness(attempts, claims);
    const replicaB = makeHarness(attempts, claims);
    const [a, b] = await Promise.allSettled([
      replicaA.gateway.generate(request(), new AbortController().signal),
      replicaB.gateway.generate(request(), new AbortController().signal),
    ]);
    const succeeded = [a, b].filter((r) => r.status === "fulfilled");
    const failed = [a, b].filter((r) => r.status === "rejected");
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    expect(failed[0].status === "rejected" && (failed[0].reason as ModelGatewayError).code).toBe("STALE_AUTHORITY");
    // At most one authorized attempt contacted the runtime.
    expect(replicaA.runtimeContacts.count + replicaB.runtimeContacts.count).toBe(1);
    const listed = await attempts.listLogicalAttempts("request-1:turn-1:step-1");
    expect(listed.map((r) => r.attemptGeneration)).toEqual([1, 2]);
  });

  it("outcomeUnknownNeverRetries", async () => {
    const { attempts, claims } = sharedStores();
    // First dispatch contacts the runtime but the runtime fails after contact intent: attempt becomes OUTCOME_UNKNOWN.
    const failingRuntime: RuntimePort = {
      execute: () => Promise.reject(new Error("runtime exploded after contact")),
    };
    const primary = makeHarness(attempts, claims, { runtime: failingRuntime });
    await expect(primary.gateway.generate(request(), new AbortController().signal)).rejects.toMatchObject<Partial<ModelGatewayError>>({ code: "DEPENDENCY_UNAVAILABLE" });
    const listed = await attempts.listLogicalAttempts("request-1:turn-1:step-1");
    expect(listed[0].state).toBe("OUTCOME_UNKNOWN");

    // A retry must be refused and must NEVER contact the runtime again.
    const retry = makeHarness(attempts, claims);
    await expect(retry.gateway.generate(request(), new AbortController().signal)).rejects.toMatchObject<Partial<ModelGatewayError>>({ code: "STALE_AUTHORITY" });
    expect(retry.runtimeContacts.count).toBe(0);
    const after = await attempts.listLogicalAttempts("request-1:turn-1:step-1");
    expect(after.length).toBe(1);
  });

  it("duplicateRetryCallerDoesNotCreateSecondGeneration", async () => {
    const { attempts, claims } = sharedStores();
    // Pre-contact NOT_STARTED prior (gen1) via overloaded scheduler.
    const setup = makeHarness(attempts, claims, { overloaded: true });
    await expect(setup.gateway.generate(request(), new AbortController().signal)).rejects.toMatchObject<Partial<ModelGatewayError>>({ code: "OVERLOADED" });

    // The same caller (same authority) retries twice sequentially. Only the first may create a generation and contact runtime.
    const retry = makeHarness(attempts, claims);
    const first = await retry.gateway.generate(request(), new AbortController().signal);
    expect(first.receipt.reservationId).toMatch(/:g2$/);
    await expect(retry.gateway.generate(request(), new AbortController().signal)).rejects.toMatchObject<Partial<ModelGatewayError>>({ code: "STALE_AUTHORITY" });
    expect(retry.runtimeContacts.count).toBe(1);
    const listed = await attempts.listLogicalAttempts("request-1:turn-1:step-1");
    expect(listed.map((r) => r.attemptGeneration)).toEqual([1, 2]);
  });

  it("retryIsRefusedWhenPriorAttemptIsContactedOrTerminal", async () => {
    const { attempts, claims } = sharedStores();
    // A successful first dispatch leaves gen1 COMPLETED (a contacted/terminal prior). A new generation
    // must never be authorized from any contacted/terminal ambiguity. This is the durable-uniqueness
    // contract: the one permitted generation (gen1) already contacted the runtime, so a retry is refused.
    const primary = makeHarness(attempts, claims);
    await primary.gateway.generate(request(), new AbortController().signal);
    expect(primary.runtimeContacts.count).toBe(1);

    // A fresh gateway instance (new in-process state) sharing only the durable stores is refused and
    // never contacts the runtime a second time.
    const retry = makeHarness(attempts, claims);
    await expect(retry.gateway.generate(request(), new AbortController().signal)).rejects.toMatchObject<Partial<ModelGatewayError>>({ code: "STALE_AUTHORITY" });
    expect(retry.runtimeContacts.count).toBe(0);
    const listed = await attempts.listLogicalAttempts("request-1:turn-1:step-1");
    expect(listed.map((r) => r.attemptGeneration)).toEqual([1]);
  });
});
