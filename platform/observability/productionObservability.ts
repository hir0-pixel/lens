import { isGovernedReference, type GovernedReferenceScope } from "./governedCorrelation";
import {
  TelemetryCollector,
  type TelemetryPriority,
  type TelemetryResult,
  type TelemetryValue,
} from "./telemetryCollector";

export const REQUEST_LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000] as const;
export const STAGE_LATENCY_BUCKETS_MS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000] as const;
export const RETRIEVAL_COUNT_BUCKETS = [0, 1, 5, 10, 25, 50, 100, 250, 500, 1_000] as const;

export type RequestOutcome = "success" | "client_error" | "denied" | "overload" | "dependency_error" | "internal_error" | "cancelled";
export type ResourceKind = "cpu" | "memory" | "disk" | "connections" | "index_client" | "worker_pool" | "model_server" | "gpu" | "kv_cache";
export type AnomalySignal =
  | "authorization_failure_spike"
  | "all_denied_no_context"
  | "stale_publication_manifest"
  | "queue_saturation"
  | "qdrant_replica_loss"
  | "pdp_governance_latency"
  | "audit_quorum_loss"
  | "recovery_stampede"
  | "overload"
  | "dependency_failure"
  | "audit_admission_failure"
  | "cancellation";

type MetricName =
  | "lens_requests_total"
  | "lens_request_errors_total"
  | "lens_request_duration_ms"
  | "lens_stage_duration_ms"
  | "lens_retrieval_candidates"
  | "lens_retrieval_authorized"
  | "lens_active_requests"
  | "lens_resource_utilization_ratio"
  | "lens_resource_saturation_ratio"
  | "lens_resource_errors_total"
  | "lens_operational_signals_total";

export interface MetricPoint {
  name: MetricName;
  kind: "counter" | "gauge" | "histogram";
  labels: Readonly<Record<string, string>>;
  value?: number;
  count?: number;
  sum?: number;
  bounds?: readonly number[];
  bucketCounts?: readonly number[];
}

export interface MetricAccounting {
  series: number;
  droppedCardinality: number;
  rejectedMeasurements: number;
}

interface HistogramState {
  labels: Readonly<Record<string, string>>;
  bounds: readonly number[];
  bucketCounts: number[];
  count: number;
  sum: number;
}

interface ScalarState {
  labels: Readonly<Record<string, string>>;
  kind: "counter" | "gauge";
  value: number;
}

const SAFE_LABEL = /^[a-z0-9][a-z0-9_.:-]{0,63}$/i;
const ALLOWED_LABEL_KEYS = new Set(["anomaly", "operation", "outcome", "resource", "service", "stage"]);

function canonicalLabels(labels: Readonly<Record<string, string>>): string {
  return Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("|");
}

/** Fixed-schema, in-memory RED/USE aggregation with bounded label and series cardinality. */
export class ProductionMetrics {
  private readonly scalars = new Map<string, ScalarState>();
  private readonly histograms = new Map<string, HistogramState>();
  private readonly labelValues = new Map<string, Set<string>>();
  private droppedCardinality = 0;
  private rejectedMeasurements = 0;

  constructor(private readonly limits: { maxSeries: number; maxValuesPerLabel: number }) {
    if (!Number.isInteger(limits.maxSeries) || limits.maxSeries < 1 || !Number.isInteger(limits.maxValuesPerLabel) || limits.maxValuesPerLabel < 1) {
      throw new Error("Metric cardinality limits must be positive integers");
    }
  }

  recordRequest(input: { service: string; operation: string; outcome: RequestOutcome; durationMs: number }): boolean {
    const labels = { service: input.service, operation: input.operation, outcome: input.outcome };
    if (!this.validMeasurement(input.durationMs)) return false;
    if (!this.counter("lens_requests_total", labels, 1)) return false;
    if (input.outcome !== "success" && !this.counter("lens_request_errors_total", labels, 1)) return false;
    return this.histogram("lens_request_duration_ms", labels, input.durationMs, REQUEST_LATENCY_BUCKETS_MS);
  }

