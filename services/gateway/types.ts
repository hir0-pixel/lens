import type { ContractErrorCode } from "../../libs/generated-clients";

export interface GatewayErrorShape {
  code: ContractErrorCode;
  message: string;
  correlationId: string;
  retryable: boolean;
  retryAfterMs?: number;
}

export class GatewayError extends Error implements GatewayErrorShape {
  readonly name = "GatewayError";

  constructor(
    readonly code: ContractErrorCode,
    message: string,
    readonly correlationId: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** Deliberately limited to non-authorizing session facts. */
export interface GatewayIdentityContext {
  subjectRef: string;
  sessionId: string;
  deviceRef: string;
  issuerRef: string;
  authenticatedAt: string;
  authenticationMethods: readonly string[];
  expiresAt: string;
  revision: number;
}

export interface PresentedSession {
  sessionId: string;
  deviceKeyThumbprint: string;
}

export interface SessionAuthenticator {
  authenticate(
    presented: PresentedSession,
    now: Date,
  ): Promise<GatewayIdentityContext | undefined>;
}

export type GatewayRoute = "/v1/chat" | "/v1/turns/status" | "/v1/agent" | "/v1/tool";

export interface GatewayRequest {
  route: GatewayRoute;
  method: "GET" | "POST";
  session: PresentedSession;
  deadlineAt: string;
  payloadDigest: `sha256:${string}`;
  correlationId?: string;
  idempotencyKey?: string;
  protected: boolean;
  bulkhead: "interactive" | "management";
  privilegedChange?: {
    fenceId: string;
    actorSubjectRef: string;
    approverSubjectRef: string;
    expiresAt: string;
  };
}

export interface GatewayAdmission {
  requestId: string;
  correlationId: string;
  identity: GatewayIdentityContext;
  route: GatewayRoute;
  deadlineAt: string;
  bulkhead: GatewayRequest["bulkhead"];
  idempotencyKey?: string;
  cancellation: AbortSignal;
  release(): void;
}

export interface AuditAdmissionEvent {
  eventId: string;
  eventType: "gateway.request.admitted" | "gateway.stream.cancelled";
  occurredAt: string;
  deadlineAt: string;
  requestId: string;
  correlationId: string;
  subjectRef: string;
  sessionId: string;
  deviceRef: string;
  route: GatewayRoute;
  bulkhead: GatewayRequest["bulkhead"];
  payloadDigest: `sha256:${string}`;
}

export type AuditAdmissionResult =
  | { admitted: true; receiptId: string }
  | { admitted: false; reason: "unavailable" | "disk-pressure" | "deadline-expired" };

export interface AuditAdmissionClient {
  admit(event: AuditAdmissionEvent): Promise<AuditAdmissionResult>;
}
