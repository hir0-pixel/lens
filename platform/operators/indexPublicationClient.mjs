import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024;
const MAX_MATERIAL_BYTES = 64 * 1024;
const MAX_TOKEN_BYTES = 8 * 1024;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_DIGEST = /^sha256:[a-f0-9]{64}$/;
const SAFE_IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SAFE_TICKET = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const SAFE_AUDIT_REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/;
const DATASTORE_HOST = /(?:^|[-.])(qdrant|vespa|opensearch|elasticsearch)(?:[-.]|$)/i;
const SAFE_SIGNATURE = /^[A-Za-z0-9+/=_.:-]{16,8192}$/;

export class IndexPublicationClientError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function assertPositiveInteger(name, value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new IndexPublicationClientError("INVALID_ARGUMENT", `${name} must be a positive integer.`);
  }
}

function textBytes(value) {
  return new TextEncoder().encode(value).byteLength;
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
  return hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:");
}

function validateEndpoint(endpoint, allowLoopbackForTests, productionMode) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new IndexPublicationClientError("INVALID_CONFIG", "Publication authority endpoint is invalid.");
  }
  if (url.username || url.password || url.hash || url.search || (url.pathname !== "" && url.pathname !== "/")) {
    throw new IndexPublicationClientError("INVALID_CONFIG", "Publication authority endpoint must be an origin-only URL.");
  }
  const hostname = normalizeHostname(url.hostname);
  if (DATASTORE_HOST.test(hostname)) {
    throw new IndexPublicationClientError("INVALID_CONFIG", "Publication authority endpoint must not target a datastore or search engine host.");
  }
  const ipVersion = isIP(hostname);
  const loopback = isLoopback(hostname);
  const testLoopback = !productionMode && allowLoopbackForTests === true && loopback && url.protocol === "http:";
  if (loopback && !testLoopback) {
    throw new IndexPublicationClientError("INVALID_CONFIG", "Loopback publication authority endpoints are test-only.");
  }
  if (url.protocol !== "https:" && !testLoopback) {
    throw new IndexPublicationClientError("INVALID_CONFIG", "Publication authority endpoint must use internal HTTPS.");
  }
  const internalHost = hostname.endsWith(".internal")
    || (ipVersion === 4 && isPrivateIpv4(hostname))
    || (ipVersion === 6 && isPrivateIpv6(hostname));
  if (!internalHost && !testLoopback) {
    throw new IndexPublicationClientError("INVALID_CONFIG", "Publication authority endpoint must resolve to a private IP or .internal hostname.");
  }
  return new URL(url.origin);
}

function readBoundedFile(path, label, maxBytes, encoding) {
  if (!path) throw new IndexPublicationClientError("INVALID_CONFIG", `${label} path is required.`);
  let stats;
  try {
    stats = statSync(path);
  } catch {
    throw new IndexPublicationClientError("INVALID_CONFIG", `${label} file is unreadable.`);
  }
  if (!stats.isFile() || stats.size < 1 || stats.size > maxBytes) {
    throw new IndexPublicationClientError("INVALID_CONFIG", `${label} file must be a readable non-empty file under ${maxBytes} bytes.`);
  }
  return readFileSync(path, encoding);
}

function readTlsMaterial(options) {
  return {
    ca: readBoundedFile(options.caFile, "CA", MAX_MATERIAL_BYTES),
    cert: readBoundedFile(options.certFile, "Client certificate", MAX_MATERIAL_BYTES),
    key: readBoundedFile(options.keyFile, "Client key", MAX_MATERIAL_BYTES),
  };
}

function readOptionalTokenFile(path) {
  if (!path) return undefined;
  const token = readBoundedFile(path, "Workload token", MAX_TOKEN_BYTES, "utf8").trim();
  if (textBytes(token) < 32 || !SAFE_AUDIT_REF.test(token)) {
    throw new IndexPublicationClientError("INVALID_CONFIG", "Workload token file must contain at least 32 bytes of bounded token material.");
  }
  return token;
}

function requireRef(name, value) {
  if (typeof value !== "string" || !SAFE_REF.test(value)) {
    throw new IndexPublicationClientError("INVALID_ARGUMENT", `${name} is required and must use the bounded reference format.`);
  }
  return value;
}

function requireDigest(name, value) {
  if (typeof value !== "string" || !SAFE_DIGEST.test(value)) {
    throw new IndexPublicationClientError("INVALID_ARGUMENT", `${name} must be an exact sha256 digest.`);
  }
  return value;
}

