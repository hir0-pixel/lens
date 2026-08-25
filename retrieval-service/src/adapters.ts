import { isIP } from "node:net";
import type {
  AuthorizedContentPort,
  PublicationPort,
  RetrievalAuditPort,
  RetrievalCandidate,
  RetrievalIndexPort,
  RetrievalPdpPort,
} from "../../services/retrieval/RetrievalService";

const MAX_REQUEST_BYTES = 48 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_TOKEN_LENGTH = 8 * 1024;
const INTERNAL_WORKLOAD = "retrieval-service";

type Fetcher = typeof fetch;

export class RetrievalDependencyClientError extends Error {
  constructor(readonly code: "INVALID_CONFIG" | "UNAVAILABLE" | "INVALID_RESPONSE", message: string) {
    super(message);
  }
}

export interface DependencyClientOptions {
  baseUrl: string;
  credential: string;
  allowLoopbackHttp?: boolean;
  fetcher?: Fetcher;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
}

export interface DependencyHealthPort {
  check(timeoutMs?: number): Promise<boolean>;
}

export interface RetrievalDependencyClients {
  pdp: RetrievalPdpPort;
  index: RetrievalIndexPort;
  content: AuthorizedContentPort;
  audit: RetrievalAuditPort;
  publication: PublicationPort;
  health: DependencyHealthPort;
}

export interface RetrievalDependencyClientConfig {
  pdp: DependencyClientOptions;
  index: DependencyClientOptions;
  content: DependencyClientOptions;
  audit: DependencyClientOptions;
  publication: DependencyClientOptions;
}

function validateCredential(name: string, credential: string): void {
  if (credential.length < 32 || credential.length > MAX_TOKEN_LENGTH) {
    throw new RetrievalDependencyClientError("INVALID_CONFIG", `${name} credential must contain 32 to 8192 characters.`);
  }
}

function isInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".internal")) return true;
  if (isIP(host) === 4) {
    const parts = host.split(".").map(Number);
    return parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
  }
  if (isIP(host) === 6) return host.startsWith("fc") || host.startsWith("fd");
  return false;
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function validateBaseUrl(name: string, value: string, allowLoopbackHttp = false): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new RetrievalDependencyClientError("INVALID_CONFIG", `${name} URL is invalid.`);
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || (endpoint.pathname !== "" && endpoint.pathname !== "/")) {
    throw new RetrievalDependencyClientError("INVALID_CONFIG", `${name} URL must be an origin-only internal endpoint.`);
  }
  if (endpoint.protocol === "https:" && isInternalHost(endpoint.hostname)) return endpoint;
  if (allowLoopbackHttp && endpoint.protocol === "http:" && isLoopback(endpoint.hostname)) return endpoint;
  throw new RetrievalDependencyClientError("INVALID_CONFIG", `${name} URL must be HTTPS on an internal hostname, or explicit test loopback HTTP.`);
}

function joinEndpoint(base: URL, path: string): URL {
  return new URL(path, base);
}

function deadlineSignal(deadlineAt: number, callerSignal: AbortSignal): AbortSignal {
  if (callerSignal.aborted) throw new RetrievalDependencyClientError("UNAVAILABLE", "Dependency call cancelled.");
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) throw new RetrievalDependencyClientError("UNAVAILABLE", "Dependency deadline elapsed.");
  return AbortSignal.any([callerSignal, AbortSignal.timeout(remainingMs)]);
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RetrievalDependencyClientError("INVALID_RESPONSE", "Dependency response exceeded byte envelope.");
  }
  if (!response.body) throw new RetrievalDependencyClientError("INVALID_RESPONSE", "Dependency returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new RetrievalDependencyClientError("INVALID_RESPONSE", "Dependency response exceeded byte envelope.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"));
  } catch {
    throw new RetrievalDependencyClientError("INVALID_RESPONSE", "Dependency returned invalid JSON.");
  }
}

class JsonDependencyClient {
  private readonly baseUrl: URL;
  private readonly credential: string;
  private readonly fetcher: Fetcher;
  private readonly maxRequestBytes: number;
  private readonly maxResponseBytes: number;

  constructor(name: string, options: DependencyClientOptions) {
    this.baseUrl = validateBaseUrl(name, options.baseUrl, options.allowLoopbackHttp);
    validateCredential(name, options.credential);
    this.credential = options.credential;
    this.fetcher = options.fetcher ?? fetch;
    this.maxRequestBytes = options.maxRequestBytes ?? MAX_REQUEST_BYTES;
    this.maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
    if (this.maxRequestBytes > 64 * 1024) throw new RetrievalDependencyClientError("INVALID_CONFIG", `${name} request envelope exceeds 64 KiB.`);
    if (this.maxResponseBytes > 1024 * 1024) throw new RetrievalDependencyClientError("INVALID_CONFIG", `${name} response envelope exceeds 1 MiB.`);
  }

