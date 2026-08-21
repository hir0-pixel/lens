import { isIP } from "node:net";
import { createHash } from "node:crypto";
import type { TelemetryExporter, TelemetryRecord, TelemetrySignal, TelemetryValue } from "./telemetryCollector";

export interface OtlpExporterOptions {
  endpoint: string;
  deadlineMs: number;
  maxBatchRecords: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
  allowLoopbackForTests?: boolean;
  productionMode?: boolean;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

type OtlpValue = { stringValue: string } | { doubleValue: number } | { intValue: number } | { boolValue: boolean };
type OtlpAttribute = { key: string; value: OtlpValue };

const OTLP_PATHS: Record<TelemetrySignal, string> = {
  metric: "/v1/metrics",
  log: "/v1/logs",
  trace: "/v1/traces",
};

const FORBIDDEN_DATA = /(?:api[_-]?key|authorization|bearer|chunk|content|credential|document|memory|output|password|prompt|raw|secret|session|subject|token|tool_?arg|tool_?result|user_?id)/i;
const SAFE_NAME = /^[a-z0-9][a-z0-9_.:/-]{0,95}$/i;
const GOVERNED_REFERENCE = /^gref:v1:[a-z0-9][a-z0-9_.-]{0,31}:(request|turn|retrieval|decision|index-generation|trace|span|workload):[A-Za-z0-9_-]{43}$/;

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
}

function validateEndpoint(endpoint: string, allowLoopbackForTests: boolean, productionMode: boolean): URL {
  const url = new URL(endpoint);
  if (url.username || url.password || url.hash || url.search || url.pathname !== "/") {
    throw new Error("OTLP endpoint must be an origin-only URL with no credentials, path, query, or fragment");
  }
  const hostname = normalizeHostname(url.hostname);
  const ipVersion = isIP(hostname);
  const loopback = isLoopback(hostname);
  const testLoopback = loopback && allowLoopbackForTests && !productionMode;
  if (url.protocol !== "https:" && !(testLoopback && url.protocol === "http:")) {
    throw new Error("OTLP endpoint must use internal HTTPS");
  }
  const privateHost = hostname.endsWith(".internal")
    || (ipVersion === 4 && isPrivateIpv4(hostname))
    || (ipVersion === 6 && isPrivateIpv6(hostname));
  if (!privateHost && !testLoopback) {
    throw new Error("OTLP endpoint must resolve to a private IP or .internal hostname");
  }
  return new URL(url.origin);
}

function stableHex(value: string, length: number): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function textBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertSafeRecord(record: TelemetryRecord): void {
  if (record.serviceName.toLowerCase() === "audit" || record.operation.toLowerCase().includes("audit")) {
    throw new Error("Audit events must not use operational OTLP telemetry");
  }
  if (![record.serviceName, record.operation, record.statusCode].every((value) => SAFE_NAME.test(value))) {
    throw new Error("Telemetry record contains an unsafe name");
  }
  for (const [key, value] of Object.entries(record.attributes ?? {})) {
    if (FORBIDDEN_DATA.test(key) || (typeof value === "string" && FORBIDDEN_DATA.test(value))) {
      throw new Error("Telemetry record contains forbidden payload or identity data");
    }
    if (key.endsWith("_ref") && (typeof value !== "string" || !GOVERNED_REFERENCE.test(value))) {
      throw new Error("Telemetry correlation identifiers must be governed references");
    }
  }
}

function attrValue(value: TelemetryValue): OtlpValue {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { intValue: value } : { doubleValue: value };
  }
  return { stringValue: value };
}

function attributes(record: TelemetryRecord): OtlpAttribute[] {
  return Object.entries({
    service: record.serviceName,
    operation: record.operation,
    status_code: record.statusCode,
    priority: record.priority,
    ...(record.attributes ?? {}),
  })
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({ key, value: attrValue(value) }));
}

function metricPayload(records: readonly TelemetryRecord[]) {
  return {
    resourceMetrics: [{
      scopeMetrics: [{
        metrics: records.map((record) => ({
          name: "lens_operational_records_total",
          description: "Content-free Lens operational telemetry records exported by governed signal.",
          unit: "1",
          sum: {
            aggregationTemporality: 2,
            isMonotonic: true,
            dataPoints: [{
              timeUnixNano: `${BigInt(new Date(record.timestamp).getTime()) * 1_000_000n}`,
              asInt: "1",
              attributes: attributes(record),
            }],
          },
        })),
      }],
    }],
  };
}

