import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { RetrievalService, RetrievalServiceError } from "../../services/retrieval/RetrievalService";
import type { RetrievalRequest } from "../../libs/rag-contracts";

export const MAX_QUERY_TEXT_CHARS = 8_192;
export const MAX_QUERY_TEXT_UTF8_BYTES = 32 * 1024;
export const MAX_RETRIEVAL_REQUEST_BODY_BYTES = 48 * 1024;

export interface RetrievalHttpOptions {
  service: RetrievalService;
  workloadToken: string;
  now?: () => number;
  maxBodyBytes?: number;
  maxHeaderBytes?: number;
  maxActiveRequests?: number;
  drainTimeoutMs?: number;
  readiness?: () => boolean;
}

export interface RetrievalHttp {
  server: Server;
  listen(port: number, host: string): Promise<void>;
  close(): Promise<void>;
  setReadiness(value: boolean): void;
  activeRequests(): number;
}

interface WorkloadIdentity {
  workloadRef: string;
  attested: boolean;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        req.pause();
        reject(new Error("PAYLOAD_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function unicodeCharLength(value: string): number {
  return Array.from(value).length;
}

/**
 * Production Retrieval HTTP ingress: an Orchestrator-only, workload-identity
 * authenticated, resource-bounded server with separate liveness/readiness
 * probes and graceful drain. The shared token is a recorded ADR deviation
 * (workload identity + mTLS is the required production transport).
 */
export function createRetrievalHttp(options: RetrievalHttpOptions): RetrievalHttp {
  const {
    service,
    workloadToken,
    now = () => Date.now(),
    maxBodyBytes = MAX_RETRIEVAL_REQUEST_BODY_BYTES,
    maxHeaderBytes = 8 * 1024,
    maxActiveRequests = 16,
    drainTimeoutMs = 15_000,
  } = options;

  if (workloadToken.length < 32) throw new Error("workloadToken must contain at least 32 characters.");
  if (maxBodyBytes > 64 * 1024) throw new Error("maxBodyBytes must not exceed 64 KiB.");
  if (maxActiveRequests < 1) throw new Error("maxActiveRequests must be at least 1.");

  let ready = options.readiness ? options.readiness() : true;
  let draining = false;
  let active = 0;
  let drainFinish: (() => void) | null = null;

  const auth = (req: IncomingMessage): WorkloadIdentity => {
    const supplied = req.headers["x-lens-orchestrator-token"];
    const workloadRef = req.headers["x-lens-caller-workload"];
    if (typeof supplied !== "string" || typeof workloadRef !== "string") return { workloadRef: "", attested: false };
    const attested = workloadRef === "ai-orchestrator" && safeEqual(supplied, workloadToken);
    return { workloadRef, attested };
  };

  const headerBytes = (req: IncomingMessage): number =>
    Object.entries(req.headers).reduce((total, [key, value]) => total + key.length + String(value).length, 0);

  const respond = (res: ServerResponse, status: number, payload: Record<string, unknown>): void => {
    if (res.destroyed || res.writableEnded) return;
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
      connection: draining ? "close" : "keep-alive",
    });
    res.end(body);
  };

  const server = createServer((req, res) => {
    if (headerBytes(req) > maxHeaderBytes) {
      respond(res, 431, { error: "HEADER_TOO_LARGE" });
      return;
    }

    // Probes are unauthenticated and always answered so the platform can
    // observe the replica independently of the workload-token contract.
    if (req.method === "GET" && req.url === "/livez") {
      respond(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && req.url === "/readyz") {
      respond(res, ready ? 200 : 503, ready ? { ok: true } : { ok: false });
      return;
    }

    if (draining) {
      respond(res, 503, { error: "DRAINING" });
      return;
    }
    const identity = auth(req);
    if (!identity.attested) {
      respond(res, 401, { error: "UNAUTHENTICATED" });
      return;
    }
    if (active >= maxActiveRequests) {
      respond(res, 429, { error: "OVERLOADED", retryable: true });
      return;
    }

    const controller = new AbortController();
    res.once("close", () => {
      if (!res.writableEnded) controller.abort();
    });

    if (req.method !== "POST" || req.url !== "/v1/retrieve") {
      respond(res, 404, { error: "NOT_FOUND" });
      return;
    }

    active += 1;
    const deadline = now() + 30_000;
    void readJsonBody(req, maxBodyBytes)
      .then(async (payload) => {
        const request = parseRetrievalRequest(payload);
        request.deadline_at = Math.min(request.deadline_at || deadline, deadline);
        const result = await service.retrieve(request, controller.signal);
        respond(res, 200, result);
      })
      .catch((error: Error) => {
        if (error.message === "PAYLOAD_TOO_LARGE") {
          respond(res, 413, { error: "PAYLOAD_TOO_LARGE" });
        } else if (error.message === "INVALID_JSON" || error.message === "INVALID_REQUEST") {
          respond(res, 400, { error: "INVALID_ARGUMENT" });
        } else if (error instanceof RetrievalServiceError && error.code === "OVERLOADED") {
          respond(res, 503, { error: "OVERLOADED", retryable: true });
        } else if (error instanceof RetrievalServiceError && error.code === "RATE_LIMITED") {
          respond(res, 429, { error: "RATE_LIMITED", retryable: true });
        } else if (error instanceof RetrievalServiceError && error.code === "UNAUTHENTICATED") {
          respond(res, 401, { error: "UNAUTHENTICATED" });
        } else {
          respond(res, 503, { error: "DEPENDENCY_UNAVAILABLE", retryable: true });
        }
      })
      .finally(() => {
        active -= 1;
        if (draining && active === 0 && drainFinish) drainFinish();
      });
  });

  return {
    server,
    listen: (port: number, host: string) =>
      new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve());
      }),
    close: () =>
      new Promise<void>((resolve) => {
        draining = true;
        const force = setTimeout(() => {
          server.closeAllConnections();
          server.close(() => resolve());
        }, drainTimeoutMs);
        drainFinish = () => {
          if (drainFinish === null) return;
          drainFinish = null;
          clearTimeout(force);
          server.close(() => resolve());
        };
        if (active === 0) drainFinish();
      }),
    setReadiness: (value: boolean) => {
      ready = value;
    },
    activeRequests: () => active,
  };
}