  recordStage(input: { service: string; stage: string; durationMs: number }): boolean {
    if (!this.validMeasurement(input.durationMs)) return false;
    return this.histogram("lens_stage_duration_ms", { service: input.service, stage: input.stage }, input.durationMs, STAGE_LATENCY_BUCKETS_MS);
  }

  recordRetrievalCounts(input: { service: string; candidates: number; authorized: number }): boolean {
    if (!this.validCount(input.candidates) || !this.validCount(input.authorized) || input.authorized > input.candidates) {
      this.rejectedMeasurements += 1;
      return false;
    }
    const labels = { service: input.service, stage: "retrieval" };
    return this.histogram("lens_retrieval_candidates", labels, input.candidates, RETRIEVAL_COUNT_BUCKETS)
      && this.histogram("lens_retrieval_authorized", labels, input.authorized, RETRIEVAL_COUNT_BUCKETS);
  }

  setActiveRequests(service: string, value: number): boolean {
    if (!this.validCount(value)) {
      this.rejectedMeasurements += 1;
      return false;
    }
    return this.gauge("lens_active_requests", { service }, value);
  }

  recordResource(input: { service: string; resource: ResourceKind; utilization: number; saturation: number; errors?: number }): boolean {
    if (!this.validRatio(input.utilization) || !this.validRatio(input.saturation) || !this.validCount(input.errors ?? 0)) {
      this.rejectedMeasurements += 1;
      return false;
    }
    const labels = { service: input.service, resource: input.resource };
    return this.gauge("lens_resource_utilization_ratio", labels, input.utilization)
      && this.gauge("lens_resource_saturation_ratio", labels, input.saturation)
      && this.counter("lens_resource_errors_total", labels, input.errors ?? 0);
  }

  recordAnomaly(service: string, anomaly: AnomalySignal): boolean {
    return this.counter("lens_operational_signals_total", { service, anomaly }, 1);
  }

  snapshot(): readonly MetricPoint[] {
    const scalarPoints: MetricPoint[] = [...this.scalars.entries()].map(([key, state]) => ({
      name: key.split("|")[0] as MetricName,
      kind: state.kind,
      labels: { ...state.labels },
      value: state.value,
    }));
    const histogramPoints: MetricPoint[] = [...this.histograms.entries()].map(([key, state]) => ({
      name: key.split("|")[0] as MetricName,
      kind: "histogram",
      labels: { ...state.labels },
      bounds: [...state.bounds],
      bucketCounts: [...state.bucketCounts],
      count: state.count,
      sum: state.sum,
    }));
    return [...scalarPoints, ...histogramPoints];
  }

  accounting(): MetricAccounting {
    return {
      series: this.scalars.size + this.histograms.size,
      droppedCardinality: this.droppedCardinality,
      rejectedMeasurements: this.rejectedMeasurements,
    };
  }

  private counter(name: MetricName, labels: Readonly<Record<string, string>>, delta: number): boolean {
    return this.scalar(name, "counter", labels, delta, true);
  }

  private gauge(name: MetricName, labels: Readonly<Record<string, string>>, value: number): boolean {
    return this.scalar(name, "gauge", labels, value, false);
  }

  private scalar(name: MetricName, kind: "counter" | "gauge", labels: Readonly<Record<string, string>>, value: number, additive: boolean): boolean {
    const key = `${name}|${canonicalLabels(labels)}`;
    if (!this.admitSeries(key, labels)) return false;
    const existing = this.scalars.get(key);
    this.scalars.set(key, { labels: { ...labels }, kind, value: additive ? (existing?.value ?? 0) + value : value });
    return true;
  }

