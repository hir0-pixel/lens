import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GpuScheduler, SchedulerError } from "../../services/gpu-scheduler/GpuScheduler";
import { InferenceAdapter } from "../../services/inference-adapter/InferenceAdapter";
import { ModelGateway, ModelGatewayError, type ModelGatewayAuthority, type ModelGatewayDispatchInput } from "../../services/model-gateway/ModelGateway";
import { AuthorityReceiptIssuer, Ed25519ReceiptVerifier } from "../../services/security/authorityReceipt";
import { InMemoryClaimStore } from "../../services/security/replayClaimStore";
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

function mintAuthority(
  overrides: {
    modelRef?: string;
    artifactDigest?: `sha256:${string}`;
    capability?: string;
    omitAgentStep?: boolean;
    stepId?: string;
    stepClass?: "route" | "final_generation" | "tool";
    costSubEnvelope?: "route" | "retrieval" | "final_generation" | "tool";
    costStepId?: string;
  } = {},
): ModelGatewayAuthority {
  const modelRef = overrides.modelRef ?? "model-default";
  const artifactDigest = overrides.artifactDigest ?? ARTIFACT;
  const capability = overrides.capability ?? "chat";
  const stepId = overrides.stepId ?? "step-1";
  const stepClass = overrides.stepClass ?? "final_generation";
  const generationDecision = issuer.issue({ purpose: "authorize_generate", issuer: "authority-model-use", requestId: "request-1", boundDigest: "sha256:1234567890123456789012345678901234567890123456789012345678", revision: 1 }, 5_000).token;
  const modelUseDecision = issuer.issue({ purpose: "authorize_model_use", issuer: "authority-model-use", requestId: "request-1", turnId: "turn-1", stepId, stepClass, modelRef, artifactDigest, capability, boundDigest: "sha256:1234567890123456789012345678901234567890123456789012345678", revision: 1 }, 5_000).token;
  const costConsumption = issuer.issue({ purpose: "cost_sub_envelope_consumption", issuer: "authority-cost", requestId: "request-1", turnId: "turn-1", stepId: overrides.costStepId ?? stepId, reservationRef: "budget-1", subEnvelope: overrides.costSubEnvelope ?? stepClass, boundDigest: "sha256:1234567890123456789012345678901234567890123456789012345678", revision: 1 }, 5_000).token;
  const agentStep = overrides.omitAgentStep ? "" : issuer.issue({ purpose: "agent_step", issuer: "authority-agent-run", requestId: "request-1", turnId: "turn-1", stepId, stepClass, boundDigest: digestOf(modelUseDecision), revision: 1 }, 5_000).token;
  return { generationDecision, modelUseDecision, costConsumption, agentStep };
}

function harness(options: { external?: boolean; overloaded?: boolean } = {}) {
  const scheduler = new GpuScheduler(options.overloaded ? 0 : 1, now, issuer);
  const runtime = new InferenceAdapter();
  const attempts = new RelationalRuntimeAttemptStore(createSqlitePgCompatPool(":memory:"));
  return new ModelGateway(
    { resolve: async () => ({ endpointRef: "inference-1", snapshotExpiresAt: 2_000, external: options.external ?? false, endpointGeneration: "gen-1" }) },
    { reserve: async (input) => scheduler.reserve(input), start: async (...args) => { scheduler.start(...args); }, release: async (...args) => { scheduler.release(...args); } },
    { execute: (input, signal) => runtime.execute(input, signal) },
    verifier,
    new InMemoryClaimStore(),
    attempts,
    now,
  );
}

const request = (overrides: Partial<ModelGatewayDispatchInput> = {}): ModelGatewayDispatchInput => ({
  requestId: "request-1", turnId: "turn-1", stepId: "step-1", stepClass: "final_generation", requestDigest: "request-digest",
  capability: "chat", artifactDigest: ARTIFACT, modelRef: "model-default", denyEpoch: 1,
  workflowReservationRef: "budget-1", deadlineAt: 2_000, scopeId: "scope:subject:revision", chunks: ["protected ", "answer"],
  authority: mintAuthority(),
  ...overrides,
});

