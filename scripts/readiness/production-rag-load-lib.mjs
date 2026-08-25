import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { resolve } from "node:path";

const MAX_TLS_MATERIAL_BYTES = 64 * 1024;
const MAX_TOKEN_BYTES = 8 * 1024;
const MAX_FIXTURE_BYTES = 32 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_QUERY_CHARS = 8_192;
const MAX_QUERY_UTF8_BYTES = 32 * 1024;
const MAX_BODY_BYTES = 48 * 1024;
const SAFE_DIGEST = /^sha256:[a-f0-9]{64}$/;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_TOKEN = /^[A-Za-z0-9._:/+=-]{32,8192}$/;
const PHASE_NAMES = ["sustained", "burst", "cancellation", "fault-observation", "recovery-surge"];
const CHAT_ENDPOINT_PATH = "/v1/chat";
const RETRIEVE_ENDPOINT_PATH = "/v1/retrieve";
const SYNTHETIC_FIXTURE_PATH = resolve("scripts/readiness/approved-synthetic-rag-prompts.json");

export class ProductionRagLoadError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function boundedInteger(name, value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ProductionRagLoadError("INVALID_ARGUMENT", `${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function boundedNumber(name, value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ProductionRagLoadError("INVALID_ARGUMENT", `${name} must be a finite number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function boundedFraction(name, value) {
  return boundedNumber(name, value, 0, 1);
}

function textBytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function iso(now) {
  return new Date(now).toISOString();
}

function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
}

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function isPrivateIpv6(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

function validateTargetEndpoint(endpoint, mode, allowLoopbackForTests, productionMode) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ProductionRagLoadError("INVALID_CONFIG", "Endpoint is not a valid URL.");
  }
  const requiredPath = mode === "retrieve" ? RETRIEVE_ENDPOINT_PATH : CHAT_ENDPOINT_PATH;
  if (url.username || url.password || url.hash || url.search || url.pathname !== requiredPath) {
    throw new ProductionRagLoadError("INVALID_CONFIG", `Endpoint must be an origin-only internal URL ending at ${requiredPath}.`);
  }
  const hostname = normalizeHostname(url.hostname);
  const ipVersion = isIP(hostname);
  const loopback = isLoopback(hostname);
  const testLoopback = allowLoopbackForTests === true && productionMode !== true && loopback && url.protocol === "http:";
  if (loopback && !testLoopback) {
    throw new ProductionRagLoadError("INVALID_CONFIG", "Loopback endpoints are test-only.");
  }
  if (url.protocol !== "https:" && !testLoopback) {
    throw new ProductionRagLoadError("INVALID_CONFIG", "Endpoint must use internal HTTPS.");
  }
  const privateHost = hostname.endsWith(".internal")
    || (ipVersion === 4 && isPrivateIpv4(hostname))
    || (ipVersion === 6 && isPrivateIpv6(hostname));
  if (!privateHost && !testLoopback) {
    throw new ProductionRagLoadError("INVALID_CONFIG", "Endpoint must resolve to a private IP or .internal hostname.");
  }
  return new URL(url.toString());
}

function readBoundedFile(path, label, maxBytes, encoding) {
  if (!path) throw new ProductionRagLoadError("INVALID_CONFIG", `${label} path is required.`);
  let stats;
  try {
    stats = statSync(path);
  } catch {
    throw new ProductionRagLoadError("INVALID_CONFIG", `${label} file is unreadable.`);
  }
  if (!stats.isFile() || stats.size < 1 || stats.size > maxBytes) {
    throw new ProductionRagLoadError("INVALID_CONFIG", `${label} file must be a readable non-empty file under ${maxBytes} bytes.`);
  }
  return readFileSync(path, encoding);
}

function readTlsMaterial(options) {
  return {
    ca: readBoundedFile(options.caFile, "CA", MAX_TLS_MATERIAL_BYTES),
    cert: readBoundedFile(options.certFile, "Client certificate", MAX_TLS_MATERIAL_BYTES),
    key: readBoundedFile(options.keyFile, "Client key", MAX_TLS_MATERIAL_BYTES),
  };
}

function readOptionalTokenFile(path) {
  if (!path) return undefined;
  const token = readBoundedFile(path, "Workload token", MAX_TOKEN_BYTES, "utf8").trim();
  if (textBytes(token) < 32 || !SAFE_TOKEN.test(token)) {
    throw new ProductionRagLoadError("INVALID_CONFIG", "Workload token file must contain at least 32 bytes of bounded token material.");
  }
  return token;
}

