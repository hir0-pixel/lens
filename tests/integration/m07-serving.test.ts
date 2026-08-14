import { describe, expect, it } from "vitest";
import { CostController } from "../../services/cost-controller/CostController";
import { GpuScheduler, SchedulerError } from "../../services/gpu-scheduler/GpuScheduler";
import { InferenceAdapter } from "../../services/inference-adapter/InferenceAdapter";
import { ModelGateway, ModelGatewayError } from "../../services/model-gateway/ModelGateway";

const now = () => 1_000;
function harness(options: { external?: boolean; overloaded?: boolean } = {}) {
  const cost = new CostController(10, now); cost.reserve({ reservationRef: "budget-1", requestId: "request-1", estimateDigest: "estimate-1", maximumCost: 5, expiresAt: 2_000 });
  const scheduler = new GpuScheduler(options.overloaded ? 0 : 1, now); const runtime = new InferenceAdapter();
  return new ModelGateway(
    { resolve: async () => ({ endpointRef: "inference-1", snapshotExpiresAt: 2_000, external: options.external ?? false }) },
    { validate: async ({ reservationRef, requestId, estimateDigest }) => { if (reservationRef !== "budget-1" || requestId !== "request-1" || estimateDigest !== "estimate-1") throw new Error("invalid budget"); }, finalize: async ({ reservationRef, usageEventId, measuredCost }) => { cost.finalize(reservationRef, usageEventId, measuredCost); } },
    { reserve: async (input) => scheduler.reserve(input), start: async (...args) => { scheduler.start(...args); }, release: async (...args) => { scheduler.release(...args); } },
    { execute: (input, signal) => runtime.execute(input, signal) }, now,
  );
}
const request = (overrides = {}) => ({ requestId: "request-1", requestDigest: "request-digest", capability: "chat", artifactDigest: "sha256:model", denyEpoch: 1, budgetReservationRef: "budget-1", estimateDigest: "estimate-1", deadlineAt: 2_000, contextFence: "context-fence", scopeId: "scope:subject:revision", chunks: ["protected ", "answer"], ...overrides });

describe("M07 internal model serving", () => {
  it("uses an approved internal model only after budget and fenced scheduler admission", async () => {
    await expect(harness().generate(request(), new AbortController().signal)).resolves.toEqual({ output: "protected answer", usageEventId: "usage:reservation:request-1:1" });
  });
  it("rejects external artifacts, missing context fences, and replayed dispatch", async () => {
    await expect(harness({ external: true }).generate(request(), new AbortController().signal)).rejects.toMatchObject<Partial<ModelGatewayError>>({ code: "FORBIDDEN" });
    await expect(harness().generate(request({ contextFence: "" }), new AbortController().signal)).rejects.toMatchObject<Partial<ModelGatewayError>>({ code: "STALE_AUTHORITY" });
    const gateway = harness(); await gateway.generate(request(), new AbortController().signal);
    await expect(gateway.generate(request(), new AbortController().signal)).rejects.toMatchObject<Partial<ModelGatewayError>>({ code: "STALE_AUTHORITY" });
  });
  it("fails at capacity and propagates cancellation without a blind retry", async () => {
    await expect(harness({ overloaded: true }).generate(request(), new AbortController().signal)).rejects.toMatchObject<Partial<ModelGatewayError>>({ code: "OVERLOADED" });
    const controller = new AbortController(); controller.abort();
    await expect(harness().generate(request(), controller.signal)).rejects.toMatchObject<Partial<ModelGatewayError>>({ code: "CANCELLED" });
  });
  it("rejects stale scheduler fences and releases only the matching lease", () => {
    const scheduler = new GpuScheduler(1, now); const lease = scheduler.reserve({ reservationId: "reservation-1", requestDigest: "digest", endpointRef: "endpoint", expiresAt: 2_000 });
    expect(() => scheduler.start(lease.reservationId, "digest", lease.fence + 1)).toThrow(SchedulerError);
    scheduler.start(lease.reservationId, "digest", lease.fence); scheduler.release(lease.reservationId, lease.fence);
  });
});
