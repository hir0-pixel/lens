export type TelemetrySignal = "metric" | "log" | "trace";
export type TelemetryPriority = "critical" | "normal" | "debug";

export interface TelemetryRecord {
  signal: TelemetrySignal;
  priority: TelemetryPriority;
  serviceName: string;
  operation: string;
  timestamp: string;
  statusCode: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface TelemetryResult {
  accepted: boolean;
  redactedFields: number;
  reason?: "invalid-record" | "unknown-attribute" | "queue-full";
}

const ALLOWED_ATTRIBUTES = new Set([
  "artifact_digest",
  "classification",
  "error_code",
  "latency_ms",
  "request_id",
  "retry_count",
  "schema_version",
  "workload_id",
]);
const CONTENT_OR_SECRET = /(?:api[_-]?key|authorization|bearer|content|credential|document|memory|output|password|prompt|secret|session|token|tool_?arg|user_?id)/i;

function recordBytes(record: TelemetryRecord): number {
  return new TextEncoder().encode(JSON.stringify(record)).byteLength;
}

/** Content-free, bounded telemetry collector. Audit evidence is deliberately out of scope. */
export class TelemetryCollector {
  private readonly queue: TelemetryRecord[] = [];
  private bytes = 0;
  private readonly dropped: Record<TelemetrySignal, number> = {
    metric: 0,
    log: 0,
    trace: 0,
  };

  constructor(
    private readonly limits: { maxRecords: number; maxBytes: number },
  ) {}

  collect(record: TelemetryRecord): TelemetryResult {
    if (!record.serviceName || !record.operation || !record.statusCode || Number.isNaN(new Date(record.timestamp).valueOf())) {
      return { accepted: false, redactedFields: 0, reason: "invalid-record" };
    }

    const attributes = record.attributes ?? {};
    const unknown = Object.keys(attributes).find((key) => !ALLOWED_ATTRIBUTES.has(key));
    if (unknown) {
      return { accepted: false, redactedFields: 0, reason: "unknown-attribute" };
    }

    const safeAttributes: Record<string, string | number | boolean> = {};
    let redactedFields = 0;
    for (const [key, value] of Object.entries(attributes)) {
      if (CONTENT_OR_SECRET.test(key) || (typeof value === "string" && CONTENT_OR_SECRET.test(value))) {
        redactedFields += 1;
        continue;
      }
      safeAttributes[key] = value;
    }
    const sanitized = { ...record, attributes: safeAttributes };
    const bytes = recordBytes(sanitized);
    if (this.queue.length >= this.limits.maxRecords || this.bytes + bytes > this.limits.maxBytes) {
      this.dropped[record.signal] += 1;
      return { accepted: false, redactedFields, reason: "queue-full" };
    }

    this.queue.push(sanitized);
    this.bytes += bytes;
    return { accepted: true, redactedFields };
  }

  drain(): TelemetryRecord[] {
    const records = this.queue.splice(0, this.queue.length);
    this.bytes = 0;
    return records;
  }

  dropCounts(): Readonly<Record<TelemetrySignal, number>> {
    return { ...this.dropped };
  }
}
