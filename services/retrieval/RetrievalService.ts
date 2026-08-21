import { createHash } from "node:crypto";
import type {
  AuthorizationManifest,
  RetrievalRequest,
  RetrievedContext,
  RetrievalResult,
  RetrievedSource,
} from "../../libs/rag-contracts";

export type RetrievalServiceFailure =
  | "INVALID_ARGUMENT"
  | "UNAUTHENTICATED"
  | "STALE_AUTHORITY"
  | "AUTHORITY_UNAVAILABLE"
  | "AUDIT_UNAVAILABLE"
  | "DEPENDENCY_UNAVAILABLE"
  | "OVERLOADED"
  | "RATE_LIMITED"
  | "DEADLINE_EXCEEDED"
  | "CANCELLED";

export class RetrievalServiceError extends Error {
  constructor(
    readonly code: RetrievalServiceFailure,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
}

export type MaybePromise<T> = T | PromiseLike<T>;

export interface RetrievalCandidate {
  resourceRef: string;
  versionRef: string;
  chunkRef: string;
  contentHash: `sha256:${string}`;
  lane: "lexical" | "vector" | "graph" | "metadata";
  rank: number;
  classificationRef: RetrievedSource["classification_ref"];
}

export interface RetrievalSearchResult {
  indexGeneration: string;
  visibilitySequence: number;
  sourceRevisionDigest: `sha256:${string}`;
  candidates: readonly RetrievalCandidate[];
}

export interface RetrievalPdpPort {
  authorizeOperation(input: {
    requestId: string;
    callerWorkloadRef: "ai-orchestrator";
    subjectRef: string;
    sessionRef: string;
    deviceRef: string;
    corpusRef: string;
    mode: RetrievalRequest["mode"];
    purposeRef: string;
    deadlineAt: number;
    signal: AbortSignal;
  }): MaybePromise<{ allowed: boolean; decisionRef: string; policyRevision: number }>;
  authorizeBatch(input: {
    requestId: string;
    callerWorkloadRef: "ai-orchestrator";
    subjectRef: string;
    sessionRef: string;
    deviceRef: string;
    resourceRefs: readonly string[];
    candidateDigest: string;
    deadlineAt: number;
    signal: AbortSignal;
  }): MaybePromise<{
    allowedRefs: readonly string[];
    decisionRef: string;
    fence: string;
    revisionDigest: string;
    policyRevision: number;
    subjectSecurityRevision: number;
    resourceSecurityRevisionDigest: `sha256:${string}`;
  }>;
}

export interface RetrievalIndexPort {
  search(input: {
    mode: RetrievalRequest["mode"];
    queryDigest: string;
    queryText: string;
    corpusRef: string;
    indexGeneration: string;
    visibilitySequence: number;
    sourceRevisionDigest: `sha256:${string}`;
    laneLimit: number;
    deadlineAt: number;
    signal: AbortSignal;
  }): MaybePromise<RetrievalSearchResult>;
}

export interface AuthorizedContentPort {
  fetch(input: {
    requestId: string;
    callerWorkloadRef: "ai-orchestrator";
    fence: string;
    deadlineAt: number;
    signal: AbortSignal;
    resources: readonly Pick<RetrievalCandidate, "resourceRef" | "versionRef" | "chunkRef" | "contentHash">[];
  }): MaybePromise<readonly {
    resourceRef: string;
    versionRef: string;
    chunkRef: string;
    contentHash: `sha256:${string}`;
    text: string;
    citationAnchor: string;
  }[]>;
}

export interface RetrievalAuditPort {
  admit(input: {
    eventId: string;
    requestId: string;
    callerWorkloadRef: "ai-orchestrator";
    operationDecisionRef: string;
    candidateDecisionRef: string;
    candidateDigest: string;
    allowedDigest: string;
    manifestDigest: string;
    policyRevision: number;
    deadlineAt: number;
    signal: AbortSignal;
  }): MaybePromise<{ receipt: string }>;
}

export interface PublicationPort {
  activeGeneration(input: { corpusRef: string; deadlineAt: number; signal: AbortSignal }): MaybePromise<{
    indexGeneration: string;
    visibilitySequence: number;
    sourceRevisionDigest: `sha256:${string}`;
  }>;
}

export interface RetrievalResourceProfile {
  maxCandidates: number;
  maxCandidateBytes: number;
  maxContextBytes: number;
  maxActiveRequests: number;
}

const DEFAULT_PROFILE: RetrievalResourceProfile = {
  maxCandidates: 1_000,
  maxCandidateBytes: 512 * 1024,
  maxContextBytes: 64 * 1024,
  maxActiveRequests: 16,
};

function assertActive(deadlineAt: number, now: number, signal?: AbortSignal): void {
  if (signal?.aborted) throw new RetrievalServiceError("CANCELLED", false, "The retrieval request was cancelled.");
  if (deadlineAt <= now) throw new RetrievalServiceError("DEADLINE_EXCEEDED", false, "The retrieval deadline elapsed.");
}

/**
 * Production, stateless Retrieval pipeline. Search narrows candidates; the PDP
 * authorizes the operation and the candidate batch from one committed snapshot;
 * protected bytes are fetched only after allow; reranking runs only over
 * allowed content; a quorum audit receipt must exist before protected context
 * leaves Retrieval. Every authority call propagates the absolute deadline and
 * cancellation signal.
 */
export class RetrievalService {
  private readonly profile: RetrievalResourceProfile;
  private activeRequests = 0;

