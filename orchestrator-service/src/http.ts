import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

const MAX_BODY_BYTES = 32 * 1024;
const MAX_INPUT_CHARS = 12_000;

export interface OrchestratorChatRequest {
  requestId: string;
  turnId: string;
  subjectRef: string;
  sessionRef: string;
  deviceRef: string;
  applicationId: "lens-employee-client";
  purposeRef: string;
  retrievalClass: "enterprise-grounded";
  capability: string;
  inputText: string;
  queryDigest: `sha256:${string}`;
  deadlineAt: number;
  retryBudget: 0 | 1;
  bulkhead: "interactive" | "management";
}

export interface OrchestratorChatResponse {
  status: "COMPLETED" | "CANCELLED" | "DENIED" | "FAILED";
  requestId: string;
  turnId?: string;
  output?: string;
  citations?: readonly { source: string; section: string }[];
  outputDigest?: `sha256:${string}`;
  error?: string;
}

export interface OrchestratorHttpOptions {
  workloadToken: string;
  handleChat: (request: OrchestratorChatRequest, signal: AbortSignal) => Promise<OrchestratorChatResponse>;
  maxActiveRequests?: number;
  maxBodyBytes?: number;
  maxHeaderBytes?: number;
  drainTimeoutMs?: number;
  now?: () => number;
}

export interface OrchestratorHttp {
  server: Server;
  listen(port: number, host: string): Promise<void>;
  close(): Promise<void>;
  activeRequests(): number;
  setReadiness(value: boolean): void;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function boundedRef(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && /^[\x20-\x7e]+$/.test(value);
}

function headerBytes(req: IncomingMessage): number {
  return Object.entries(req.headers).reduce((total, [key, value]) => total + key.length + String(value).length, 0);
}

function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        chunks.length = 0;
        reject(new Error("PAYLOAD_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });
    req.on("error", reject);
  });
}

function respond(res: ServerResponse, status: number, payload: Record<string, unknown>, draining: boolean): void {
  if (res.destroyed || res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    connection: draining ? "close" : "keep-alive",
  });
  res.end(body);
}

function parseChatRequest(payload: unknown, now: number): OrchestratorChatRequest {
  const record = payload as Record<string, unknown>;
  if (!record || typeof record !== "object") throw new Error("INVALID_REQUEST");
  for (const forbidden of ["role", "clearance", "policy_decision", "model_endpoint", "authorization_manifest"]) {
    if (record[forbidden] !== undefined) throw new Error("INVALID_REQUEST");
  }
  if (
    !boundedRef(record.request_id, 128) ||
    !boundedRef(record.turn_id, 128) ||
    !boundedRef(record.subject_ref, 512) ||
    !boundedRef(record.session_ref, 512) ||
    !boundedRef(record.device_ref, 512) ||
    record.application_id !== "lens-employee-client" ||
    record.retrieval_class !== "enterprise-grounded" ||
    !boundedRef(record.purpose_ref, 128) ||
    !boundedRef(record.capability, 128) ||
    typeof record.input_text !== "string" ||
    record.input_text.trim().length === 0 ||
    record.input_text.length > MAX_INPUT_CHARS ||
    typeof record.query_digest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(record.query_digest) ||
    typeof record.deadline_at !== "number" ||
    record.deadline_at <= now ||
    record.deadline_at > now + 65_000 ||
    (record.retry_budget !== 0 && record.retry_budget !== 1) ||
    (record.bulkhead !== "interactive" && record.bulkhead !== "management")
  ) {
    throw new Error("INVALID_REQUEST");
  }
  const inputDigest = `sha256:${createHash("sha256").update(record.input_text).digest("hex")}`;
  if (!safeEqual(inputDigest, record.query_digest)) throw new Error("INVALID_REQUEST");
  return {
    requestId: record.request_id,
    turnId: record.turn_id,
    subjectRef: record.subject_ref,
    sessionRef: record.session_ref,
    deviceRef: record.device_ref,
    applicationId: "lens-employee-client",
    purposeRef: record.purpose_ref,
    retrievalClass: "enterprise-grounded",
    capability: record.capability,
    inputText: record.input_text,
    queryDigest: record.query_digest as `sha256:${string}`,
    deadlineAt: record.deadline_at,
    retryBudget: record.retry_budget,
    bulkhead: record.bulkhead,
  };
}

