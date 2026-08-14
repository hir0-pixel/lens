import { describe, expect, it } from "vitest";
import { ContractError, LensContractClient } from "../../libs/generated-clients";
import { createContractProbeTestKit } from "../../libs/testkit";

const clock = () => new Date("2026-08-13T12:00:00.000Z");
const validInput = {
  operationId: "op-contract-probe-1",
  correlationId: "corr-contract-probe-1",
  idempotencyKey: "idem-contract-probe-1",
  deadlineAt: "2026-08-13T12:05:00.000Z",
  payload: { intent: "contract-gate" },
};

describe("M00 generated client integration", () => {
  it("calls the deterministic owner simulator through local workload-bound transport", async () => {
    const { simulator, transport } = createContractProbeTestKit({ now: clock });
    const client = new LensContractClient(transport);

    const response = await client.submitContractProbe(validInput);

    expect(response).toMatchObject({
      requestId: "req-000001",
      classification: "internal",
      replayed: false,
    });
    expect(simulator.events).toHaveLength(1);
    expect(simulator.events[0]).toMatchObject({
      eventType: "contract_probe.accepted",
      aggregateId: response.requestId,
      traceId: validInput.correlationId,
    });
  });

  it("deduplicates the same mutation and rejects altered-payload reuse", async () => {
    const { transport } = createContractProbeTestKit({ now: clock });
    const client = new LensContractClient(transport);

    const accepted = await client.submitContractProbe(validInput);
    const replay = await client.submitContractProbe({
      ...validInput,
      correlationId: "corr-contract-probe-retry",
    });

    expect(replay).toMatchObject({ requestId: accepted.requestId, replayed: true });
    await expect(client.submitContractProbe({
      ...validInput,
      payload: { intent: "altered" },
    })).rejects.toMatchObject<Partial<ContractError>>({ code: "CONFLICT" });
  });

  it("fails closed for deadline expiry, cancellation, and a wrong workload identity", async () => {
    const expired = new LensContractClient(
      createContractProbeTestKit({ now: clock }).transport,
    );
    await expect(expired.submitContractProbe({
      ...validInput,
      deadlineAt: "2026-08-13T11:59:59.000Z",
    })).rejects.toMatchObject<Partial<ContractError>>({ code: "DEADLINE_EXCEEDED" });

    const controller = new AbortController();
    controller.abort();
    await expect(expired.submitContractProbe(validInput, controller.signal)).rejects.toMatchObject<Partial<ContractError>>({ code: "CANCELLED" });

    const rejected = new LensContractClient(createContractProbeTestKit({
      now: clock,
      clientIdentity: { id: "untrusted-client" },
    }).transport);
    await expect(rejected.submitContractProbe(validInput)).rejects.toMatchObject<Partial<ContractError>>({ code: "UNAUTHENTICATED" });
  });
});