function loadApprovedSyntheticFixture(path) {
  const raw = readBoundedFile(path, "Synthetic fixture", MAX_FIXTURE_BYTES, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProductionRagLoadError("INVALID_CONFIG", "Synthetic fixture must contain valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProductionRagLoadError("INVALID_CONFIG", "Synthetic fixture must contain an object.");
  }
  if (parsed.schema_version !== 1) {
    throw new ProductionRagLoadError("INVALID_CONFIG", "Synthetic fixture schema_version must be 1.");
  }
  if (typeof parsed.fixture_ref !== "string" || !SAFE_REF.test(parsed.fixture_ref)) {
    throw new ProductionRagLoadError("INVALID_CONFIG", "Synthetic fixture must declare a bounded fixture_ref.");
  }
  if (!Array.isArray(parsed.chat_templates) || parsed.chat_templates.length < 1) {
    throw new ProductionRagLoadError("INVALID_CONFIG", "Synthetic fixture must include at least one chat template.");
  }
  if (!Array.isArray(parsed.retrieval_templates) || parsed.retrieval_templates.length < 1) {
    throw new ProductionRagLoadError("INVALID_CONFIG", "Synthetic fixture must include at least one retrieval template.");
  }
  if (!Array.isArray(parsed.topics) || parsed.topics.length < 1) {
    throw new ProductionRagLoadError("INVALID_CONFIG", "Synthetic fixture must include at least one synthetic topic.");
  }
  return {
    fixtureRef: parsed.fixture_ref,
    fixtureDigest: sha256(raw),
    chatTemplates: parsed.chat_templates.map(assertTemplate),
    retrievalTemplates: parsed.retrieval_templates.map(assertTemplate),
    topics: parsed.topics.map(assertTemplate),
  };
}

function assertTemplate(value) {
  if (typeof value !== "string" || value.trim().length < 8 || value.length > 512) {
    throw new ProductionRagLoadError("INVALID_CONFIG", "Synthetic fixture entries must be bounded strings.");
  }
  return value.trim();
}

function choose(list, index) {
  return list[index % list.length];
}

function fillTemplate(template, substitutions) {
  return template
    .replaceAll("{{topic}}", substitutions.topic)
    .replaceAll("{{batch}}", substitutions.batch)
    .replaceAll("{{sequence}}", substitutions.sequence)
    .replaceAll("{{session_class}}", substitutions.sessionClass)
    .replaceAll("{{candidate_limit}}", substitutions.candidateLimit);
}

function buildSyntheticQuery(fixture, mode, sequence, connectedSessions, candidateLimit) {
  const topic = choose(fixture.topics, sequence);
  const template = mode === "retrieve" ? choose(fixture.retrievalTemplates, sequence) : choose(fixture.chatTemplates, sequence);
  const query = fillTemplate(template, {
    topic,
    batch: `batch-${Math.floor(sequence / 10) + 1}`,
    sequence: String(sequence + 1),
    sessionClass: String(connectedSessions),
    candidateLimit: String(candidateLimit ?? 0),
  });
  if (Array.from(query).length > MAX_QUERY_CHARS || textBytes(query) > MAX_QUERY_UTF8_BYTES) {
    throw new ProductionRagLoadError("INVALID_CONFIG", "Synthetic fixture rendered a query that exceeds the Retrieval envelope.");
  }
  return query;
}

function classifyBody(bodyText) {
  if (!bodyText) return {};
  try {
    const parsed = JSON.parse(bodyText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function classifyOutcome(response, bodyText, aborted) {
  if (aborted) return { category: "cancelled", statusClass: "cancelled" };
  if (response.redirected === true || (response.status >= 300 && response.status < 400)) {
    return { category: "redirect_rejected", statusClass: "3xx" };
  }
  const parsed = classifyBody(bodyText);
  const error = typeof parsed.error === "string" ? parsed.error : "";
  if (response.status >= 200 && response.status < 300) {
    return { category: "success", statusClass: "2xx" };
  }
  if (response.status === 400) return { category: "invalid_argument", statusClass: "4xx" };
  if (response.status === 401) return { category: "unauthenticated", statusClass: "4xx" };
  if (response.status === 403) return { category: "forbidden", statusClass: "4xx" };
  if (response.status === 404) return { category: "not_found", statusClass: "4xx" };
  if (response.status === 409 || response.status === 412) return { category: "conflict", statusClass: "4xx" };
  if (response.status === 413) return { category: "payload_too_large", statusClass: "4xx" };
  if (response.status === 429 || error === "RATE_LIMITED") return { category: "rate_limited", statusClass: "4xx", overload: true };
  if (response.status === 503 && error === "OVERLOADED") return { category: "overloaded", statusClass: "5xx", overload: true };
  if (response.status === 503 && error === "DRAINING") return { category: "draining", statusClass: "5xx" };
  if (response.status >= 500) return { category: "dependency_unavailable", statusClass: "5xx" };
  return { category: "unexpected_response", statusClass: `${Math.floor(response.status / 100)}xx` };
}

function createStats(name, config) {
  return {
    name,
    targetRatePerSec: config.targetRatePerSec,
    attempted: 0,
    completed: 0,
    success: 0,
    cancelled: 0,
    overload: 0,
    typedFailures: {},
    statusClasses: {},
    latencies: [],
    peakInFlight: 0,
  };
}

function recordOutcome(stats, durationMs, outcome, inFlightAfterStart) {
  stats.completed += 1;
  stats.latencies.push(durationMs);
  stats.peakInFlight = Math.max(stats.peakInFlight, inFlightAfterStart);
  stats.statusClasses[outcome.statusClass] = (stats.statusClasses[outcome.statusClass] ?? 0) + 1;
  if (outcome.category === "success") {
    stats.success += 1;
    return;
  }
  if (outcome.category === "cancelled") {
    stats.cancelled += 1;
    return;
  }
  if (outcome.overload) stats.overload += 1;
  stats.typedFailures[outcome.category] = (stats.typedFailures[outcome.category] ?? 0) + 1;
}

function finalizeStats(stats, durationMs) {
  return {
    name: stats.name,
    target_rate_per_sec: stats.targetRatePerSec,
    attempted: stats.attempted,
    completed: stats.completed,
    success: stats.success,
    cancelled: stats.cancelled,
    overload: stats.overload,
    achieved_rate_per_sec: durationMs > 0 ? round3(stats.attempted / (durationMs / 1000)) : 0,
    peak_in_flight: stats.peakInFlight,
    status_classes: stats.statusClasses,
    typed_failures: sortRecord(stats.typedFailures),
    latency_ms: summarizeLatencies(stats.latencies),
  };
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function summarizeLatencies(values) {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: values.length ? Math.max(...values) : 0,
  };
}

function sortRecord(record) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

function createNodeHttpsTransport() {
  return async function send(request) {
    const transport = request.url.protocol === "https:" ? https : http;
    const headers = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, String(value)]));
    return new Promise((resolve, reject) => {
      const req = transport.request({
        protocol: request.url.protocol,
        hostname: request.url.hostname,
        port: request.url.port || undefined,
        path: `${request.url.pathname}${request.url.search}`,
        method: request.method,
        headers,
        ca: request.ca,
        cert: request.cert,
        key: request.key,
        rejectUnauthorized: request.url.protocol === "https:",
        signal: request.signal,
      }, (res) => {
        const declaredLength = Number(res.headers["content-length"] ?? "0");
        if (Number.isFinite(declaredLength) && declaredLength > request.maxResponseBytes) {
          req.destroy(new ProductionRagLoadError("INVALID_RESPONSE", "Response exceeded the declared byte envelope."));
          return;
        }
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > request.maxResponseBytes) {
            req.destroy(new ProductionRagLoadError("INVALID_RESPONSE", "Response exceeded the byte envelope."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: Object.fromEntries(
              Object.entries(res.headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value ?? "")]),
            ),
            bodyText: Buffer.concat(chunks).toString("utf8"),
          });
        });
      });
      req.on("error", (error) => {
        if (error instanceof ProductionRagLoadError) {
          reject(error);
          return;
        }
        if (request.signal?.aborted) {
          reject(new ProductionRagLoadError("CANCELLED", "Request was cancelled."));
          return;
        }
        reject(new ProductionRagLoadError("UNAVAILABLE", "Target endpoint is unavailable."));
      });
      req.write(request.body);
      req.end();
    });
  };
}

