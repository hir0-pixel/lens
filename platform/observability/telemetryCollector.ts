export type TelemetrySignal = "metric" | "log" | "trace";
export type TelemetryPriority = "critical" | "normal" | "debug";
export type TelemetryValue = string | number | boolean;

export interface TelemetryRecord {
  signal: TelemetrySignal;
  priority: TelemetryPriority;
  serviceName: string;
  operation: string;
  timestamp: string;
  statusCode: string;
  attributes?: Record<string, TelemetryValue>;
}

export type TelemetryRejectionReason =
  | "invalid-record"
  | "unknown-attribute"
  | "forbidden-attribute"
  | "invalid-attribute"
  | "cardinality-limit"
  | "oversized-record"
  | "queue-full";

export interface TelemetryResult {
  accepted: boolean;
  redactedFields: number;
  reason?: TelemetryRejectionReason;
}

export interface TelemetryExporter {
  export(records: readonly TelemetryRecord[]): Promise<void>;
}

export interface TelemetryExportResult {
  exported: number;
  status: "empty" | "exported" | "exporter-busy" | "exporter-failed";
}

export interface TelemetryAccounting {
  queuedRecords: number;
  queuedBytes: number;
  queueHighWaterRecords: number;
  queueHighWaterBytes: number;
  exportedRecords: number;
  exportAttempts: number;
  exporterFailures: number;
  exporterBackpressure: number;
  droppedBySignal: Readonly<Record<TelemetrySignal, number>>;
  droppedByReason: Readonly<Record<TelemetryRejectionReason, number>>;
}

export interface TelemetryLimits {
  maxRecords: number;
  maxBytes: number;
  maxMetricSeries?: number;
  maxDistinctValuesPerDimension?: number;
}

const SIGNALS = new Set<TelemetrySignal>(["metric", "log", "trace"]);
const PRIORITIES = new Set<TelemetryPriority>(["critical", "normal", "debug"]);
const SAFE_TOKEN = /^[a-z0-9][a-z0-9_.:/-]{0,95}$/i;
const SAFE_CODE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/i;
const SHA256_DIGEST = /^[a-f0-9]{64}$/i;
const GOVERNED_REFERENCE = /^gref:v1:[a-z0-9][a-z0-9_.-]{0,31}:(request|turn|retrieval|decision|index-generation|trace|span|workload):[A-Za-z0-9_-]{43}$/;
const FORBIDDEN_ATTRIBUTE = /(?:api[_-]?key|authorization|bearer|chunk|content|credential|document|memory|output|password|prompt|raw|secret|session|subject|token|tool_?arg|tool_?result|user_?id)/i;

const COMMON_ATTRIBUTES = new Set([
  "artifact_digest",
  "classification",
  "dependency",
  "duration_ms",
  "error_code",
  "resource",
  "retry_count",
  "schema_version",
  "stage",
  "workload_ref",
]);
const TRACE_ONLY_ATTRIBUTES = new Set([
  "decision_ref",
  "index_generation_ref",
  "parent_span_ref",
  "request_ref",
  "retrieval_ref",
  "span_ref",
  "trace_ref",
  "turn_ref",
]);
const METRIC_DIMENSIONS = new Set([
  "classification",
  "dependency",
  "error_code",
  "resource",
  "stage",
]);
const REFERENCE_ATTRIBUTES = new Set([
  "decision_ref",
  "index_generation_ref",
  "parent_span_ref",
  "request_ref",
  "retrieval_ref",
  "span_ref",
  "trace_ref",
  "turn_ref",
  "workload_ref",
]);

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function recordBytes(record: TelemetryRecord): number {
  return new TextEncoder().encode(JSON.stringify(record)).byteLength;
}