  constructor(
    private readonly pdp: RetrievalPdpPort,
    private readonly indexes: RetrievalIndexPort,
    private readonly content: AuthorizedContentPort,
    private readonly audit: RetrievalAuditPort,
    private readonly publication: PublicationPort,
    private readonly now: () => number = () => Date.now(),
    profile: Partial<RetrievalResourceProfile> = {},
  ) {
    this.profile = { ...DEFAULT_PROFILE, ...profile };
  }

  async retrieve(request: RetrievalRequest, signal?: AbortSignal): Promise<RetrievalResult> {
    const deadlineAt = request.deadline_at;
    this.assertCapacity(request.bulkhead);
    assertActive(deadlineAt, this.now(), signal);
    this.activeRequests += 1;
    try {
      return await this.execute(request, signal ?? new AbortController().signal);
    } finally {
      this.activeRequests -= 1;
    }
  }

  private async execute(request: RetrievalRequest, signal: AbortSignal): Promise<RetrievalResult> {
    assertActive(request.deadline_at, this.now(), signal);

    const publication = await this.withBoundaries("DEPENDENCY_UNAVAILABLE", true, () =>
      this.publication.activeGeneration({ corpusRef: request.corpus_ref, deadlineAt: request.deadline_at, signal }),
    );

    let operation: Awaited<ReturnType<RetrievalPdpPort["authorizeOperation"]>>;
    try {
      operation = await this.pdp.authorizeOperation({
        requestId: request.request_id,
        callerWorkloadRef: "ai-orchestrator",
        subjectRef: request.subject_ref,
        sessionRef: request.session_ref,
        deviceRef: request.device_ref,
        corpusRef: request.corpus_ref,
        mode: request.mode,
        purposeRef: request.purpose_ref,
        deadlineAt: request.deadline_at,
        signal,
      });
    } catch {
      throw new RetrievalServiceError("AUTHORITY_UNAVAILABLE", true, "The authorization authority is unavailable.");
    }
    if (!operation.allowed) return { status: "denied_policy" };
    assertActive(request.deadline_at, this.now(), signal);

    const laneLimit = Math.min(request.candidate_limit, this.profile.maxCandidates);
    let candidates: readonly RetrievalCandidate[];
    try {
      const searchResult = await this.indexes.search({
        mode: request.mode,
        queryDigest: request.query_digest,
        queryText: request.query_text,
        corpusRef: request.corpus_ref,
        indexGeneration: publication.indexGeneration,
        visibilitySequence: publication.visibilitySequence,
        sourceRevisionDigest: publication.sourceRevisionDigest,
        laneLimit,
        deadlineAt: request.deadline_at,
        signal,
      });
      if (
        searchResult.indexGeneration !== publication.indexGeneration ||
        searchResult.visibilitySequence !== publication.visibilitySequence ||
        searchResult.sourceRevisionDigest !== publication.sourceRevisionDigest
      ) {
        throw new RetrievalServiceError("STALE_AUTHORITY", false, "The search index did not honor the pinned publication generation.");
      }
      candidates = this.fuse(searchResult.candidates);
    } catch (error) {
      if (error instanceof RetrievalServiceError) throw error;
      throw new RetrievalServiceError("DEPENDENCY_UNAVAILABLE", true, "The search index is unavailable.");
    }
    if (candidates.length === 0) return { status: "no_context" };
    assertActive(request.deadline_at, this.now(), signal);

    const envelopeBytes = candidates.reduce((bytes, candidate) => bytes + this.candidateBytes(candidate), 0);
    if (envelopeBytes > this.profile.maxCandidateBytes) {
      throw new RetrievalServiceError("OVERLOADED", true, "The candidate envelope exceeds its approved byte bound.");
    }

    const candidateDigest = this.digestCanonical(candidates.map((candidate) => this.candidateDigestEntry(candidate)));
    let decision: Awaited<ReturnType<RetrievalPdpPort["authorizeBatch"]>>;
    try {
      decision = await this.pdp.authorizeBatch({
        requestId: request.request_id,
        callerWorkloadRef: "ai-orchestrator",
        subjectRef: request.subject_ref,
        sessionRef: request.session_ref,
        deviceRef: request.device_ref,
        resourceRefs: candidates.map((candidate) => candidate.versionRef),
        candidateDigest,
        deadlineAt: request.deadline_at,
        signal,
      });
    } catch {
      throw new RetrievalServiceError("AUTHORITY_UNAVAILABLE", true, "The batch authorization authority is unavailable.");
    }
    if (decision.allowedRefs.length === 0 || !decision.fence) return { status: "no_context" };
    assertActive(request.deadline_at, this.now(), signal);

    const allowedRefs = new Set(decision.allowedRefs);
    const allowed = candidates.filter((candidate) => allowedRefs.has(candidate.versionRef));
    if (allowed.length === 0) return { status: "no_context" };

    let chunks: Awaited<ReturnType<AuthorizedContentPort["fetch"]>>;
    try {
      chunks = await this.content.fetch({
        requestId: request.request_id,
        callerWorkloadRef: "ai-orchestrator",
        fence: decision.fence,
        deadlineAt: request.deadline_at,
        signal,
        resources: allowed.map(({ resourceRef, versionRef, chunkRef, contentHash }) => ({ resourceRef, versionRef, chunkRef, contentHash })),
      });
    } catch {
      throw new RetrievalServiceError("DEPENDENCY_UNAVAILABLE", true, "The content store is unavailable.");
    }
    assertActive(request.deadline_at, this.now(), signal);

    const chunkKeys = new Set(chunks.map((chunk) => this.chunkKey(chunk)));
    if (
      chunks.length === 0 ||
      chunks.length > allowed.length ||
      chunkKeys.size !== chunks.length ||
      chunks.some((chunk) => !allowed.some((candidate) =>
        candidate.resourceRef === chunk.resourceRef &&
        candidate.versionRef === chunk.versionRef &&
        candidate.chunkRef === chunk.chunkRef &&
        candidate.contentHash === chunk.contentHash,
      ))
    ) {
      return { status: "no_context" };
    }
    const contextBytes = chunks.reduce((bytes, chunk) => bytes + Buffer.byteLength(chunk.text, "utf8"), 0);
    if (contextBytes > this.profile.maxContextBytes) {
      throw new RetrievalServiceError("OVERLOADED", true, "The context package exceeds its approved byte bound.");
    }

    // Rerank only over allowed content, deterministically by original rank.
    const ordered = chunks.slice().sort((a, b) =>
      this.rank(allowed, a) - this.rank(allowed, b) || this.chunkKey(a).localeCompare(this.chunkKey(b)),
    );

    const sources: RetrievedContext[] = ordered.map((chunk) => {
      const candidate = allowed.find((item) =>
        item.resourceRef === chunk.resourceRef &&
        item.versionRef === chunk.versionRef &&
        item.chunkRef === chunk.chunkRef &&
        item.contentHash === chunk.contentHash,
      );
      return {
        document_version_ref: chunk.versionRef,
        chunk_ref: chunk.chunkRef,
        content_digest: chunk.contentHash,
        citation_anchor: chunk.citationAnchor,
        classification_ref: candidate?.classificationRef ?? "internal",
        text: chunk.text,
      };
    });

    const allowedDigest = this.digestCanonical(ordered.map((chunk) => this.chunkDigestEntry(chunk)));
    const manifestSources: RetrievedSource[] = sources.map((source) => ({
      document_version_ref: source.document_version_ref,
      chunk_ref: source.chunk_ref,
      content_digest: source.content_digest,
      citation_anchor: source.citation_anchor,
      classification_ref: source.classification_ref,
    }));
    const retrievedAt = this.now();
    const manifestBody = {
      retrieved_at: retrievedAt,
      source_revision_digest: publication.sourceRevisionDigest,
      operation_decision_ref: operation.decisionRef,
      candidate_decision_ref: decision.decisionRef,
      policy_revision: decision.policyRevision,
      subject_security_revision: decision.subjectSecurityRevision,
      resource_security_revision_digest: decision.resourceSecurityRevisionDigest,
      expires_at: request.deadline_at,
      sources: manifestSources,
    };
    const manifest: AuthorizationManifest = {
      digest: this.digestCanonical(manifestBody),
      ...manifestBody,
    };

    let receipt: string;
    try {
      receipt = (await this.audit.admit({
        eventId: `retrieval:${request.request_id}`,
        requestId: request.request_id,
        callerWorkloadRef: "ai-orchestrator",
        operationDecisionRef: operation.decisionRef,
        candidateDecisionRef: decision.decisionRef,
        candidateDigest,
        allowedDigest,
        manifestDigest: manifest.digest,
        policyRevision: decision.policyRevision,
        deadlineAt: request.deadline_at,
        signal,
      })).receipt;
    } catch {
      throw new RetrievalServiceError("AUDIT_UNAVAILABLE", true, "The audit quorum is unavailable.");
    }
    if (!receipt) throw new RetrievalServiceError("AUDIT_UNAVAILABLE", true, "The audit quorum did not admit the context.");

    return {
      status: "context",
      retrieval_id: `retrieval:${request.request_id}`,
      request_id: request.request_id,
      turn_id: request.turn_id,
      visibility_sequence: publication.visibilitySequence,
      index_generation: publication.indexGeneration,
      context_digest: manifest.digest,
      manifest,
      sources,
    };
  }