function parseRetrievalRequest(payload: unknown): RetrievalRequest {
  const record = payload as Record<string, unknown>;
  const required: Array<keyof RetrievalRequest> = [
    "request_id",
    "turn_id",
    "caller_workload_ref",
    "subject_ref",
    "session_ref",
    "device_ref",
    "application_id",
    "query_digest",
    "query_text",
    "purpose_ref",
    "retrieval_class",
    "corpus_ref",
    "mode",
    "profile_version",
    "profile_digest",
    "candidate_limit",
    "deadline_at",
    "cancellation",
    "bulkhead",
    "visibility_minimum",
  ];
  if (!record || typeof record !== "object") throw new Error("INVALID_REQUEST");
  for (const key of required) {
    if (record[key] === undefined) throw new Error("INVALID_REQUEST");
  }
  if (record.caller_workload_ref !== "ai-orchestrator") throw new Error("INVALID_REQUEST");
  if (record.application_id !== "lens-employee-client") throw new Error("INVALID_REQUEST");
  if (typeof record.query_digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record.query_digest)) throw new Error("INVALID_REQUEST");
  if (typeof record.profile_version !== "number" || !Number.isSafeInteger(record.profile_version) || record.profile_version < 1) throw new Error("INVALID_REQUEST");
  if (typeof record.profile_digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record.profile_digest)) throw new Error("INVALID_REQUEST");
  if (
    typeof record.query_text !== "string" ||
    unicodeCharLength(record.query_text) < 1 ||
    unicodeCharLength(record.query_text) > MAX_QUERY_TEXT_CHARS ||
    Buffer.byteLength(record.query_text, "utf8") > MAX_QUERY_TEXT_UTF8_BYTES ||
    sha256(record.query_text) !== record.query_digest
  ) throw new Error("INVALID_REQUEST");
  if (typeof record.candidate_limit !== "number" || record.candidate_limit < 1 || record.candidate_limit > 1_000) throw new Error("INVALID_REQUEST");
  if (typeof record.deadline_at !== "number" || record.deadline_at <= 0) throw new Error("INVALID_REQUEST");
  const mode = record.mode;
  if (!["lexical", "semantic", "graph", "hybrid", "structured", "citation_refresh"].includes(String(mode))) throw new Error("INVALID_REQUEST");
  const bulkhead = record.bulkhead;
  if (bulkhead !== "interactive" && bulkhead !== "management") throw new Error("INVALID_REQUEST");
  return {
    request_id: String(record.request_id),
    turn_id: String(record.turn_id),
    caller_workload_ref: "ai-orchestrator",
    subject_ref: String(record.subject_ref),
    session_ref: String(record.session_ref),
    device_ref: String(record.device_ref),
    application_id: "lens-employee-client",
    query_digest: record.query_digest as `sha256:${string}`,
    query_text: record.query_text as string,
    purpose_ref: String(record.purpose_ref),
    retrieval_class: "enterprise-grounded",
    corpus_ref: String(record.corpus_ref),
    mode: mode as RetrievalRequest["mode"],
    profile_version: record.profile_version as number,
    profile_digest: record.profile_digest as `sha256:${string}`,
    candidate_limit: record.candidate_limit as number,
    deadline_at: record.deadline_at as number,
    cancellation: Boolean(record.cancellation),
    bulkhead: bulkhead as "interactive" | "management",
    visibility_minimum: Number(record.visibility_minimum ?? 0),
  };
}