function validAttribute(key: string, value: TelemetryValue): boolean {
  if (REFERENCE_ATTRIBUTES.has(key)) {
    return typeof value === "string" && GOVERNED_REFERENCE.test(value);
  }
  if (key === "artifact_digest") {
    return typeof value === "string" && SHA256_DIGEST.test(value);
  }
  if (key === "duration_ms") {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 86_400_000;
  }
  if (key === "retry_count") {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
  }
  if (key === "schema_version") {
    return typeof value === "string" && /^v?[0-9]{1,3}(?:\.[0-9]{1,3}){0,2}$/.test(value);
  }
  return typeof value === "string" && SAFE_TOKEN.test(value);
}

function emptyReasonCounts(): Record<TelemetryRejectionReason, number> {
  return {
    "invalid-record": 0,
    "unknown-attribute": 0,
    "forbidden-attribute": 0,
    "invalid-attribute": 0,
    "cardinality-limit": 0,
    "oversized-record": 0,
    "queue-full": 0,
  };
}

/** Content-free, bounded telemetry collector. Audit evidence is deliberately out of scope. */
export class TelemetryCollector {
  private readonly queue: TelemetryRecord[] = [];
  private readonly metricSeries = new Set<string>();
  private readonly dimensionValues = new Map<string, Set<string>>();
  private readonly dropped: Record<TelemetrySignal, number> = { metric: 0, log: 0, trace: 0 };
  private readonly rejected = emptyReasonCounts();
  private readonly maxMetricSeries: number;
  private readonly maxDistinctValuesPerDimension: number;
  private bytes = 0;
  private highWaterRecords = 0;
  private highWaterBytes = 0;
  private exported = 0;
  private exportAttempts = 0;
  private exporterFailures = 0;
  private exporterBackpressure = 0;
  private exportInFlight = false;

  constructor(private readonly limits: TelemetryLimits) {
    if (!positiveInteger(limits.maxRecords) || !positiveInteger(limits.maxBytes)) {
      throw new Error("Telemetry queue limits must be positive integers");
    }
    this.maxMetricSeries = limits.maxMetricSeries ?? 2_048;
    this.maxDistinctValuesPerDimension = limits.maxDistinctValuesPerDimension ?? 64;
    if (!positiveInteger(this.maxMetricSeries) || !positiveInteger(this.maxDistinctValuesPerDimension)) {
      throw new Error("Telemetry cardinality limits must be positive integers");
    }
  }

  collect(record: TelemetryRecord): TelemetryResult {
    const signal = SIGNALS.has(record.signal) ? record.signal : "log";
    if (
      !SIGNALS.has(record.signal)
      || !PRIORITIES.has(record.priority)
      || !SAFE_CODE.test(record.serviceName)
      || !SAFE_CODE.test(record.operation)
      || !SAFE_CODE.test(record.statusCode)
      || Number.isNaN(new Date(record.timestamp).valueOf())
    ) {
      return this.reject(signal, "invalid-record");
    }

    const attributes = record.attributes ?? {};
    const keys = Object.keys(attributes);
    const forbidden = keys.filter((key) => FORBIDDEN_ATTRIBUTE.test(key));
    if (forbidden.length > 0) {
      return this.reject(signal, "forbidden-attribute", forbidden.length);
    }

    const allowed = record.signal === "trace"
      ? new Set([...COMMON_ATTRIBUTES, ...TRACE_ONLY_ATTRIBUTES])
      : COMMON_ATTRIBUTES;
    if (keys.some((key) => !allowed.has(key))) {
      return this.reject(signal, "unknown-attribute");
    }
    if (record.signal === "metric" && keys.some((key) => REFERENCE_ATTRIBUTES.has(key))) {
      return this.reject(signal, "forbidden-attribute", 1);
    }
    if (Object.entries(attributes).some(([key, value]) => !validAttribute(key, value))) {
      return this.reject(signal, "invalid-attribute", 1);
    }

    const sanitized: TelemetryRecord = { ...record, attributes: { ...attributes } };
    const bytes = recordBytes(sanitized);
    if (bytes > this.limits.maxBytes) {
      return this.reject(signal, "oversized-record");
    }
    if (this.queue.length >= this.limits.maxRecords || this.bytes + bytes > this.limits.maxBytes) {
      return this.reject(signal, "queue-full");
    }
    if (record.signal === "metric" && !this.admitMetricSeries(record)) {
      return this.reject(signal, "cardinality-limit");
    }

    this.queue.push(sanitized);
    this.bytes += bytes;
    this.highWaterRecords = Math.max(this.highWaterRecords, this.queue.length);
    this.highWaterBytes = Math.max(this.highWaterBytes, this.bytes);
    return { accepted: true, redactedFields: 0 };
  }

