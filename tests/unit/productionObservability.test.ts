import { describe, expect, it } from "vitest";
import {
  ContentFreeTracer,
  ProductionMetrics,
  REQUEST_LATENCY_BUCKETS_MS,
  TelemetryCollector,
  createGovernedReference,
  isGovernedReference,
  type TelemetryRecord,
} from "../../platform/observability";

const hmacKey = { keyId: "2026q3", secret: "k".repeat(32) };

function record(overrides: Partial<TelemetryRecord> = {}): TelemetryRecord {
  return {
    signal: "log",
    priority: "normal",
    serviceName: "retrieval",
    operation: "search",
    timestamp: "2026-08-21T10:00:00.000Z",
    statusCode: "ok",
    attributes: { stage: "retrieval" },
    ...overrides,
  };
}

describe("production observability", () => {
  it("creates scoped HMAC references without retaining raw identifiers", () => {
    const raw = "employee-42/session-99";
    const requestRef = createGovernedReference(raw, "request", hmacKey);
    const traceRef = createGovernedReference(raw, "trace", hmacKey);

    expect(requestRef).not.toContain(raw);
    expect(requestRef).not.toBe(traceRef);
    expect(isGovernedReference(requestRef, "request")).toBe(true);
    expect(isGovernedReference(requestRef, "trace")).toBe(false);
    expect(() => createGovernedReference(raw, "request", { keyId: "short", secret: "weak" })).toThrow();
  });

  it("rejects payload, secret, token, subject, and session attributes", () => {
    const collector = new TelemetryCollector({ maxRecords: 10, maxBytes: 10_000 });
    const prohibited = ["prompt", "output", "chunk", "subject_id", "session_id", "access_token", "api_key"];

    for (const key of prohibited) {
      const result = collector.collect(record({ attributes: { [key]: "must-not-enter-telemetry" } }));
      expect(result).toMatchObject({ accepted: false, reason: "forbidden-attribute", redactedFields: 1 });
    }
    expect(collector.drain()).toEqual([]);
    expect(collector.accounting().droppedByReason["forbidden-attribute"]).toBe(prohibited.length);
  });

  it("keeps governed correlation references out of metric labels", () => {
    const collector = new TelemetryCollector({ maxRecords: 10, maxBytes: 10_000 });
    const requestRef = createGovernedReference("request-1", "request", hmacKey);
    const result = collector.collect(record({
      signal: "metric",
      attributes: { request_ref: requestRef },
    }));

    expect(result.accepted).toBe(false);
    expect(collector.drain()).toEqual([]);
  });

  it("uses fixed histograms and enforces series and label cardinality caps", () => {
    const metrics = new ProductionMetrics({ maxSeries: 20, maxValuesPerLabel: 1 });

    expect(metrics.recordRequest({ service: "bff", operation: "generate", outcome: "success", durationMs: 125 })).toBe(true);
    expect(metrics.recordRequest({ service: "bff", operation: "second_operation", outcome: "success", durationMs: 10 })).toBe(false);
    const histogram = metrics.snapshot().find((point) => point.name === "lens_request_duration_ms");

    expect(histogram?.bounds).toEqual(REQUEST_LATENCY_BUCKETS_MS);
    expect(histogram?.count).toBe(1);
    expect(metrics.accounting().droppedCardinality).toBe(1);
    expect(metrics.snapshot().flatMap((point) => Object.keys(point.labels))).not.toContain("request_ref");
  });

  it("records bounded USE measurements and safe anomaly signals", () => {
    const metrics = new ProductionMetrics({ maxSeries: 20, maxValuesPerLabel: 20 });

    expect(metrics.setActiveRequests("orchestrator", 12)).toBe(true);
    expect(metrics.recordResource({ service: "model", resource: "gpu", utilization: 0.8, saturation: 0.6, errors: 1 })).toBe(true);
    expect(metrics.recordAnomaly("audit", "audit_quorum_loss")).toBe(true);
    expect(metrics.recordResource({ service: "model", resource: "gpu", utilization: 1.2, saturation: 0.6 })).toBe(false);
    expect(metrics.snapshot().some((point) => point.name === "lens_operational_signals_total")).toBe(true);
    expect(metrics.accounting().rejectedMeasurements).toBe(1);
  });

  it("bounds the queue and accounts for exporter failures, backpressure, and drops", async () => {
    const collector = new TelemetryCollector({ maxRecords: 2, maxBytes: 10_000 });
    expect(collector.collect(record()).accepted).toBe(true);
    expect(collector.collect(record({ operation: "search_retry" })).accepted).toBe(true);
    expect(collector.collect(record({ operation: "overflow" }))).toMatchObject({ accepted: false, reason: "queue-full" });

    expect(await collector.exportBatch({ export: async () => { throw new Error("offline"); } }, 1)).toEqual({ exported: 0, status: "exporter-failed" });
    expect(collector.accounting().queuedRecords).toBe(2);

    let release: (() => void) | undefined;
    const pending = collector.exportBatch({
      export: () => new Promise<void>((resolve) => { release = resolve; }),
    }, 1);
    await Promise.resolve();
    expect(await collector.exportBatch({ export: async () => undefined }, 1)).toEqual({ exported: 0, status: "exporter-busy" });
    release?.();
    expect(await pending).toEqual({ exported: 1, status: "exported" });

    const accounting = collector.accounting();
    expect(accounting).toMatchObject({
      queuedRecords: 1,
      exportedRecords: 1,
      exportAttempts: 2,
      exporterFailures: 1,
      exporterBackpressure: 1,
    });
    expect(accounting.droppedByReason["queue-full"]).toBe(1);
  });

  it("emits content-free spans and rejects raw or payload-bearing trace data", () => {
    const collector = new TelemetryCollector({ maxRecords: 10, maxBytes: 10_000 });
    const tracer = new ContentFreeTracer(collector);
    const traceRef = createGovernedReference("trace-raw", "trace", hmacKey);
    const spanRef = createGovernedReference("span-raw", "span", hmacKey);
    const requestRef = createGovernedReference("request-raw", "request", hmacKey);
    const base = {
      service: "orchestrator",
      operation: "generate",
      startedAt: "2026-08-21T10:00:00.000Z",
      endedAt: "2026-08-21T10:00:00.125Z",
      statusCode: "ok",
      traceRef,
      spanRef,
    };

    expect(tracer.recordSpan({ ...base, attributes: { request_ref: requestRef, stage: "generation" } }).accepted).toBe(true);
    expect(tracer.recordSpan({ ...base, attributes: { session_id: "raw-session" } }).accepted).toBe(false);
    expect(tracer.recordSpan({ ...base, traceRef: "raw-trace-id" }).accepted).toBe(false);

    const accepted = collector.drain();
    expect(accepted).toHaveLength(1);
    expect(JSON.stringify(accepted)).not.toContain("trace-raw");
    expect(JSON.stringify(accepted)).not.toContain("request-raw");
    expect(accepted[0]?.attributes?.duration_ms).toBe(125);
  });
});