function requireReason(name, value) {
  if (typeof value !== "string" || value.trim().length < 3 || value.length > 256 || /[\r\n\t]/.test(value)) {
    throw new IndexPublicationClientError("INVALID_ARGUMENT", `${name} must be a bounded single-line explanation.`);
  }
  return value.trim();
}

function requireAuditReceipt(value) {
  if (typeof value !== "string" || !SAFE_AUDIT_REF.test(value)) {
    throw new IndexPublicationClientError("INVALID_ARGUMENT", "auditReceipt is required.");
  }
  return value;
}

function requireIdempotencyKey(value) {
  if (typeof value !== "string" || !SAFE_IDEMPOTENCY_KEY.test(value)) {
    throw new IndexPublicationClientError("INVALID_ARGUMENT", "idempotencyKey is required and must be bounded.");
  }
  return value;
}

function requireChangeReference(value) {
  if (typeof value !== "string" || !SAFE_TICKET.test(value)) {
    throw new IndexPublicationClientError("INVALID_ARGUMENT", "changeReference is required and must be bounded.");
  }
  return value;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computePublicationChangeDigest(operation, plannedPayload) {
  const normalized = canonicalJson({ operation, ...plannedPayload });
  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

function readField(record, ...keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  }
  return undefined;
}

function requireFenceString(record, keys, name, pattern = SAFE_TICKET) {
  const value = readField(record, ...keys);
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new IndexPublicationClientError("INVALID_ARGUMENT", `${name} in the privileged change fence is invalid.`);
  }
  return value;
}

function requireFenceInteger(record, keys, name) {
  const value = readField(record, ...keys);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new IndexPublicationClientError("INVALID_ARGUMENT", `${name} in the privileged change fence is invalid.`);
  }
  return value;
}

function requireFenceTarget(target, expectedTarget) {
  const record = asRecord(target, "Privileged change fence target must be an object.");
  if (requireRef("fence target corpus", readField(record, "corpusRef", "corpus_ref")) !== expectedTarget.corpusRef) {
    throw new IndexPublicationClientError("INVALID_ARGUMENT", "Privileged change fence target does not match the requested corpus.");
  }
  if (expectedTarget.targetGenerationRef) {
    if (requireRef("fence target generation", readField(record, "targetGenerationRef", "target_generation_ref")) !== expectedTarget.targetGenerationRef) {
      throw new IndexPublicationClientError("INVALID_ARGUMENT", "Privileged change fence target does not match the requested target generation.");
    }
  }
  if (expectedTarget.expectedActiveGenerationRef) {
    if (requireRef("fence expected active generation", readField(record, "expectedActiveGenerationRef", "expected_active_generation_ref")) !== expectedTarget.expectedActiveGenerationRef) {
      throw new IndexPublicationClientError("INVALID_ARGUMENT", "Privileged change fence target does not match the expected active generation.");
    }
  }
  return record;
}