  drain(): TelemetryRecord[] {
    const records = this.queue.splice(0, this.queue.length);
    this.bytes = 0;
    return records;
  }

  async exportBatch(exporter: TelemetryExporter, maxBatchRecords: number): Promise<TelemetryExportResult> {
    if (!positiveInteger(maxBatchRecords)) {
      throw new Error("Export batch size must be a positive integer");
    }
    if (this.exportInFlight) {
      this.exporterBackpressure += 1;
      return { exported: 0, status: "exporter-busy" };
    }
    if (this.queue.length === 0) {
      return { exported: 0, status: "empty" };
    }

    this.exportInFlight = true;
    this.exportAttempts += 1;
    const batch = this.queue.slice(0, Math.min(maxBatchRecords, this.queue.length));
    try {
      await exporter.export(batch);
      this.queue.splice(0, batch.length);
      this.bytes -= batch.reduce((total, queuedRecord) => total + recordBytes(queuedRecord), 0);
      this.exported += batch.length;
      return { exported: batch.length, status: "exported" };
    } catch {
      this.exporterFailures += 1;
      return { exported: 0, status: "exporter-failed" };
    } finally {
      this.exportInFlight = false;
    }
  }

  dropCounts(): Readonly<Record<TelemetrySignal, number>> {
    return { ...this.dropped };
  }

  accounting(): TelemetryAccounting {
    return {
      queuedRecords: this.queue.length,
      queuedBytes: this.bytes,
      queueHighWaterRecords: this.highWaterRecords,
      queueHighWaterBytes: this.highWaterBytes,
      exportedRecords: this.exported,
      exportAttempts: this.exportAttempts,
      exporterFailures: this.exporterFailures,
      exporterBackpressure: this.exporterBackpressure,
      droppedBySignal: { ...this.dropped },
      droppedByReason: { ...this.rejected },
    };
  }

  private reject(signal: TelemetrySignal, reason: TelemetryRejectionReason, redactedFields = 0): TelemetryResult {
    this.dropped[signal] += 1;
    this.rejected[reason] += 1;
    return { accepted: false, redactedFields, reason };
  }

  private admitMetricSeries(record: TelemetryRecord): boolean {
    const attributes = record.attributes ?? {};
    const dimensions = Object.entries(attributes)
      .filter(([key]) => METRIC_DIMENSIONS.has(key))
      .sort(([left], [right]) => left.localeCompare(right));
    const proposedValues: Array<[string, string]> = [
      ["service", record.serviceName],
      ["operation", record.operation],
      ["status", record.statusCode],
      ...dimensions.map(([key, value]) => [key, String(value)] as [string, string]),
    ];
    const seriesKey = proposedValues.map(([key, value]) => `${key}=${value}`).join("|");
    if (!this.metricSeries.has(seriesKey) && this.metricSeries.size >= this.maxMetricSeries) {
      return false;
    }
    for (const [key, value] of proposedValues) {
      const values = this.dimensionValues.get(key);
      if (values && !values.has(value) && values.size >= this.maxDistinctValuesPerDimension) {
        return false;
      }
    }
    this.metricSeries.add(seriesKey);
    for (const [key, value] of proposedValues) {
      const values = this.dimensionValues.get(key) ?? new Set<string>();
      values.add(value);
      this.dimensionValues.set(key, values);
    }
    return true;
  }
}
