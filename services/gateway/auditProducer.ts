import type {
  AuditAdmissionClient,
  AuditAdmissionEvent,
  GatewayAdmission,
  GatewayRequest,
} from "./types";
import { GatewayError } from "./types";

export class GatewayAuditProducer {
  private sequence = 0;

  constructor(
    private readonly client: AuditAdmissionClient,
    private readonly now: () => Date,
  ) {}

  async recordAdmission(
    admission: Pick<GatewayAdmission, "requestId" | "correlationId" | "identity" | "route" | "deadlineAt" | "bulkhead">,
    payloadDigest: GatewayRequest["payloadDigest"],
  ): Promise<void> {
    const event = this.event("gateway.request.admitted", admission, payloadDigest);
    const result = await this.client.admit(event);
    if (result.admitted) return;

    if (result.reason === "deadline-expired") {
      throw new GatewayError("DEADLINE_EXCEEDED", "The request deadline has elapsed.", admission.correlationId, false);
    }
    if (result.reason === "disk-pressure") {
      throw new GatewayError("OVERLOADED", "The audit service cannot admit this request.", admission.correlationId, true, 250);
    }
    throw new GatewayError("DEPENDENCY_UNAVAILABLE", "The audit service is unavailable.", admission.correlationId, true, 250);
  }

  private event(
    eventType: AuditAdmissionEvent["eventType"],
    admission: Pick<GatewayAdmission, "requestId" | "correlationId" | "identity" | "route" | "deadlineAt" | "bulkhead">,
    payloadDigest: GatewayRequest["payloadDigest"],
  ): AuditAdmissionEvent {
    this.sequence += 1;
    return {
      eventId: `gateway-audit-${String(this.sequence).padStart(8, "0")}`,
      eventType,
      occurredAt: this.now().toISOString(),
      deadlineAt: admission.deadlineAt,
      requestId: admission.requestId,
      correlationId: admission.correlationId,
      subjectRef: admission.identity.subjectRef,
      sessionId: admission.identity.sessionId,
      deviceRef: admission.identity.deviceRef,
      route: admission.route,
      bulkhead: admission.bulkhead,
      payloadDigest,
    };
  }
}