export function loadPrivilegedChangeFence(path, { now = Date.now(), operation, plannedPayload, expectedTarget } = {}) {
  const raw = readBoundedFile(path, "Privileged change fence", 8 * 1024, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new IndexPublicationClientError("INVALID_ARGUMENT", "Privileged change fence file must contain valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new IndexPublicationClientError("INVALID_ARGUMENT", "Privileged change fence file must contain an object.");
  }
  const fenceId = requireRef("fenceId", readField(parsed, "fenceId", "fence_id"));
  const fenceOperation = requireFenceString(parsed, ["operation"], "operation");
  const ticketRef = requireFenceString(parsed, ["ticketRef", "ticket_ref"], "ticketRef");
  const purposeRef = requireFenceString(parsed, ["purposeRef", "purpose_ref"], "purposeRef");
  const issuedAt = requireFenceInteger(parsed, ["issuedAt", "issued_at"], "issuedAt");
  const expiresAt = requireFenceInteger(parsed, ["expiresAt", "expires_at"], "expiresAt");
  const nonce = requireFenceString(parsed, ["nonce"], "nonce");
  const signature = requireFenceString(parsed, ["signature"], "signature", SAFE_SIGNATURE);
  const canonicalPayloadDigest = requireDigest("canonicalPayloadDigest", readField(parsed, "canonicalPayloadDigest", "canonical_payload_digest"));
  if (expiresAt <= now || issuedAt > now || expiresAt <= issuedAt) {
    throw new IndexPublicationClientError("INVALID_ARGUMENT", "Privileged change fence is expired or invalid.");
  }
  if (operation && fenceOperation !== operation) {
    throw new IndexPublicationClientError("INVALID_ARGUMENT", "Privileged change fence operation does not match the requested command.");
  }
  if (expectedTarget) {
    requireFenceTarget(readField(parsed, "target"), expectedTarget);
  }
  if (plannedPayload) {
    const localDigest = computePublicationChangeDigest(operation, plannedPayload);
    if (canonicalPayloadDigest !== localDigest) {
      throw new IndexPublicationClientError("INVALID_ARGUMENT", "Privileged change fence canonical payload digest does not match the planned publication payload.");
    }
  }
  void ticketRef;
  void purposeRef;
  void nonce;
  void signature;
  void fenceId;
  return parsed;
}

function boundedBodyText(response, maxBytes) {
  const text = typeof response.bodyText === "string" ? response.bodyText : "";
  if (textBytes(text) > maxBytes) {
    throw new IndexPublicationClientError("INVALID_RESPONSE", "Publication authority response exceeded the byte envelope.");
  }
  return text;
}

function asRecord(value, message = "Publication authority returned an invalid response.") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new IndexPublicationClientError("INVALID_RESPONSE", message);
  }
  return value;
}

function asOptionalRef(value) {
  if (value === undefined || value === null) return undefined;
  return requireRef("response reference", value);
}

function asOptionalDigest(value) {
  if (value === undefined || value === null) return undefined;
  return requireDigest("response digest", value);
}

function asOptionalInteger(value, name) {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new IndexPublicationClientError("INVALID_RESPONSE", `${name} in the publication response is invalid.`);
  }
  return value;
}

function asStatus(value) {
  if (typeof value !== "string" || value.length < 2 || value.length > 64) {
    throw new IndexPublicationClientError("INVALID_RESPONSE", "Publication authority returned an invalid status.");
  }
  return value;
}

function parseJsonResponse(response, maxBytes) {
  const contentType = String(response.headers?.["content-type"] ?? "");
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new IndexPublicationClientError("INVALID_RESPONSE", "Publication authority must return JSON.");
  }
  const text = boundedBodyText(response, maxBytes);
  try {
    return asRecord(JSON.parse(text));
  } catch {
    throw new IndexPublicationClientError("INVALID_RESPONSE", "Publication authority returned invalid JSON.");
  }
}