  private async withBoundaries<T>(code: RetrievalServiceFailure, retryable: boolean, operation: () => MaybePromise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof RetrievalServiceError) throw error;
      throw new RetrievalServiceError(code, retryable, "A downstream retrieval authority failed.");
    }
  }

  private assertCapacity(bulkhead: RetrievalRequest["bulkhead"]): void {
    const limit = bulkhead === "management" ? Math.max(1, this.profile.maxActiveRequests / 4) : this.profile.maxActiveRequests;
    if (this.activeRequests >= limit) {
      throw new RetrievalServiceError("OVERLOADED", true, "Retrieval capacity is exhausted; retry later.");
    }
  }

  private fuse(candidates: readonly RetrievalCandidate[]): readonly RetrievalCandidate[] {
    const merged = new Map<string, RetrievalCandidate>();
    for (const candidate of candidates) {
      const key = `${candidate.resourceRef}|${candidate.versionRef}|${candidate.chunkRef}`;
      const existing = merged.get(key);
      if (!existing || candidate.rank < existing.rank) merged.set(key, candidate);
    }
    return [...merged.values()]
      .sort((a, b) => a.rank - b.rank || a.lane.localeCompare(b.lane) || this.candidateKey(a).localeCompare(this.candidateKey(b)))
      .slice(0, this.profile.maxCandidates);
  }

  private rank(candidates: readonly RetrievalCandidate[], chunk: { resourceRef: string; chunkRef: string }): number {
    return candidates.find((candidate) => candidate.resourceRef === chunk.resourceRef && candidate.chunkRef === chunk.chunkRef)?.rank ?? Number.MAX_SAFE_INTEGER;
  }

  private candidateKey(candidate: Pick<RetrievalCandidate, "resourceRef" | "versionRef" | "chunkRef" | "contentHash">): string {
    return `${candidate.resourceRef}@${candidate.versionRef}#${candidate.chunkRef}:${candidate.contentHash}`;
  }

  private chunkKey(chunk: { resourceRef: string; versionRef: string; chunkRef: string; contentHash: string }): string {
    return `${chunk.resourceRef}@${chunk.versionRef}#${chunk.chunkRef}:${chunk.contentHash}`;
  }

  private candidateBytes(candidate: RetrievalCandidate): number {
    return [
      candidate.resourceRef,
      candidate.versionRef,
      candidate.chunkRef,
      candidate.contentHash,
      candidate.lane,
      candidate.classificationRef,
      String(candidate.rank),
    ].reduce((bytes, value) => bytes + Buffer.byteLength(value, "utf8"), 0);
  }

  private candidateDigestEntry(candidate: RetrievalCandidate) {
    return {
      resource_ref: candidate.resourceRef,
      version_ref: candidate.versionRef,
      chunk_ref: candidate.chunkRef,
      content_hash: candidate.contentHash,
      lane: candidate.lane,
      rank: candidate.rank,
      classification_ref: candidate.classificationRef,
    };
  }

  private chunkDigestEntry(chunk: { resourceRef: string; versionRef: string; chunkRef: string; contentHash: string }) {
    return {
      resource_ref: chunk.resourceRef,
      version_ref: chunk.versionRef,
      chunk_ref: chunk.chunkRef,
      content_hash: chunk.contentHash,
    };
  }

  private digestCanonical(value: unknown): `sha256:${string}` {
    return this.sha256(this.canonicalJson(value));
  }

  private canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.canonicalJson(item)).join(",")}]`;
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${this.canonicalJson(record[key])}`)
        .join(",")}}`;
    }
    return JSON.stringify(value);
  }

  private sha256(value: string): `sha256:${string}` {
    return `sha256:${createHash("sha256").update(value).digest("hex")}`;
  }
}
