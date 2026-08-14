import { GatewayError, type GatewayAdmission } from "./types";

export type GatewayStatusKind = "accepted" | "progress" | "heartbeat" | "completed" | "cancelled";

export interface GatewayStatusFrame {
  sequence: number;
  kind: GatewayStatusKind;
  requestId: string;
  emittedAt: string;
  turnId?: string;
  finalOutputDigest?: `sha256:${string}`;
}

export class GatewayStatusStream {
  private readonly frames: GatewayStatusFrame[] = [];
  private sequence = 0;
  private bufferedBytes = 0;
  private closed = false;

  constructor(
    private readonly admission: GatewayAdmission,
    private readonly now: () => Date,
    private readonly maxFrames = 16,
    private readonly maxBytes = 16 * 1024,
  ) {}

  publish(kind: GatewayStatusKind, options: Pick<GatewayStatusFrame, "turnId" | "finalOutputDigest"> = {}): GatewayStatusFrame {
    if (this.closed) {
      throw new GatewayError("CANCELLED", "The stream is no longer active.", this.admission.correlationId, false);
    }
    if ((kind === "completed") !== (options.finalOutputDigest !== undefined)) {
      throw new GatewayError("INVALID_ARGUMENT", "Invalid stream status.", this.admission.correlationId, false);
    }
    const frame: GatewayStatusFrame = {
      sequence: ++this.sequence,
      kind,
      requestId: this.admission.requestId,
      emittedAt: this.now().toISOString(),
      ...options,
    };
    const bytes = JSON.stringify(frame).length;
    if (this.frames.length >= this.maxFrames || this.bufferedBytes + bytes > this.maxBytes) {
      this.close();
      throw new GatewayError("OVERLOADED", "The stream consumer is too slow.", this.admission.correlationId, true, 100);
    }
    this.frames.push(frame);
    this.bufferedBytes += bytes;
    if (kind === "completed" || kind === "cancelled") this.close();
    return frame;
  }

  drain(): GatewayStatusFrame[] {
    const drained = [...this.frames];
    this.frames.length = 0;
    this.bufferedBytes = 0;
    return drained;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.admission.release();
  }
}