  private histogram(name: MetricName, labels: Readonly<Record<string, string>>, value: number, bounds: readonly number[]): boolean {
    const key = `${name}|${canonicalLabels(labels)}`;
    if (!this.admitSeries(key, labels)) return false;
    const state = this.histograms.get(key) ?? {
      labels: { ...labels },
      bounds,
      bucketCounts: new Array(bounds.length + 1).fill(0) as number[],
      count: 0,
      sum: 0,
    };
    const bucket = bounds.findIndex((bound) => value <= bound);
    state.bucketCounts[bucket === -1 ? bounds.length : bucket] += 1;
    state.count += 1;
    state.sum += value;
    this.histograms.set(key, state);
    return true;
  }

  private admitSeries(key: string, labels: Readonly<Record<string, string>>): boolean {
    if (this.scalars.has(key) || this.histograms.has(key)) return true;
    if (this.scalars.size + this.histograms.size >= this.limits.maxSeries) {
      this.droppedCardinality += 1;
      return false;
    }
    for (const [label, value] of Object.entries(labels)) {
      if (!ALLOWED_LABEL_KEYS.has(label) || !SAFE_LABEL.test(value)) {
        this.rejectedMeasurements += 1;
        return false;
      }
      const values = this.labelValues.get(label);
      if (values && !values.has(value) && values.size >= this.limits.maxValuesPerLabel) {
        this.droppedCardinality += 1;
        return false;
      }
    }
    for (const [label, value] of Object.entries(labels)) {
      const values = this.labelValues.get(label) ?? new Set<string>();
      values.add(value);
      this.labelValues.set(label, values);
    }
    return true;
  }

  private validMeasurement(value: number): boolean {
    if (!Number.isFinite(value) || value < 0 || value > 86_400_000) {
      this.rejectedMeasurements += 1;
      return false;
    }
    return true;
  }

  private validCount(value: number): boolean {
    return Number.isInteger(value) && value >= 0 && value <= 10_000_000;
  }

  private validRatio(value: number): boolean {
    return Number.isFinite(value) && value >= 0 && value <= 1;
  }
}

const TRACE_ATTRIBUTES = new Set([
  "artifact_digest",
  "decision_ref",
  "dependency",
  "error_code",
  "index_generation_ref",
  "parent_span_ref",
  "request_ref",
  "retrieval_ref",
  "stage",
  "turn_ref",
  "workload_ref",
]);

export interface ContentFreeSpan {
  service: string;
  operation: string;
  startedAt: string;
  endedAt: string;
  statusCode: string;
  priority?: TelemetryPriority;
  traceRef: string;
  spanRef: string;
  attributes?: Record<string, TelemetryValue>;
}

/** Emits only fixed-schema span metadata; payload-bearing span events are intentionally unsupported. */
export class ContentFreeTracer {
  constructor(private readonly collector: TelemetryCollector) {}

  recordSpan(span: ContentFreeSpan): TelemetryResult {
    const start = new Date(span.startedAt).valueOf();
    const end = new Date(span.endedAt).valueOf();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return { accepted: false, redactedFields: 0, reason: "invalid-record" };
    }
    if (!isGovernedReference(span.traceRef, "trace") || !isGovernedReference(span.spanRef, "span")) {
      return { accepted: false, redactedFields: 0, reason: "invalid-attribute" };
    }
    const attributes = span.attributes ?? {};
    if (Object.keys(attributes).some((key) => !TRACE_ATTRIBUTES.has(key))) {
      return { accepted: false, redactedFields: 1, reason: "forbidden-attribute" };
    }
    for (const [key, value] of Object.entries(attributes)) {
      if (key.endsWith("_ref")) {
        const scope = key.replace("_ref", "").replace("index_generation", "index-generation") as GovernedReferenceScope;
        if (typeof value !== "string" || !isGovernedReference(value, scope)) {
          return { accepted: false, redactedFields: 0, reason: "invalid-attribute" };
        }
      }
    }
    return this.collector.collect({
      signal: "trace",
      priority: span.priority ?? "normal",
      serviceName: span.service,
      operation: span.operation,
      timestamp: span.endedAt,
      statusCode: span.statusCode,
      attributes: {
        ...attributes,
        duration_ms: end - start,
        span_ref: span.spanRef,
        trace_ref: span.traceRef,
      },
    });
  }
}