describe("M07 internal model serving", () => {
  it("uses an approved internal model only after fenced scheduler admission and receipt verification", async () => {
    const result = await harness().generate(request(), new AbortController().signal);
    expect(result.output).toBe("protected answer");
    expect(result.receipt.reservationId).toMatch(/^reservation:request-1:turn-1:step-1:g1$/);
    expect(result.receipt.measuredUnits).toBeGreaterThan(0);
  });
  it("rejects external artifacts, receipts that fail verification, and replayed dispatch", async () => {
    await expect(harness({ external: true }).generate(request(), new AbortController().signal)).rejects.toMatchObject<Partial<ModelGatewayError>>({ code: "FORBIDDEN" });
    await expect(harness().generate(request({ authority: mintAuthority({ omitAgentStep: true }) }), new AbortController().signal)).rejects.toMatchObject<Partial<ModelGatewayError>>({ code: "STALE_AUTHORITY" });
    await expect(harness().generate(request({ modelRef: "attacker-controlled-model" }), new AbortController().signal)).rejects.toMatchObject<Partial<ModelGatewayError>>({ code: "STALE_AUTHORITY" });
    const gateway = harness();
    const shared = request();
    await gateway.generate(shared, new AbortController().signal);
    await expect(gateway.generate(shared, new AbortController().signal)).rejects.toMatchObject<Partial<ModelGatewayError>>({ code: "STALE_AUTHORITY" });
  });
  it("rejects a route-envelope cost receipt presented for a final-generation dispatch — no sub-envelope borrowing at the gateway", async () => {
    const borrowedAuthority = mintAuthority({ costSubEnvelope: "route" });
    await expect(harness().generate(request({ authority: borrowedAuthority }), new AbortController().signal)).rejects.toMatchObject<Partial<ModelGatewayError>>({ code: "STALE_AUTHORITY" });
  });
  it("rejects an agent-step receipt whose boundDigest was not derived from the presented modelUseDecision", async () => {
    const mismatchedAuthority = mintAuthority();
    mismatchedAuthority.agentStep = issuer.issue({ purpose: "agent_step", issuer: "authority-agent-run", requestId: "request-1", turnId: "turn-1", stepId: "step-1", stepClass: "final_generation", boundDigest: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", revision: 1 }, 5_000).token;
    await expect(harness().generate(request({ authority: mismatchedAuthority }), new AbortController().signal)).rejects.toMatchObject<Partial<ModelGatewayError>>({ code: "STALE_AUTHORITY" });
  });
  it("does not leak runtime or scheduler internals", async () => {
    const attempts = new RelationalRuntimeAttemptStore(createSqlitePgCompatPool(":memory:"));
    const gateway = new ModelGateway(
      { resolve: async () => ({ endpointRef: "inference-1", snapshotExpiresAt: 2_000, external: false, endpointGeneration: "gen-1" }) },
      { reserve: async (input) => new GpuScheduler(1, now, issuer).reserve(input), start: async () => undefined, release: async () => undefined },
      { execute: async () => { throw new Error("runtime socket details"); } },
      verifier,
      new InMemoryClaimStore(),
      attempts,
      now,
    );
    await expect(gateway.generate(request(), new AbortController().signal)).rejects.toMatchObject<Partial<ModelGatewayError>>({ code: "DEPENDENCY_UNAVAILABLE" });
  });
  it("rejects stale scheduler fences and unsigned numeric fences", () => {
    const scheduler = new GpuScheduler(1, now, issuer);
    const lease = scheduler.reserve({
      reservationId: "reservation-1",
      requestId: "request-1",
      turnId: "turn-1",
      stepId: "step-1",
      requestDigest: "digest",
      modelRef: "model-default",
      artifactDigest: ARTIFACT,
      endpointRef: "endpoint",
      endpointGeneration: "gen-1",
      expiresAt: 2_000,
    });
    expect(typeof lease.leaseToken).toBe("string");
    expect(() => scheduler.start(lease.reservationId, "digest", lease.fence + 1)).toThrow(SchedulerError);
    scheduler.start(lease.reservationId, "digest", lease.fence);
    scheduler.release(lease.reservationId, lease.fence);
  });
  it("rejects a fabricated numeric fence or unsigned lease string at Model Gateway", async () => {
    const attempts = new RelationalRuntimeAttemptStore(createSqlitePgCompatPool(":memory:"));
    const scheduler = new GpuScheduler(1, now, issuer);
    const gateway = new ModelGateway(
      { resolve: async () => ({ endpointRef: "inference-1", snapshotExpiresAt: 2_000, external: false, endpointGeneration: "gen-1" }) },
      {
        reserve: async (input) => {
          const lease = scheduler.reserve(input);
          return { ...lease, leaseToken: "fabricated-lease", fence: 99 };
        },
        start: async () => undefined,
        release: async () => undefined,
      },
      { execute: async () => ({ output: "x", receipt: { usageEventId: "u", generatedTokens: 1, terminal: "completed" } }) },
      verifier,
      new InMemoryClaimStore(),
      attempts,
      now,
    );
    await expect(gateway.generate(request(), new AbortController().signal)).rejects.toMatchObject<Partial<ModelGatewayError>>({ code: "STALE_AUTHORITY" });
  });
});