function composeSignal(controller, deadlineMs) {
  return AbortSignal.any([controller.signal, AbortSignal.timeout(deadlineMs)]);
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDigests(digests) {
  const normalized = {
    environment_digest: digests.environmentDigest,
    model_digest: digests.modelDigest,
    corpus_digest: digests.corpusDigest,
    index_digest: digests.indexDigest,
    artifact_digest: digests.artifactDigest,
  };
  for (const [key, value] of Object.entries(normalized)) {
    if (value !== undefined && value !== null && !SAFE_DIGEST.test(value)) {
      throw new ProductionRagLoadError("INVALID_ARGUMENT", `${key} must be an exact sha256 digest when supplied.`);
    }
  }
  return normalized;
}

function requireProfilePhases(options) {
  const sustainedDurationMs = boundedInteger("sustainedDurationMs", options.sustainedDurationMs, 0, 12 * 60 * 60 * 1000);
  const burstDurationMs = boundedInteger("burstDurationMs", options.burstDurationMs ?? 0, 0, 12 * 60 * 60 * 1000);
  const cancellationDurationMs = boundedInteger("cancellationDurationMs", options.cancellationDurationMs ?? 0, 0, 12 * 60 * 60 * 1000);
  const faultObservationDurationMs = boundedInteger("faultObservationDurationMs", options.faultObservationDurationMs ?? 0, 0, 12 * 60 * 60 * 1000);
  const recoveryDurationMs = boundedInteger("recoveryDurationMs", options.recoveryDurationMs ?? 0, 0, 12 * 60 * 60 * 1000);
  return {
    sustainedDurationMs,
    burstDurationMs,
    cancellationDurationMs,
    faultObservationDurationMs,
    recoveryDurationMs,
  };
}

function buildPhases(config) {
  const phases = [];
  let cursor = 0;
  const add = (name, durationMs, ratePerSec, extras = {}) => {
    if (durationMs <= 0) return;
    phases.push({
      name,
      startMs: cursor,
      endMs: cursor + durationMs,
      durationMs,
      targetRatePerSec: ratePerSec,
      cancellationFraction: extras.cancellationFraction ?? 0,
      cancelAfterMs: extras.cancelAfterMs ?? 0,
    });
    cursor += durationMs;
  };
  add("sustained", config.sustainedDurationMs, config.targetRatePerSec);
  add("burst", config.burstDurationMs, config.targetRatePerSec * config.burstMultiplier);
  add("cancellation", config.cancellationDurationMs, config.targetRatePerSec, {
    cancellationFraction: config.cancellationFraction,
    cancelAfterMs: config.cancelAfterMs,
  });
  add("fault-observation", config.faultObservationDurationMs, config.targetRatePerSec);
  add("recovery-surge", config.recoveryDurationMs, config.recoveryRatePerSec);
  return phases;
}

function phaseFor(phases, elapsedMs) {
  return phases.find((phase) => elapsedMs >= phase.startMs && elapsedMs < phase.endMs) ?? phases.at(-1);
}

function buildChatBody(query, refs, deadlineAt) {
  return {
    request_id: refs.requestId,
    turn_id: refs.turnId,
    subject_ref: refs.subjectRef,
    session_ref: refs.sessionRef,
    device_ref: refs.deviceRef,
    application_id: "lens-employee-client",
    purpose_ref: "load-readiness",
    retrieval_class: "enterprise-grounded",
    capability: "grounded-assistant",
    input_text: query,
    query_digest: sha256(query),
    deadline_at: deadlineAt,
    cancellation: false,
    retry_budget: 0,
    bulkhead: "interactive",
  };
}

function buildRetrieveBody(query, refs, deadlineAt, candidateLimit) {
  return {
    request_id: refs.requestId,
    turn_id: refs.turnId,
    caller_workload_ref: "ai-orchestrator",
    subject_ref: refs.subjectRef,
    session_ref: refs.sessionRef,
    device_ref: refs.deviceRef,
    application_id: "lens-employee-client",
    query_digest: sha256(query),
    query_text: query,
    purpose_ref: "load-readiness",
    retrieval_class: "enterprise-grounded",
    corpus_ref: "synthetic-readiness-corpus",
    mode: "hybrid",
    candidate_limit: candidateLimit,
    deadline_at: deadlineAt,
    cancellation: false,
    bulkhead: "interactive",
    visibility_minimum: 0,
  };
}

function buildRefs(runOrdinal, sequence, connectedSessions) {
  const sessionOrdinal = sequence % Math.max(1, connectedSessions);
  return {
    requestId: `req-${runOrdinal}-${sequence + 1}`,
    turnId: `turn-${runOrdinal}-${sequence + 1}`,
    subjectRef: `subject-${runOrdinal}-${(sessionOrdinal % 999) + 1}`,
    sessionRef: `session-${runOrdinal}-${sessionOrdinal + 1}`,
    deviceRef: `device-${runOrdinal}-${(sessionOrdinal % 97) + 1}`,
  };
}

function ensureRequestEnvelope(body) {
  const serialized = JSON.stringify(body);
  if (textBytes(serialized) > MAX_BODY_BYTES) {
    throw new ProductionRagLoadError("INVALID_CONFIG", "Generated request body exceeds the 48 KiB bound.");
  }
  return serialized;
}

function buildHeaders(mode, workloadToken) {
  if (!workloadToken) {
    throw new ProductionRagLoadError("INVALID_CONFIG", "A workload token file is required for both chat and retrieve harness modes.");
  }
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (mode === "chat") return { ...headers, "x-lens-orchestrator-token": workloadToken };
  return {
    ...headers,
    "x-lens-orchestrator-token": workloadToken,
    "x-lens-caller-workload": "ai-orchestrator",
  };
}

function deriveEvaluation(summary, config, digests) {
  const reasons = [];
  const minAchievedRate = config.targetRatePerSec * config.minAchievedRateFraction;
  const headroomFraction = config.maxInFlight > 0 ? (config.maxInFlight - summary.peak_in_flight) / config.maxInFlight : 0;
  if (summary.achieved_rate_per_sec < minAchievedRate) {
    reasons.push(`achieved_rate_below_floor:${summary.achieved_rate_per_sec}<${round3(minAchievedRate)}`);
  }
  if (headroomFraction < config.minHeadroomFraction) {
    reasons.push(`headroom_below_floor:${round3(headroomFraction)}<${config.minHeadroomFraction}`);
  }
  if (summary.pacing.drop_count > config.maxPacingDrops) {
    reasons.push(`pacing_drop_count_exceeded:${summary.pacing.drop_count}>${config.maxPacingDrops}`);
  }
  if (summary.pacing.peak_lag_ms > config.maxLagMs) {
    reasons.push(`pacing_lag_exceeded:${summary.pacing.peak_lag_ms}>${config.maxLagMs}`);
  }
  if (summary.pacing.peak_backlog_tokens > config.maxBacklogTokens) {
    reasons.push(`pacing_backlog_exceeded:${summary.pacing.peak_backlog_tokens}>${config.maxBacklogTokens}`);
  }
  for (const phase of summary.phases ?? []) {
    const phaseFloor = phase.target_rate_per_sec * config.minAchievedRateFraction;
    if (phase.achieved_rate_per_sec < phaseFloor) {
      reasons.push(`phase_rate_below_floor:${phase.name}:${phase.achieved_rate_per_sec}<${round3(phaseFloor)}`);
    }
  }
  for (const [key, value] of Object.entries(digests)) {
    if (!value) reasons.push(`missing_digest:${key}`);
  }
  return {
    pass: reasons.length === 0,
    reasons,
    min_achieved_rate_per_sec: round3(minAchievedRate),
    required_headroom_fraction: config.minHeadroomFraction,
    measured_headroom_fraction: round3(headroomFraction),
  };
}

export async function runProductionRagLoad(options, hooks = {}) {
  const productionMode = options.productionMode ?? true;
  const mode = options.mode === "retrieve" ? "retrieve" : "chat";
  const endpoint = validateTargetEndpoint(
    options.endpoint,
    mode,
    options.allowLoopbackForTests === true,
    productionMode,
  );
  const tls = readTlsMaterial(options);
  const workloadToken = readOptionalTokenFile(options.workloadTokenFile);
  const fixture = loadApprovedSyntheticFixture(options.fixtureFile ?? SYNTHETIC_FIXTURE_PATH);
  const digests = normalizeDigests({
    environmentDigest: options.environmentDigest,
    modelDigest: options.modelDigest,
    corpusDigest: options.corpusDigest,
    indexDigest: options.indexDigest,
    artifactDigest: options.artifactDigest,
  });

  const targetRatePerSec = boundedNumber("targetRatePerSec", options.targetRatePerSec, 0.1, 10_000);
  const maxInFlight = boundedInteger("maxInFlight", options.maxInFlight, 1, 20_000);
  const connectedSessions = boundedInteger("connectedSessions", options.connectedSessions, 1, 20_000);
  const phaseDurations = requireProfilePhases(options);
  const burstMultiplier = boundedNumber("burstMultiplier", options.burstMultiplier ?? 1, 1, 10);
  const cancellationFraction = boundedFraction("cancellationFraction", options.cancellationFraction ?? 0);
  const cancelAfterMs = boundedInteger("cancelAfterMs", options.cancelAfterMs ?? 0, 0, 300_000);
  const recoveryRateMaximum = phaseDurations.recoveryDurationMs > 0 ? targetRatePerSec : 10_000;
  const recoveryRatePerSec = boundedNumber("recoveryRatePerSec", options.recoveryRatePerSec ?? targetRatePerSec, 0.1, recoveryRateMaximum);
  const requestDeadlineMs = boundedInteger("requestDeadlineMs", options.requestDeadlineMs ?? 30_000, 1_000, 60_000);
  const maxResponseBytes = boundedInteger("maxResponseBytes", options.maxResponseBytes ?? MAX_RESPONSE_BYTES, 1, MAX_RESPONSE_BYTES);
  const maxLagMs = boundedInteger("maxLagMs", options.maxLagMs ?? 1_000, 1, 60_000);
  const maxBacklogTokens = boundedInteger("maxBacklogTokens", options.maxBacklogTokens ?? 8, 0, 10_000);
  const maxPacingDrops = boundedInteger("maxPacingDrops", options.maxPacingDrops ?? 0, 0, 10_000);
  const minHeadroomFraction = boundedFraction("minHeadroomFraction", options.minHeadroomFraction ?? 0.02);
  const minAchievedRateFraction = boundedFraction("minAchievedRateFraction", options.minAchievedRateFraction ?? 0.98);
  const candidateLimit = mode === "retrieve"
    ? boundedInteger("candidateLimit", options.candidateLimit, 100, 1_000)
    : undefined;
  if (mode === "retrieve" && ![100, 500, 1000].includes(candidateLimit)) {
    throw new ProductionRagLoadError("INVALID_ARGUMENT", "Retrieval candidateLimit must be one of 100, 500, or 1000.");
  }

  const config = {
    mode,
    targetRatePerSec,
    maxInFlight,
    connectedSessions,
    burstMultiplier,
    cancellationFraction,
    cancelAfterMs,
    recoveryRatePerSec,
    requestDeadlineMs,
    maxLagMs,
    maxBacklogTokens,
    maxPacingDrops,
    minHeadroomFraction,
    minAchievedRateFraction,
    candidateLimit,
    ...phaseDurations,
  };

  const phases = buildPhases(config);
  if (phases.length < 1) {
    throw new ProductionRagLoadError("INVALID_ARGUMENT", "At least one load phase is required.");
  }

  const transport = hooks.transport ?? createNodeHttpsTransport();
  const now = hooks.now ?? (() => Date.now());
  const perfNow = hooks.perfNow ?? (() => performance.now());
  const sleep = hooks.sleep ?? defaultSleep;
  const setDelay = hooks.setTimeout ?? setTimeout;
  const clearDelay = hooks.clearTimeout ?? clearTimeout;
  const writeOutput = hooks.writeFileSync ?? writeFileSync;
  const runOrdinal = String(now()).replace(/\D/g, "").slice(-10) || "1";
  const startedAtWall = now();
  const startedAtPerf = perfNow();
  const totalDurationMs = phases.at(-1).endMs;
  const bucketCapacity = Math.max(maxBacklogTokens + 1, Math.ceil(targetRatePerSec * Math.max(1, maxLagMs) / 1000) + 1);
  const headers = buildHeaders(mode, workloadToken);
  const summaryStats = createStats("total", config);
  const phaseStats = Object.fromEntries(phases.map((phase) => [phase.name, createStats(phase.name, phase)]));
  const evaluationState = {
    pacingDropCount: 0,
    peakLagMs: 0,
    peakBacklogTokens: 0,
    stopReason: null,
  };

  let sequence = 0;
  let tokens = 0;
  let inFlight = 0;
  let peakInFlight = 0;
  let lastTick = perfNow();
  let schedulingClosed = false;
  const pending = new Set();

  const dispatchRequest = (phase, ordinal) => {
    const query = buildSyntheticQuery(fixture, mode, ordinal, connectedSessions, candidateLimit);
    const refs = buildRefs(runOrdinal, ordinal, connectedSessions);
    const deadlineAt = now() + requestDeadlineMs;
    const body = ensureRequestEnvelope(
      mode === "retrieve"
        ? buildRetrieveBody(query, refs, deadlineAt, candidateLimit)
        : buildChatBody(query, refs, deadlineAt),
    );
    const controller = new AbortController();
    const signal = composeSignal(controller, requestDeadlineMs);
    const shouldCancel = phase.cancellationFraction > 0 && ((ordinal % 1000) / 1000) < phase.cancellationFraction;
    let cancellationTimer;
    if (shouldCancel && phase.cancelAfterMs > 0) {
      cancellationTimer = setDelay(() => controller.abort(new Error("synthetic-cancel")), phase.cancelAfterMs);
    }
    const startedAt = perfNow();
    const requestPromise = (async () => {
      try {
        const response = await transport({
          method: "POST",
          url: endpoint,
          headers,
          body,
          signal,
          ca: tls.ca,
          cert: tls.cert,
          key: tls.key,
          maxResponseBytes,
        });
        const contentType = String(response.headers?.["content-type"] ?? "").toLowerCase();
        if (!contentType.includes("application/json")) {
          throw new ProductionRagLoadError("INVALID_RESPONSE", "Response must be JSON.");
        }
        if (textBytes(response.bodyText ?? "") > maxResponseBytes) {
          throw new ProductionRagLoadError("INVALID_RESPONSE", "Response exceeded the byte envelope.");
        }
        return {
          durationMs: Math.max(0, Math.round(perfNow() - startedAt)),
          outcome: classifyOutcome(response, response.bodyText ?? "", false),
        };
      } catch (error) {
        if (signal.aborted || error?.code === "CANCELLED" || error?.name === "AbortError") {
          return {
            durationMs: Math.max(0, Math.round(perfNow() - startedAt)),
            outcome: { category: "cancelled", statusClass: "cancelled" },
          };
        }
        if (error instanceof ProductionRagLoadError && error.code === "INVALID_RESPONSE") {
          return {
            durationMs: Math.max(0, Math.round(perfNow() - startedAt)),
            outcome: { category: "invalid_response", statusClass: "transport" },
          };
        }
        return {
          durationMs: Math.max(0, Math.round(perfNow() - startedAt)),
          outcome: { category: "transport_unavailable", statusClass: "transport" },
        };
      } finally {
        if (cancellationTimer !== undefined) clearDelay(cancellationTimer);
      }
    })();

    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    summaryStats.attempted += 1;
    phaseStats[phase.name].attempted += 1;
    pending.add(requestPromise);
    requestPromise
      .then(({ durationMs, outcome }) => {
        recordOutcome(summaryStats, durationMs, outcome, peakInFlight);
        recordOutcome(phaseStats[phase.name], durationMs, outcome, peakInFlight);
      })
      .finally(() => {
        inFlight -= 1;
        pending.delete(requestPromise);
      });
  };

  while (!schedulingClosed) {
    const nowPerf = perfNow();
    const elapsed = Math.max(0, nowPerf - startedAtPerf);
    if (elapsed >= totalDurationMs) {
      schedulingClosed = true;
      break;
    }
    const phase = phaseFor(phases, elapsed);
    const deltaMs = Math.max(0, nowPerf - lastTick);
    lastTick = nowPerf;
    tokens = Math.min(bucketCapacity, tokens + ((deltaMs / 1000) * phase.targetRatePerSec));
    const lagMs = phase.targetRatePerSec > 0 ? (tokens / phase.targetRatePerSec) * 1000 : 0;
    const backlogTokens = Math.max(0, Math.floor(tokens) - Math.max(0, maxInFlight - inFlight));
    evaluationState.peakLagMs = Math.max(evaluationState.peakLagMs, Math.round(lagMs));
    evaluationState.peakBacklogTokens = Math.max(evaluationState.peakBacklogTokens, backlogTokens);
    if (lagMs > maxLagMs || backlogTokens > maxBacklogTokens) {
      evaluationState.pacingDropCount += Math.floor(tokens);
      evaluationState.stopReason = lagMs > maxLagMs ? "pacing_lag_exceeded" : "pacing_backlog_exceeded";
      tokens = 0;
      schedulingClosed = true;
      break;
    }
    let dispatched = 0;
    while (tokens >= 1 && inFlight < maxInFlight) {
      tokens -= 1;
      dispatchRequest(phase, sequence);
      sequence += 1;
      dispatched += 1;
    }
    if (tokens >= 1 && inFlight >= maxInFlight) {
      evaluationState.peakBacklogTokens = Math.max(evaluationState.peakBacklogTokens, Math.floor(tokens));
    }
    if (dispatched === 0) {
      const sleepMs = Math.max(1, Math.min(25, Math.ceil(1000 / phase.targetRatePerSec)));
      await sleep(sleepMs);
    }
  }

  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
  }

  const completedAtWall = now();
  const durationMs = Math.max(1, Math.round(perfNow() - startedAtPerf));
  const phaseSummaries = phases.map((phase) => finalizeStats(phaseStats[phase.name], phase.durationMs));
  const summary = {
    schema_version: 1,
    evidence_kind: mode === "retrieve" ? "production-rag-retrieval-load" : "production-rag-chat-load",
    pass: false,
    mode,
    target: mode === "retrieve" ? "internal-retrieval-v1" : "internal-orchestrator-v1",
    started_at: iso(startedAtWall),
    completed_at: iso(completedAtWall),
    duration_ms: durationMs,
    profile: {
      connected_sessions: connectedSessions,
      max_in_flight: maxInFlight,
      target_rate_per_sec: targetRatePerSec,
      burst_multiplier: burstMultiplier,
      request_deadline_ms: requestDeadlineMs,
      candidate_limit: candidateLimit,
      phases: phases.map((phase) => ({
        name: phase.name,
        duration_ms: phase.durationMs,
        target_rate_per_sec: phase.targetRatePerSec,
        cancellation_fraction: phase.cancellationFraction,
        cancel_after_ms: phase.cancelAfterMs,
      })),
      boundedness: {
        max_lag_ms: maxLagMs,
        max_backlog_tokens: maxBacklogTokens,
        max_pacing_drops: maxPacingDrops,
        min_headroom_fraction: minHeadroomFraction,
        min_achieved_rate_fraction: minAchievedRateFraction,
      },
    },
    fixture: {
      fixture_ref: fixture.fixtureRef,
      fixture_digest: fixture.fixtureDigest,
    },
    digests,
    attempted: summaryStats.attempted,
    completed: summaryStats.completed,
    success: summaryStats.success,
    cancelled: summaryStats.cancelled,
    overload: summaryStats.overload,
    achieved_rate_per_sec: round3(summaryStats.attempted / (durationMs / 1000)),
    peak_in_flight: peakInFlight,
    status_classes: sortRecord(summaryStats.statusClasses),
    typed_failures: sortRecord(summaryStats.typedFailures),
    latency_ms: summarizeLatencies(summaryStats.latencies),
    pacing: {
      peak_lag_ms: evaluationState.peakLagMs,
      peak_backlog_tokens: evaluationState.peakBacklogTokens,
      drop_count: evaluationState.pacingDropCount,
      harness_stop_reason: evaluationState.stopReason,
    },
    phases: phaseSummaries,
    note: "PASS only indicates that this content-free synthetic harness met its local boundedness thresholds. It does not certify production readiness, deployment safety, or environment evidence gates.",
  };

  const evaluation = deriveEvaluation(summary, config, digests);
  summary.pass = evaluation.pass;
  summary.evaluation = evaluation;

  const serialized = JSON.stringify(summary, null, 2);
  if (options.outputPath) {
    writeOutput(options.outputPath, `${serialized}\n`, "utf8");
  }
  return summary;
}

function parseFlagArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new ProductionRagLoadError("INVALID_ARGUMENT", `Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    if (key === "help" || key === "allow-loopback-for-tests") {
      parsed[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new ProductionRagLoadError("INVALID_ARGUMENT", `Missing value for --${key}`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function parseCli(argv, env) {
  const args = parseFlagArguments(argv);
  if (args.help) return { help: true };
  return {
    mode: args.mode ?? env.LENS_RAG_LOAD_MODE ?? "chat",
    endpoint: args.endpoint ?? env.LENS_RAG_LOAD_ENDPOINT,
    caFile: args["ca-file"] ?? env.LENS_RAG_LOAD_CA_FILE,
    certFile: args["cert-file"] ?? env.LENS_RAG_LOAD_CERT_FILE,
    keyFile: args["key-file"] ?? env.LENS_RAG_LOAD_KEY_FILE,
    workloadTokenFile: args["workload-token-file"] ?? env.LENS_RAG_LOAD_WORKLOAD_TOKEN_FILE,
    fixtureFile: args.fixture ?? env.LENS_RAG_LOAD_FIXTURE_FILE ?? SYNTHETIC_FIXTURE_PATH,
    targetRatePerSec: Number(args["target-rate"] ?? env.LENS_RAG_LOAD_TARGET_RATE ?? 43),
    maxInFlight: Number(args["max-inflight"] ?? env.LENS_RAG_LOAD_MAX_INFLIGHT ?? 100),
    connectedSessions: Number(args["connected-sessions"] ?? env.LENS_RAG_LOAD_CONNECTED_SESSIONS ?? 100),
    sustainedDurationMs: Number(args["sustained-ms"] ?? env.LENS_RAG_LOAD_SUSTAINED_MS ?? 30 * 60 * 1000),
    burstMultiplier: Number(args["burst-multiplier"] ?? env.LENS_RAG_LOAD_BURST_MULTIPLIER ?? 1.25),
    burstDurationMs: Number(args["burst-ms"] ?? env.LENS_RAG_LOAD_BURST_MS ?? 5 * 60 * 1000),
    cancellationFraction: Number(args["cancellation-fraction"] ?? env.LENS_RAG_LOAD_CANCELLATION_FRACTION ?? 0.1),
    cancelAfterMs: Number(args["cancel-after-ms"] ?? env.LENS_RAG_LOAD_CANCEL_AFTER_MS ?? 1_500),
    cancellationDurationMs: Number(args["cancellation-ms"] ?? env.LENS_RAG_LOAD_CANCELLATION_MS ?? 5 * 60 * 1000),
    faultObservationDurationMs: Number(args["fault-ms"] ?? env.LENS_RAG_LOAD_FAULT_MS ?? 5 * 60 * 1000),
    recoveryRatePerSec: Number(args["recovery-rate"] ?? env.LENS_RAG_LOAD_RECOVERY_RATE ?? 30),
    recoveryDurationMs: Number(args["recovery-ms"] ?? env.LENS_RAG_LOAD_RECOVERY_MS ?? 5 * 60 * 1000),
    requestDeadlineMs: Number(args["deadline-ms"] ?? env.LENS_RAG_LOAD_REQUEST_DEADLINE_MS ?? 30_000),
    maxLagMs: Number(args["max-lag-ms"] ?? env.LENS_RAG_LOAD_MAX_LAG_MS ?? 1_000),
    maxBacklogTokens: Number(args["max-backlog-tokens"] ?? env.LENS_RAG_LOAD_MAX_BACKLOG_TOKENS ?? 8),
    maxPacingDrops: Number(args["max-pacing-drops"] ?? env.LENS_RAG_LOAD_MAX_PACING_DROPS ?? 0),
    minHeadroomFraction: Number(args["min-headroom-fraction"] ?? env.LENS_RAG_LOAD_MIN_HEADROOM_FRACTION ?? 0.02),
    minAchievedRateFraction: Number(args["min-achieved-rate-fraction"] ?? env.LENS_RAG_LOAD_MIN_ACHIEVED_RATE_FRACTION ?? 0.98),
    candidateLimit: args["candidate-limit"] === undefined ? undefined : Number(args["candidate-limit"]),
    outputPath: args.output ?? env.LENS_RAG_LOAD_OUTPUT_PATH,
    environmentDigest: args["environment-digest"] ?? env.LENS_RAG_LOAD_ENVIRONMENT_DIGEST,
    modelDigest: args["model-digest"] ?? env.LENS_RAG_LOAD_MODEL_DIGEST,
    corpusDigest: args["corpus-digest"] ?? env.LENS_RAG_LOAD_CORPUS_DIGEST,
    indexDigest: args["index-digest"] ?? env.LENS_RAG_LOAD_INDEX_DIGEST,
    artifactDigest: args["artifact-digest"] ?? env.LENS_RAG_LOAD_ARTIFACT_DIGEST,
    allowLoopbackForTests: args["allow-loopback-for-tests"] === true,
    productionMode: env.NODE_ENV === "production" || args["allow-loopback-for-tests"] !== true,
  };
}

export function printUsage() {
  return [
    "Usage: node scripts/readiness/production-rag-load.mjs --endpoint https://orchestrator.platform.internal/v1/chat --ca-file <path> --cert-file <path> --key-file <path> [options]",
    "",
    "Required:",
    "  --endpoint                  Internal HTTPS endpoint ending in /v1/chat or /v1/retrieve",
    "  --ca-file                   CA bundle file path",
    "  --cert-file                 Client certificate file path",
    "  --key-file                  Client private key file path",
    "",
    "Optional:",
    "  --mode chat|retrieve        Target mode (default: chat)",
    "  --workload-token-file       File containing the internal workload token required by the Orchestrator and Retrieval harness paths",
    "  --fixture                   Approved local synthetic prompt fixture file",
    "  --target-rate               Target request starts per second (default: 43)",
    "  --connected-sessions        Connected session class metadata (default: 100)",
    "  --max-inflight              Hard maximum in-flight requests (default: 100)",
    "  --sustained-ms              Sustained phase duration in milliseconds (default: 1800000)",
    "  --burst-multiplier          Short burst multiplier (default: 1.25)",
    "  --burst-ms                  Burst phase duration in milliseconds (default: 300000)",
    "  --cancellation-fraction     Fraction of cancellation-phase requests to cancel (default: 0.1)",
    "  --cancel-after-ms           Cancellation delay during the cancellation phase (default: 1500)",
    "  --cancellation-ms           Cancellation phase duration in milliseconds (default: 300000)",
    "  --fault-ms                  Dependency-loss observation duration in milliseconds (default: 300000)",
    "  --recovery-rate             Recovery-surge rate per second (default: 30)",
    "  --recovery-ms               Recovery-surge duration in milliseconds (default: 300000)",
    "  --candidate-limit           Retrieval candidate limit (100, 500, or 1000)",
    "  --output                    Optional output path for the JSON evidence",
    "  --environment-digest        Immutable sha256 environment digest supplied by the operator",
    "  --model-digest              Immutable sha256 model digest supplied by the operator",
    "  --corpus-digest             Immutable sha256 corpus digest supplied by the operator",
    "  --index-digest              Immutable sha256 index/publication digest supplied by the operator",
    "  --artifact-digest           Immutable sha256 release artifact digest supplied by the operator",
    "",
    "The harness never accepts token contents on the command line. Supply only file paths for mTLS material and workload tokens.",
  ].join("\n");
}

export async function runFromCli(argv = process.argv.slice(2), env = process.env) {
  const config = parseCli(argv, env);
  if (config.help) return { help: true };
  return runProductionRagLoad(config);
}