  async post(path: string, body: Record<string, unknown>, deadlineAt: number, signal: AbortSignal): Promise<unknown> {
    const payload = JSON.stringify(body);
    if (Buffer.byteLength(payload, "utf8") > this.maxRequestBytes) {
      throw new RetrievalDependencyClientError("UNAVAILABLE", "Dependency request exceeded byte envelope.");
    }
    let response: Response;
    try {
      response = await this.fetcher(joinEndpoint(this.baseUrl, path), {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.credential}`,
          "content-type": "application/json",
          "x-lens-caller-workload": INTERNAL_WORKLOAD,
        },
        body: payload,
        redirect: "error",
        signal: deadlineSignal(deadlineAt, signal),
      });
    } catch {
      throw new RetrievalDependencyClientError("UNAVAILABLE", "Dependency is unavailable.");
    }
    if (!response.ok) throw new RetrievalDependencyClientError("UNAVAILABLE", "Dependency returned non-success.");
    return readBoundedJson(response, this.maxResponseBytes);
  }

  async livez(timeoutMs: number): Promise<boolean> {
    try {
      const response = await this.fetcher(joinEndpoint(this.baseUrl, "/livez"), {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RetrievalDependencyClientError("INVALID_RESPONSE", "Dependency returned invalid shape.");
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new RetrievalDependencyClientError("INVALID_RESPONSE", "Dependency returned invalid shape.");
  return value;
}

function asSha256(value: unknown): `sha256:${string}` {
  const text = asString(value);
  if (!/^sha256:[a-f0-9]{64}$/.test(text)) throw new RetrievalDependencyClientError("INVALID_RESPONSE", "Dependency returned invalid shape.");
  return text as `sha256:${string}`;
}

function asSafeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new RetrievalDependencyClientError("INVALID_RESPONSE", "Dependency returned invalid shape.");
  return value;
}

function stringArray(value: unknown, max: number): readonly string[] {
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new RetrievalDependencyClientError("INVALID_RESPONSE", "Dependency returned invalid shape.");
  }
  return value;
}

function parseCandidates(value: unknown, laneLimit: number): readonly RetrievalCandidate[] {
  if (!Array.isArray(value) || value.length > laneLimit) {
    throw new RetrievalDependencyClientError("INVALID_RESPONSE", "Search returned invalid candidate envelope.");
  }
  return value.map((candidate) => {
    const record = asRecord(candidate);
    const lane = record.lane;
    if (lane !== "lexical" && lane !== "vector" && lane !== "graph" && lane !== "metadata") {
      throw new RetrievalDependencyClientError("INVALID_RESPONSE", "Search returned invalid candidate envelope.");
    }
    const classificationRef = record.classificationRef;
    if (classificationRef !== "public" && classificationRef !== "internal" && classificationRef !== "confidential" && classificationRef !== "restricted") {
      throw new RetrievalDependencyClientError("INVALID_RESPONSE", "Search returned invalid candidate envelope.");
    }
    if (typeof record.rank !== "number" || !Number.isFinite(record.rank) || record.rank < 0) {
      throw new RetrievalDependencyClientError("INVALID_RESPONSE", "Search returned invalid candidate envelope.");
    }
    return {
      resourceRef: asString(record.resourceRef),
      versionRef: asString(record.versionRef),
      chunkRef: asString(record.chunkRef),
      contentHash: asSha256(record.contentHash),
      lane,
      rank: record.rank,
      classificationRef,
    };
  });
}

function createPdpPort(client: JsonDependencyClient): RetrievalPdpPort {
  return {
    async authorizeOperation(input) {
      const payload = asRecord(await client.post("/v1/retrieval/authorize-operation", {
        request_id: input.requestId,
        caller_workload_ref: input.callerWorkloadRef,
        subject_ref: input.subjectRef,
        session_ref: input.sessionRef,
        device_ref: input.deviceRef,
        corpus_ref: input.corpusRef,
        mode: input.mode,
        purpose_ref: input.purposeRef,
        deadline_at: input.deadlineAt,
      }, input.deadlineAt, input.signal));
      if (typeof payload.allowed !== "boolean") throw new RetrievalDependencyClientError("INVALID_RESPONSE", "PDP returned invalid decision.");
      return {
        allowed: payload.allowed,
        decisionRef: asString(payload.decisionRef),
        policyRevision: asSafeInteger(payload.policyRevision),
      };
    },
    async authorizeBatch(input) {
      const payload = asRecord(await client.post("/v1/retrieval/authorize-batch", {
        request_id: input.requestId,
        caller_workload_ref: input.callerWorkloadRef,
        subject_ref: input.subjectRef,
        session_ref: input.sessionRef,
        device_ref: input.deviceRef,
        resource_refs: input.resourceRefs,
        candidate_digest: input.candidateDigest,
        deadline_at: input.deadlineAt,
      }, input.deadlineAt, input.signal));
      return {
        allowedRefs: stringArray(payload.allowedRefs, input.resourceRefs.length),
        decisionRef: asString(payload.decisionRef),
        fence: typeof payload.fence === "string" ? payload.fence : "",
        revisionDigest: asString(payload.revisionDigest),
        policyRevision: asSafeInteger(payload.policyRevision),
        subjectSecurityRevision: asSafeInteger(payload.subjectSecurityRevision),
        resourceSecurityRevisionDigest: asSha256(payload.resourceSecurityRevisionDigest),
      };
    },
  };
}

function createIndexPort(client: JsonDependencyClient): RetrievalIndexPort {
  return {
    async search(input) {
      const payload = asRecord(await client.post("/v1/search", {
        mode: input.mode,
        query_digest: input.queryDigest,
        query_text: input.queryText,
        corpus_ref: input.corpusRef,
        index_generation: input.indexGeneration,
        visibility_sequence: input.visibilitySequence,
        source_revision_digest: input.sourceRevisionDigest,
        lane_limit: input.laneLimit,
        deadline_at: input.deadlineAt,
      }, input.deadlineAt, input.signal));
      return {
        indexGeneration: asString(payload.indexGeneration),
        visibilitySequence: asSafeInteger(payload.visibilitySequence),
        sourceRevisionDigest: asSha256(payload.sourceRevisionDigest),
        candidates: parseCandidates(payload.candidates, input.laneLimit),
      };
    },
  };
}

function createContentPort(client: JsonDependencyClient): AuthorizedContentPort {
  return {
    async fetch(input) {
      const payload = asRecord(await client.post("/v1/content/fetch", {
        request_id: input.requestId,
        caller_workload_ref: input.callerWorkloadRef,
        fence: input.fence,
        resources: input.resources,
        deadline_at: input.deadlineAt,
      }, input.deadlineAt, input.signal));
      if (!Array.isArray(payload.chunks) || payload.chunks.length > input.resources.length) {
        throw new RetrievalDependencyClientError("INVALID_RESPONSE", "Content service returned invalid chunk envelope.");
      }
      return payload.chunks.map((chunk) => {
        const record = asRecord(chunk);
        return {
          resourceRef: asString(record.resourceRef),
          versionRef: asString(record.versionRef),
          chunkRef: asString(record.chunkRef),
          contentHash: asSha256(record.contentHash),
          text: asString(record.text),
          citationAnchor: asString(record.citationAnchor),
        };
      });
    },
  };
}

function createAuditPort(client: JsonDependencyClient): RetrievalAuditPort {
  return {
    async admit(input) {
      const payload = asRecord(await client.post("/v1/audit/admit", {
        event_id: input.eventId,
        request_id: input.requestId,
        caller_workload_ref: input.callerWorkloadRef,
        operation_decision_ref: input.operationDecisionRef,
        candidate_decision_ref: input.candidateDecisionRef,
        candidate_digest: input.candidateDigest,
        allowed_digest: input.allowedDigest,
        manifest_digest: input.manifestDigest,
        policy_revision: input.policyRevision,
        deadline_at: input.deadlineAt,
      }, input.deadlineAt, input.signal));
      return { receipt: asString(payload.receipt) };
    },
  };
}

function createPublicationPort(client: JsonDependencyClient): PublicationPort {
  return {
    async activeGeneration(input) {
      const payload = asRecord(await client.post("/v1/publication/active-generation", {
        corpus_ref: input.corpusRef,
        deadline_at: input.deadlineAt,
      }, input.deadlineAt, input.signal));
      return {
        indexGeneration: asString(payload.indexGeneration),
        visibilitySequence: asSafeInteger(payload.visibilitySequence),
        sourceRevisionDigest: asSha256(payload.sourceRevisionDigest),
      };
    },
  };
}

export function createRetrievalDependencyClients(config: RetrievalDependencyClientConfig): RetrievalDependencyClients {
  const pdpClient = new JsonDependencyClient("PDP", config.pdp);
  const indexClient = new JsonDependencyClient("INDEX", config.index);
  const contentClient = new JsonDependencyClient("CONTENT", config.content);
  const auditClient = new JsonDependencyClient("AUDIT", config.audit);
  const publicationClient = new JsonDependencyClient("PUBLICATION", config.publication);
  const dependencyClients = [pdpClient, indexClient, contentClient, auditClient, publicationClient];
  return {
    pdp: createPdpPort(pdpClient),
    index: createIndexPort(indexClient),
    content: createContentPort(contentClient),
    audit: createAuditPort(auditClient),
    publication: createPublicationPort(publicationClient),
    health: {
      async check(timeoutMs = 2_000): Promise<boolean> {
        const results = await Promise.all(dependencyClients.map((client) => client.livez(timeoutMs)));
        return results.every((ok) => ok);
      },
    },
  };
}