function logPayload(records: readonly TelemetryRecord[]) {
  return {
    resourceLogs: [{
      scopeLogs: [{
        logRecords: records.map((record) => ({
          timeUnixNano: `${BigInt(new Date(record.timestamp).getTime()) * 1_000_000n}`,
          severityText: record.priority,
          body: { stringValue: `${record.serviceName}.${record.operation}.${record.statusCode}` },
          attributes: attributes(record),
        })),
      }],
    }],
  };
}

function tracePayload(records: readonly TelemetryRecord[]) {
  return {
    resourceSpans: [{
      scopeSpans: [{
        spans: records.map((record) => {
          const traceRef = typeof record.attributes?.trace_ref === "string" ? record.attributes.trace_ref : `${record.serviceName}:${record.operation}:${record.timestamp}`;
          const spanRef = typeof record.attributes?.span_ref === "string" ? record.attributes.span_ref : `${traceRef}:${record.statusCode}`;
          return {
            traceId: stableHex(traceRef, 32),
            spanId: stableHex(spanRef, 16),
            parentSpanId: typeof record.attributes?.parent_span_ref === "string" ? stableHex(record.attributes.parent_span_ref, 16) : undefined,
            name: `${record.serviceName}.${record.operation}`,
            startTimeUnixNano: `${BigInt(new Date(record.timestamp).getTime()) * 1_000_000n}`,
            endTimeUnixNano: `${BigInt(new Date(record.timestamp).getTime()) * 1_000_000n}`,
            status: { code: record.statusCode === "ok" ? 1 : 2, message: record.statusCode },
            attributes: attributes(record),
          };
        }),
      }],
    }],
  };
}

function payloadFor(signal: TelemetrySignal, records: readonly TelemetryRecord[]): unknown {
  if (signal === "metric") return metricPayload(records);
  if (signal === "log") return logPayload(records);
  return tracePayload(records);
}

async function readBoundedResponse(response: Response, maxResponseBytes: number): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  let received = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      received += chunk.value.byteLength;
      if (received > maxResponseBytes) {
        await reader.cancel();
        throw new Error("OTLP response exceeded maximum size");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export class OtlpJsonExporter implements TelemetryExporter {
  private readonly origin: URL;
  private readonly deadlineMs: number;
  private readonly maxBatchRecords: number;
  private readonly maxRequestBytes: number;
  private readonly maxResponseBytes: number;
  private readonly signal?: AbortSignal;
  private readonly fetcher: typeof fetch;

  constructor(options: OtlpExporterOptions) {
    assertPositiveInteger("deadlineMs", options.deadlineMs);
    assertPositiveInteger("maxBatchRecords", options.maxBatchRecords);
    assertPositiveInteger("maxRequestBytes", options.maxRequestBytes);
    assertPositiveInteger("maxResponseBytes", options.maxResponseBytes);
    this.origin = validateEndpoint(
      options.endpoint,
      options.allowLoopbackForTests === true,
      options.productionMode ?? process.env.NODE_ENV === "production",
    );
    this.deadlineMs = options.deadlineMs;
    this.maxBatchRecords = options.maxBatchRecords;
    this.maxRequestBytes = options.maxRequestBytes;
    this.maxResponseBytes = options.maxResponseBytes;
    this.signal = options.signal;
    this.fetcher = options.fetch ?? fetch;
  }

  async export(records: readonly TelemetryRecord[]): Promise<void> {
    if (records.length === 0) return;
    if (records.length > this.maxBatchRecords) {
      throw new Error("OTLP export batch exceeds configured record limit");
    }
    for (const record of records) assertSafeRecord(record);

    for (const signal of ["metric", "log", "trace"] as const) {
      const grouped = records.filter((record) => record.signal === signal);
      if (grouped.length === 0) continue;
      const body = JSON.stringify(payloadFor(signal, grouped));
      if (textBytes(body) > this.maxRequestBytes) {
        throw new Error("OTLP request body exceeds configured byte limit");
      }
      const url = new URL(OTLP_PATHS[signal], this.origin);
      const timeoutSignal = AbortSignal.timeout(this.deadlineMs);
      const exportSignal = this.signal ? AbortSignal.any([this.signal, timeoutSignal]) : timeoutSignal;
      const response = await this.fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        redirect: "manual",
        signal: exportSignal,
      });
      if (response.status >= 300 && response.status < 400) {
        throw new Error("OTLP exporter refuses redirects");
      }
      await readBoundedResponse(response, this.maxResponseBytes);
      if (!response.ok) {
        throw new Error(`OTLP exporter failed with status ${response.status}`);
      }
    }
  }
}