function conflictFromResponse(response) {
  if (response.status === 409 || response.status === 412) {
    throw new IndexPublicationClientError("CONFLICT", "Publication authority rejected a stale or conflicting update.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new IndexPublicationClientError("FORBIDDEN", "Publication authority rejected the operator identity or privileged change.");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new IndexPublicationClientError("UNAVAILABLE", `Publication authority failed with status ${response.status}.`);
  }
}

function buildPlannedPayload(command, payload) {
  const base = {
    corpus_ref: requireRef("corpusRef", payload.corpusRef),
    expected_visibility_sequence: payload.expectedVisibilitySequence,
    idempotency_key: requireIdempotencyKey(payload.idempotencyKey),
    reason: requireReason("reason", payload.reason),
    change_reference: requireChangeReference(payload.changeReference),
  };
  if (!Number.isSafeInteger(base.expected_visibility_sequence) || base.expected_visibility_sequence < 0) {
    throw new IndexPublicationClientError("INVALID_ARGUMENT", "expectedVisibilitySequence must be a safe integer.");
  }
  if (command === "activate") {
    return {
      ...base,
      target_generation_ref: requireRef("targetGenerationRef", payload.targetGenerationRef),
      source_revision_digest: requireDigest("sourceRevisionDigest", payload.sourceRevisionDigest),
      governance_revision_digest: requireDigest("governanceRevisionDigest", payload.governanceRevisionDigest),
      searchable_copy_evidence_ref: requireRef("searchableCopyEvidenceRef", payload.searchableCopyEvidenceRef),
    };
  }
  if (command === "rollback") {
    return {
      ...base,
      expected_active_generation_ref: requireRef("expectedActiveGenerationRef", payload.expectedActiveGenerationRef),
      target_generation_ref: requireRef("targetGenerationRef", payload.targetGenerationRef),
      source_revision_digest: requireDigest("sourceRevisionDigest", payload.sourceRevisionDigest),
      governance_revision_digest: requireDigest("governanceRevisionDigest", payload.governanceRevisionDigest),
      searchable_copy_evidence_ref: requireRef("searchableCopyEvidenceRef", payload.searchableCopyEvidenceRef),
    };
  }
  return {
    ...base,
    target_generation_ref: requireRef("targetGenerationRef", payload.targetGenerationRef),
    source_revision_digest: requireDigest("sourceRevisionDigest", payload.sourceRevisionDigest),
    governance_revision_digest: requireDigest("governanceRevisionDigest", payload.governanceRevisionDigest),
  };
}

function requireMutationEnvelope(command, payload) {
  const plannedPayload = buildPlannedPayload(command, payload);
  const expectedTarget = {
    corpusRef: plannedPayload.corpus_ref,
    targetGenerationRef: plannedPayload.target_generation_ref,
    expectedActiveGenerationRef: plannedPayload.expected_active_generation_ref,
  };
  const body = {
    ...plannedPayload,
    privileged_change_fence: loadPrivilegedChangeFence(payload.fenceFile, {
      now: payload.now,
      operation: command,
      plannedPayload,
      expectedTarget,
    }),
    deadline_at: payload.deadlineAt,
  };
  if (!Number.isSafeInteger(body.deadline_at) || body.deadline_at <= payload.now) {
    throw new IndexPublicationClientError("INVALID_ARGUMENT", `${command} deadline is invalid.`);
  }
  return body;
}

function sanitizeOutcome(outcome) {
  const sanitized = {
    operation: outcome.operation,
    corpus: outcome.corpusRef ?? outcome.corpus,
    status: outcome.status,
  };
  if (outcome.activeGenerationRef ?? outcome.active_generation_ref) sanitized.active_generation_ref = outcome.activeGenerationRef ?? outcome.active_generation_ref;
  if (outcome.targetGenerationRef ?? outcome.target_generation_ref) sanitized.target_generation_ref = outcome.targetGenerationRef ?? outcome.target_generation_ref;
  if (Number.isSafeInteger(outcome.previousVisibilitySequence ?? outcome.previous_visibility_sequence)) sanitized.previous_visibility_sequence = outcome.previousVisibilitySequence ?? outcome.previous_visibility_sequence;
  if (Number.isSafeInteger(outcome.visibilitySequence ?? outcome.visibility_sequence)) sanitized.visibility_sequence = outcome.visibilitySequence ?? outcome.visibility_sequence;
  if (outcome.sourceRevisionDigest ?? outcome.source_revision_digest) sanitized.source_revision_digest = outcome.sourceRevisionDigest ?? outcome.source_revision_digest;
  if (outcome.auditReceipt ?? outcome.audit_receipt) sanitized.audit_receipt = outcome.auditReceipt ?? outcome.audit_receipt;
  if (outcome.auditRef ?? outcome.audit_ref) sanitized.audit_ref = outcome.auditRef ?? outcome.audit_ref;
  return sanitized;
}

export { sanitizeOutcome as sanitizePublicationResult };

export function createNodeOperatorTransport() {
  return async function send(request) {
    const headers = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, String(value)]));
    const transport = request.url.protocol === "https:" ? https : http;
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
          req.destroy(new IndexPublicationClientError("INVALID_RESPONSE", "Publication authority response exceeded the byte envelope."));
          return;
        }
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > request.maxResponseBytes) {
            req.destroy(new IndexPublicationClientError("INVALID_RESPONSE", "Publication authority response exceeded the byte envelope."));
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
        if (error instanceof IndexPublicationClientError) {
          reject(error);
          return;
        }
        reject(new IndexPublicationClientError("UNAVAILABLE", "Publication authority is unavailable."));
      });
      req.write(request.body);
      req.end();
    });
  };
}

export class IndexPublicationClient {
  constructor(options) {
    assertPositiveInteger("deadlineMs", options.deadlineMs);
    this.productionMode = options.productionMode ?? process.env.NODE_ENV === "production";
    this.origin = validateEndpoint(options.endpoint, options.allowLoopbackForTests === true, this.productionMode);
    this.deadlineMs = options.deadlineMs;
    this.maxRequestBytes = Math.min(options.maxRequestBytes ?? MAX_REQUEST_BYTES, MAX_REQUEST_BYTES);
    this.maxResponseBytes = Math.min(options.maxResponseBytes ?? MAX_RESPONSE_BYTES, MAX_RESPONSE_BYTES);
    this.transport = options.transport ?? createNodeOperatorTransport();
    this.tls = readTlsMaterial(options);
    this.workloadToken = readOptionalTokenFile(options.tokenFile);
  }

