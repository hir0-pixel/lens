import { describe, expect, it } from "vitest";
import {
  GatewayAdmissionController,
  GatewayAuditProducer,
  GatewayError,
  GatewayStatusStream,
  type AuditAdmissionClient,
  type AuditAdmissionEvent,
  type GatewayIdentityContext,
  type GatewayRequest,
  type PresentedSession,
  type SessionAuthenticator,
} from "../../services/gateway";

const digest = `sha256:${"a".repeat(64)}` as const;
const baseTime = new Date("2026-08-14T12:00:00.000Z");

class SessionAuthority implements SessionAuthenticator {
  private active = true;

  async authenticate(presented: PresentedSession): Promise<GatewayIdentityContext | undefined> {
    if (!this.active || presented.sessionId !== "session-1" || presented.deviceKeyThumbprint !== "device-key-1") return undefined;
    return {
      subjectRef: "subject-1",
      sessionId: "session-1",
      deviceRef: "device-1",
      issuerRef: "internal-idp",
      authenticatedAt: "2026-08-14T11:59:00.000Z",
      authenticationMethods: ["phishing-resistant"],
      expiresAt: "2026-08-14T12:10:00.000Z",
      revision: 3,
    };
  }

  revoke(): void {
    this.active = false;
  }
}

class AuditAuthority implements AuditAdmissionClient {
  mode: "available" | "unavailable" | "disk-pressure" = "available";
  readonly events: AuditAdmissionEvent[] = [];

  async admit(event: AuditAdmissionEvent) {
    if (this.mode === "unavailable") return { admitted: false as const, reason: "unavailable" as const };
    if (this.mode === "disk-pressure") return { admitted: false as const, reason: "disk-pressure" as const };
    this.events.push(event);
    return { admitted: true as const, receiptId: `receipt-${event.eventId}` };
  }
}

function request(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    route: "/v1/chat",
    method: "POST",
    session: { sessionId: "session-1", deviceKeyThumbprint: "device-key-1" },
    deadlineAt: "2026-08-14T12:01:00.000Z",
    payloadDigest: digest,
    correlationId: "correlation-1",
    protected: true,
    bulkhead: "interactive",
    ...overrides,
  };
}

function gateway(
  sessions = new SessionAuthority(),
  audit = new AuditAuthority(),
  options: Partial<{ capacity: number; refillPerSecond: number; interactive: number }> = {},
) {
  const auditProducer = new GatewayAuditProducer(audit, () => baseTime);
  return {
    sessions,
    audit,
    controller: new GatewayAdmissionController({
      authenticator: sessions,
      audit: auditProducer,
      now: () => baseTime,
      rateLimit: { capacity: options.capacity ?? 20, refillPerSecond: options.refillPerSecond ?? 10 },
      maxConcurrentInteractive: options.interactive ?? 20,
    }),
  };
}

describe("M02 Gateway admission", () => {
  it("binds an authenticated session to its managed device, generates request identity, and records audit admission", async () => {
    const { controller, audit } = gateway();
    const admitted = await controller.admit(request());

    expect(admitted).toMatchObject({ requestId: "gw-00000001", correlationId: "correlation-1" });
    expect(admitted.identity).toEqual(expect.objectContaining({ subjectRef: "subject-1", deviceRef: "device-1" }));
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({ eventType: "gateway.request.admitted", payloadDigest: digest });
    expect(audit.events[0]).not.toHaveProperty("rawPayload");
    admitted.release();
  });

  it("fails closed for revoked sessions and stale device bindings", async () => {
    const { controller, sessions } = gateway();
    sessions.revoke();
    await expect(controller.admit(request())).rejects.toMatchObject<Partial<GatewayError>>({ code: "UNAUTHENTICATED" });

    const fresh = gateway().controller;
    await expect(fresh.admit(request({ session: { sessionId: "session-1", deviceKeyThumbprint: "stale-device-key" } }))).rejects.toMatchObject<Partial<GatewayError>>({ code: "UNAUTHENTICATED" });
  });

  it("rejects audit loss and disk pressure before accepting protected work", async () => {
    const unavailable = gateway();
    unavailable.audit.mode = "unavailable";
    await expect(unavailable.controller.admit(request())).rejects.toMatchObject<Partial<GatewayError>>({ code: "DEPENDENCY_UNAVAILABLE" });

    const pressured = gateway();
    pressured.audit.mode = "disk-pressure";
    await expect(pressured.controller.admit(request())).rejects.toMatchObject<Partial<GatewayError>>({ code: "OVERLOADED" });
  });

  it("requires idempotency metadata for side-effect routes and preserves distinct attempt identities", async () => {
    const { controller } = gateway();
    await expect(controller.admit(request({ route: "/v1/tool", idempotencyKey: undefined }))).rejects.toMatchObject<Partial<GatewayError>>({ code: "INVALID_ARGUMENT" });

    const one = await controller.admit(request({ route: "/v1/tool", idempotencyKey: "idempotency-key-0001" }));
    one.release();
    const two = await controller.admit(request({ route: "/v1/tool", idempotencyKey: "idempotency-key-0001" }));
    expect(two.requestId).not.toBe(one.requestId);
    two.release();
  });

  it("bounds reconnect admission, concurrent streams, and status buffers without replaying content", async () => {
    const reconnects = gateway(undefined, undefined, { capacity: 1, refillPerSecond: 0, interactive: 1 });
    const first = await reconnects.controller.admit(request({ route: "/v1/turns/status", method: "GET" }));
    await expect(reconnects.controller.admit(request({ route: "/v1/turns/status", method: "GET" }))).rejects.toMatchObject<Partial<GatewayError>>({ code: "RATE_LIMITED" });

    const stream = new GatewayStatusStream(first, () => baseTime, 1);
    expect(stream.publish("progress", { turnId: "turn-1" })).not.toHaveProperty("content");
    await expect(reconnects.controller.admit(request())).rejects.toMatchObject<Partial<GatewayError>>({ code: "OVERLOADED" });
    expect(() => stream.publish("heartbeat")).toThrow(expect.objectContaining({ code: "OVERLOADED" }));
    expect(first.cancellation.aborted).toBe(true);
  });

  it("rejects a privileged self-grant before audit admission", async () => {
    const { controller, audit } = gateway();
    await expect(controller.admit(request({
      route: "/v1/tool",
      bulkhead: "management",
      idempotencyKey: "idempotency-key-0001",
      privilegedChange: {
        fenceId: "privileged-fence-0001",
        actorSubjectRef: "subject-1",
        approverSubjectRef: "subject-1",
        expiresAt: "2026-08-14T12:05:00.000Z",
      },
    }))).rejects.toMatchObject<Partial<GatewayError>>({ code: "FORBIDDEN" });
    expect(audit.events).toHaveLength(0);
  });
});