export function createOrchestratorHttp(options: OrchestratorHttpOptions): OrchestratorHttp {
  const {
    workloadToken,
    handleChat,
    maxActiveRequests = 32,
    maxBodyBytes = MAX_BODY_BYTES,
    maxHeaderBytes = 8 * 1024,
    drainTimeoutMs = 15_000,
    now = () => Date.now(),
  } = options;
  if (workloadToken.length < 32) throw new Error("workloadToken must contain at least 32 characters.");
  if (maxActiveRequests < 1) throw new Error("maxActiveRequests must be at least 1.");

  let active = 0;
  let ready = true;
  let draining = false;
  let drainFinish: (() => void) | undefined;

  const server = createServer({ maxHeaderSize: maxHeaderBytes, headersTimeout: 10_000, requestTimeout: 70_000 }, (req, res) => {
    if (headerBytes(req) > maxHeaderBytes) {
      respond(res, 431, { error: "HEADER_TOO_LARGE" }, draining);
      return;
    }
    if (req.method === "GET" && req.url === "/livez") {
      respond(res, 200, { ok: true }, draining);
      return;
    }
    if (req.method === "GET" && req.url === "/readyz") {
      respond(res, ready ? 200 : 503, { ok: ready }, draining);
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/chat") {
      respond(res, 404, { error: "NOT_FOUND" }, draining);
      return;
    }
    const token = req.headers["x-lens-orchestrator-token"];
    if (typeof token !== "string" || !safeEqual(token, workloadToken)) {
      respond(res, 401, { error: "UNAUTHENTICATED" }, draining);
      return;
    }
    if (draining || !ready) {
      respond(res, 503, { error: "DRAINING" }, draining);
      return;
    }
    if (active >= maxActiveRequests) {
      respond(res, 429, { error: "OVERLOADED", retryable: true }, draining);
      return;
    }
    if (req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      respond(res, 415, { error: "UNSUPPORTED_MEDIA_TYPE" }, draining);
      return;
    }
    const declaredLength = Number(req.headers["content-length"] ?? "0");
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > maxBodyBytes) {
      respond(res, 413, { error: "PAYLOAD_TOO_LARGE" }, draining);
      return;
    }

    active += 1;
    const controller = new AbortController();
    res.once("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    void readJsonBody(req, maxBodyBytes)
      .then((payload) => handleChat(parseChatRequest(payload, now()), controller.signal))
      .then((result) => {
        const status = result.status === "COMPLETED" ? 200 : result.status === "DENIED" ? 403 : result.status === "CANCELLED" ? 499 : 503;
        respond(res, status, result as unknown as Record<string, unknown>, draining);
      })
      .catch((error: Error) => {
        if (error.message === "PAYLOAD_TOO_LARGE") respond(res, 413, { error: "PAYLOAD_TOO_LARGE" }, draining);
        else if (error.message === "INVALID_JSON" || error.message === "INVALID_REQUEST") respond(res, 400, { error: "INVALID_ARGUMENT" }, draining);
        else respond(res, 503, { error: "DEPENDENCY_UNAVAILABLE", retryable: true }, draining);
      })
      .finally(() => {
        active -= 1;
        if (draining && active === 0 && drainFinish) drainFinish();
      });
  });

  return {
    server,
    listen: (port, host) => new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => resolve());
    }),
    close: () => new Promise<void>((resolve) => {
      draining = true;
      const force = setTimeout(() => {
        server.closeAllConnections();
        server.close(() => resolve());
      }, drainTimeoutMs);
      drainFinish = () => {
        clearTimeout(force);
        server.close(() => resolve());
      };
      if (active === 0) drainFinish();
    }),
    activeRequests: () => active,
    setReadiness: (value) => {
      ready = value;
    },
  };
}