  async status(input) {
    const deadlineAt = Date.now() + this.deadlineMs;
    return this.#request("status", "/v1/index-publication/status", {
      corpus_ref: requireRef("corpusRef", input.corpusRef),
      deadline_at: deadlineAt,
    }, false, input.signal);
  }

  async activate(input) {
    const now = Date.now();
    const deadlineAt = now + this.deadlineMs;
    const envelope = requireMutationEnvelope("activate", { ...input, deadlineAt, now });
    return this.#request("activate", "/v1/index-publication/activate", {
      ...envelope,
    }, true, input.signal);
  }

  async rollback(input) {
    const now = Date.now();
    const deadlineAt = now + this.deadlineMs;
    const envelope = requireMutationEnvelope("rollback", { ...input, deadlineAt, now });
    return this.#request("rollback", "/v1/index-publication/rollback", {
      ...envelope,
    }, true, input.signal);
  }

  async refeed(input) {
    const now = Date.now();
    const deadlineAt = now + this.deadlineMs;
    const envelope = requireMutationEnvelope("refeed", { ...input, deadlineAt, now });
    return this.#request("refeed", "/v1/index-publication/refeed", {
      ...envelope,
    }, true, input.signal);
  }

  async #request(operation, path, body, mutating, callerSignal) {
    const payload = JSON.stringify(body);
    if (textBytes(payload) > this.maxRequestBytes) {
      throw new IndexPublicationClientError("INVALID_ARGUMENT", "Publication authority request exceeded the byte envelope.");
    }
    const timeoutSignal = AbortSignal.timeout(this.deadlineMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
    let response;
    try {
      response = await this.transport({
        method: "POST",
        url: new URL(path, this.origin),
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(this.workloadToken ? { authorization: `Bearer ${this.workloadToken}` } : {}),
        },
        body: payload,
        signal,
        ca: this.tls.ca,
        cert: this.tls.cert,
        key: this.tls.key,
        maxResponseBytes: this.maxResponseBytes,
      });
    } catch (error) {
      if (error instanceof IndexPublicationClientError) throw error;
      if (timeoutSignal.aborted || signal.aborted) {
        throw new IndexPublicationClientError("UNAVAILABLE", "Publication authority deadline elapsed or request was cancelled.");
      }
      throw new IndexPublicationClientError("UNAVAILABLE", "Publication authority is unavailable.");
    }
    if (response.status >= 300 && response.status < 400) {
      throw new IndexPublicationClientError("INVALID_RESPONSE", "Publication authority refuses redirects.");
    }
    conflictFromResponse(response);
    const parsed = parseJsonResponse(response, this.maxResponseBytes);
    const status = asStatus(parsed.status);
    if (/(?:^|_)(?:stale|conflict)(?:_|$)/i.test(status)) {
      throw new IndexPublicationClientError("CONFLICT", "Publication authority reported a stale or conflicting update.");
    }
    const outcome = {
      operation,
      corpusRef: requireRef("corpus_ref", parsed.corpus_ref ?? body.corpus_ref),
      status,
      activeGenerationRef: asOptionalRef(parsed.active_generation_ref),
      targetGenerationRef: asOptionalRef(parsed.target_generation_ref),
      previousVisibilitySequence: asOptionalInteger(parsed.previous_visibility_sequence, "previous_visibility_sequence"),
      visibilitySequence: asOptionalInteger(parsed.visibility_sequence, "visibility_sequence"),
      sourceRevisionDigest: asOptionalDigest(parsed.source_revision_digest),
      auditReceipt: parsed.audit_receipt === undefined ? undefined : requireAuditReceipt(parsed.audit_receipt),
      auditRef: parsed.audit_ref === undefined ? undefined : requireAuditReceipt(parsed.audit_ref),
    };
    if (mutating && !outcome.auditReceipt) {
      throw new IndexPublicationClientError("INVALID_RESPONSE", "Mutating publication responses must include an Audit receipt.");
    }
    return sanitizeOutcome(outcome);
  }
}

export function createIndexPublicationClient(options) {
  return new IndexPublicationClient(options);
}
