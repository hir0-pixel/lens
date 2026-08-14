import {
  CONTRACT_CLIENT_WORKLOAD,
  CONTRACT_OWNER,
  ContractError,
  type ContractEventEnvelope,
  type ContractProbeOwnerHandler,
  type ContractProbeInput,
  type ContractProbeResponse,
  type ContractProbeTransport,
  type GatewayContractProbeRequest,
} from "../generated-clients";

interface LocalWorkloadIdentity {
  id: string;
}

interface ContractProbeSimulatorOptions {
  now?: () => Date;
  clientIdentity?: LocalWorkloadIdentity;
  serverIdentity?: LocalWorkloadIdentity;
}

interface IdempotencyRecord {
  payload: string;
  response: ContractProbeResponse;
}

function canonicalPayload(input: ContractProbeInput): string {
  return JSON.stringify({
    operationId: input.operationId,
    payload: Object.fromEntries(
      Object.entries(input.payload).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  });
}

function safeError(
  code: ConstructorParameters<typeof ContractError>[0],
  message: string,
  correlationId: string,
): ContractError {
  return new ContractError(code, message, correlationId, false);
}

/**
 * Local transport that checks the same workload identities production mTLS will
 * bind. It intentionally contains no credentials or certificate material.
 */
export class MtlsCompatibleLocalTransport implements ContractProbeTransport {
  private requestSequence = 0;

  constructor(
    private readonly clientIdentity: LocalWorkloadIdentity,
    private readonly serverIdentity: LocalWorkloadIdentity,
    private readonly handler: ContractProbeOwnerHandler,
  ) {}

  async submitContractProbe(
    input: ContractProbeInput,
    signal?: AbortSignal,
  ): Promise<ContractProbeResponse> {
    if (
      this.clientIdentity.id !== CONTRACT_CLIENT_WORKLOAD ||
      this.serverIdentity.id !== CONTRACT_OWNER
    ) {
      throw safeError(
        "UNAUTHENTICATED",
        "The local workload identity binding was rejected.",
        input.correlationId,
      );
    }
    this.requestSequence += 1;
    return this.handler.submitAcceptedContractProbe(
      {
        ...input,
        requestId: `req-${String(this.requestSequence).padStart(6, "0")}`,
      },
      signal,
    );
  }
}

export class ContractProbeSimulator implements ContractProbeOwnerHandler {
  private sequence = 0;
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  readonly events: ContractEventEnvelope[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  async submitAcceptedContractProbe(
    input: GatewayContractProbeRequest,
    signal?: AbortSignal,
  ): Promise<ContractProbeResponse> {
    if (signal?.aborted) {
      throw safeError("CANCELLED", "The request was cancelled.", input.correlationId);
    }
    if (!input.operationId || !input.correlationId || !input.idempotencyKey) {
      throw safeError("INVALID_ARGUMENT", "Required request metadata is missing.", input.correlationId || "unknown");
    }
    if (!input.payload || Object.values(input.payload).some((value) => typeof value !== "string")) {
      throw safeError("INVALID_ARGUMENT", "Payload values must be strings.", input.correlationId);
    }
    const deadline = new Date(input.deadlineAt);
    if (Number.isNaN(deadline.valueOf()) || deadline <= this.now()) {
      throw safeError("DEADLINE_EXCEEDED", "The request deadline has elapsed.", input.correlationId);
    }

    const payload = canonicalPayload(input);
    const existing = this.idempotency.get(input.idempotencyKey);
    if (existing) {
      if (existing.payload !== payload) {
        throw safeError("CONFLICT", "The idempotency key was reused with a different payload.", input.correlationId);
      }
      return { ...existing.response, correlationId: input.correlationId, replayed: true };
    }

    this.sequence += 1;
    const acceptedAt = this.now().toISOString();
    const response: ContractProbeResponse = {
      requestId: input.requestId,
      operationId: input.operationId,
      correlationId: input.correlationId,
      classification: "internal",
      acceptedAt,
      replayed: false,
    };
    this.idempotency.set(input.idempotencyKey, { payload, response });
    this.events.push({
      eventId: `evt-${String(this.sequence).padStart(6, "0")}`,
      aggregateType: "contract_probe",
      aggregateId: response.requestId,
      aggregateSequence: this.sequence,
      eventType: "contract_probe.accepted",
      schemaVersion: "1.0.0",
      occurredAt: acceptedAt,
      committedAt: acceptedAt,
      producerWorkloadId: CONTRACT_OWNER,
      sourceTransactionRef: `local-tx-${this.sequence}`,
      classification: "internal",
      payloadDigest: `sha256:${String(this.sequence).padStart(64, "0")}`,
      traceId: input.correlationId,
      operationId: input.operationId,
    });
    return response;
  }
}

export function createContractProbeTestKit(
  options: ContractProbeSimulatorOptions = {},
): { simulator: ContractProbeSimulator; transport: ContractProbeTransport } {
  const simulator = new ContractProbeSimulator(options.now);
  return {
    simulator,
    transport: new MtlsCompatibleLocalTransport(
      options.clientIdentity ?? { id: CONTRACT_CLIENT_WORKLOAD },
      options.serverIdentity ?? { id: CONTRACT_OWNER },
      simulator,
    ),
  };
}
