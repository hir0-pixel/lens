import { describe, expect, it } from "vitest";
import { OtlpJsonExporter, createGovernedReference, type TelemetryRecord } from "../../platform/observability";

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

const hmacKey = { keyId: "test", secret: "k".repeat(32) };

function governed(scope: "trace" | "span" | "request", raw: string): string {
  return createGovernedReference(raw, scope, hmacKey);
}

describe("OTLP JSON exporter", () => {
  it("rejects external and loopback production endpoints before export", () => {
    expect(() => new OtlpJsonExporter({
      endpoint: "https://telemetry.vendor.example",
      deadlineMs: 100,
      maxBatchRecords: 10,
      maxRequestBytes: 16_384,
      maxResponseBytes: 1_024,
    })).toThrow(/private IP or \.internal/);

    expect(() => new OtlpJsonExporter({
      endpoint: "http://127.0.0.1:4318",
      deadlineMs: 100,
      maxBatchRecords: 10,
      maxRequestBytes: 16_384,
      maxResponseBytes: 1_024,
      allowLoopbackForTests: true,
      productionMode: true,
    })).toThrow(/internal HTTPS/);

    expect(() => new OtlpJsonExporter({
      endpoint: "https://otel-collector.rag.platform.internal/v1/logs?debug=true",
      deadlineMs: 100,
      maxBatchRecords: 10,
      maxRequestBytes: 16_384,
      maxResponseBytes: 1_024,
    })).toThrow(/origin-only/);
  });

  it("normalizes bracketed IPv6 before internal host validation", () => {
    expect(() => new OtlpJsonExporter({
      endpoint: "https://[fd00::10]:4318",
      deadlineMs: 100,
      maxBatchRecords: 10,
      maxRequestBytes: 16_384,
      maxResponseBytes: 1_024,
      productionMode: true,
    })).not.toThrow();
  });

  it("allows loopback only as an explicit non-production test fixture", async () => {
    const bodies: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("http://127.0.0.1:4318/v1/logs");
      bodies.push(String(init?.body));
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    };
    const exporter = new OtlpJsonExporter({
      endpoint: "http://127.0.0.1:4318",
      deadlineMs: 250,
      maxBatchRecords: 10,
      maxRequestBytes: 16_384,
      maxResponseBytes: 1_024,
      allowLoopbackForTests: true,
      productionMode: false,
      fetch: fetcher,
    });

    await exporter.export([record()]);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("resourceLogs");
  });

  it("uses an injected fetch implementation for deterministic adapter tests", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push(String(input));
      expect(init?.redirect).toBe("manual");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    };
    const exporter = new OtlpJsonExporter({
      endpoint: "https://otel-collector.rag.platform.internal",
      deadlineMs: 250,
      maxBatchRecords: 10,
      maxRequestBytes: 16_384,
      maxResponseBytes: 1_024,
      fetch: fetcher,
    });

    await exporter.export([record()]);
    expect(calls).toEqual(["https://otel-collector.rag.platform.internal/v1/logs"]);
  });

  it("refuses redirects and never follows a moved OTLP endpoint", async () => {
    const fetcher: typeof fetch = async () => new Response("", {
      status: 302,
      headers: { location: "https://telemetry.vendor.example/v1/logs" },
    });
    const exporter = new OtlpJsonExporter({
      endpoint: "http://127.0.0.1:4318",
      deadlineMs: 250,
      maxBatchRecords: 10,
      maxRequestBytes: 16_384,
      maxResponseBytes: 1_024,
      allowLoopbackForTests: true,
      productionMode: false,
      fetch: fetcher,
    });

    await expect(exporter.export([record()])).rejects.toThrow(/refuses redirects/);
  });

  it("bounds response bodies from internal telemetry backends", async () => {
    const fetcher: typeof fetch = async () => new Response("x".repeat(2_048), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const exporter = new OtlpJsonExporter({
      endpoint: "http://127.0.0.1:4318",
      deadlineMs: 250,
      maxBatchRecords: 10,
      maxRequestBytes: 16_384,
      maxResponseBytes: 64,
      allowLoopbackForTests: true,
      productionMode: false,
      fetch: fetcher,
    });

    await expect(exporter.export([record()])).rejects.toThrow(/response exceeded/);
  });

  it("propagates caller cancellation through the OTLP request", async () => {
    const controller = new AbortController();
    const fetcher: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")), { once: true });
    });
    const exporter = new OtlpJsonExporter({
      endpoint: "http://127.0.0.1:4318",
      deadlineMs: 5_000,
      maxBatchRecords: 10,
      maxRequestBytes: 16_384,
      maxResponseBytes: 1_024,
      allowLoopbackForTests: true,
      productionMode: false,
      signal: controller.signal,
      fetch: fetcher,
    });

    const pending = exporter.export([record()]);
    controller.abort(new Error("request cancelled"));
    await expect(pending).rejects.toThrow();
  });

  it("maps metrics, logs, and traces to OTLP JSON endpoints with governed references only", async () => {
    const paths: string[] = [];
    const bodies: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      paths.push(new URL(String(input)).pathname);
      bodies.push(String(init?.body));
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    };
    const exporter = new OtlpJsonExporter({
      endpoint: "http://127.0.0.1:4318",
      deadlineMs: 250,
      maxBatchRecords: 10,
      maxRequestBytes: 32_768,
      maxResponseBytes: 1_024,
      allowLoopbackForTests: true,
      productionMode: false,
      fetch: fetcher,
    });

    await exporter.export([
      record({ signal: "metric" }),
      record({ signal: "log" }),
      record({
        signal: "trace",
        attributes: {
          stage: "generation",
          trace_ref: governed("trace", "trace-raw"),
          span_ref: governed("span", "span-raw"),
          request_ref: governed("request", "request-raw"),
        },
      }),
    ]);

    expect(paths.sort()).toEqual(["/v1/logs", "/v1/metrics", "/v1/traces"]);
    const exported = bodies.join("\n");
    expect(exported).toContain("resourceMetrics");
    expect(exported).toContain("resourceLogs");
    expect(exported).toContain("resourceSpans");
    expect(exported).toContain("gref:v1:test:request");
    expect(exported).not.toContain("raw");
    expect(exported).not.toContain("session");
  });

  it("rejects Audit and payload-bearing records before any network write", async () => {
    let requests = 0;
    const fetcher: typeof fetch = async () => {
      requests += 1;
      return new Response("{}");
    };
    const exporter = new OtlpJsonExporter({
      endpoint: "http://127.0.0.1:4318",
      deadlineMs: 250,
      maxBatchRecords: 10,
      maxRequestBytes: 16_384,
      maxResponseBytes: 1_024,
      allowLoopbackForTests: true,
      productionMode: false,
      fetch: fetcher,
    });

    await expect(exporter.export([record({ serviceName: "audit" })])).rejects.toThrow(/Audit events/);
    await expect(exporter.export([record({ attributes: { prompt: "secret company policy" } })])).rejects.toThrow(/forbidden/);
    expect(requests).toBe(0);
  });
});
