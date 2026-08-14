export type RagFailureCode = "INVALID_ARGUMENT" | "FORBIDDEN" | "DEPENDENCY_UNAVAILABLE" | "CANCELLED" | "DEADLINE_EXCEEDED" | "STALE_AUTHORITY";

export class RagError extends Error {
  constructor(readonly code: RagFailureCode, message: string) {
    super(message);
  }
}

export interface RetrievalRequest {
  requestId: string;
  subjectRef: string;
  purposeRef: string;
  queryDigest: `sha256:${string}`;
  deadlineAt: number;
  requireGroundedContext: boolean;
}

export interface CitationReference {
  documentVersionRef: string;
  chunkRef: string;
  contentDigest: `sha256:${string}`;
  citationAnchor: string;
}

export interface RetrievedContext extends CitationReference {
  classificationRef: string;
  text: string;
}

export interface ContextAuthorizationManifest {
  digest: `sha256:${string}`;
  retrievedAt: number;
  sourceRevisionDigest: `sha256:${string}`;
  sources: readonly Omit<RetrievedContext, "text">[];
}

export type RetrievalResult =
  | { status: "context"; manifest: ContextAuthorizationManifest; sources: readonly RetrievedContext[] }
  | { status: "no_context" }
  | { status: "denied_policy" }
  | { status: "failed_downstream" };

export interface RetrievalPort {
  retrieve(request: RetrievalRequest, signal: AbortSignal): Promise<RetrievalResult>;
  refreshCitation(input: { request: RetrievalRequest; citation: CitationReference }, signal: AbortSignal): Promise<RetrievedContext | undefined>;
}

export interface ContextUseAuthorizer {
  authorizeContextUse(input: { request: RetrievalRequest; manifest: ContextAuthorizationManifest; useBoundary: "generation" | "citation" }, signal: AbortSignal): Promise<{ fence: string }>;
}

export type RagContext =
  | { noContext: true }
  | { noContext: false; manifest: ContextAuthorizationManifest; sources: readonly RetrievedContext[] };

/**
 * Orchestrator-owned composition boundary. Retrieval owns candidate discovery;
 * this class only validates its immutable result and obtains use-time fences.
 */
export class RagComposition {
  constructor(
    private readonly retrieval: RetrievalPort,
    private readonly authorizer: ContextUseAuthorizer,
    private readonly options: { now?: () => number; maxSources?: number; maxContextBytes?: number } = {},
  ) {}

  async compose(request: RetrievalRequest, signal?: AbortSignal): Promise<RagContext> {
    this.assertActive(request, signal);
    const result = await this.retrieval.retrieve(request, signal ?? new AbortController().signal);
    this.assertActive(request, signal);
    if (result.status === "no_context") return { noContext: true };
    if (result.status === "denied_policy") throw new RagError("FORBIDDEN", "Retrieval operation was denied.");
    if (result.status === "failed_downstream") throw new RagError("DEPENDENCY_UNAVAILABLE", "Retrieval dependency is unavailable.");
    this.validateResult(result);
    return { noContext: false, manifest: result.manifest, sources: result.sources };
  }

  async authorizeGeneration(request: RetrievalRequest, context: RagContext, signal?: AbortSignal): Promise<string | undefined> {
    if (context.noContext) return undefined;
    this.assertActive(request, signal);
    const authorization = await this.authorizer.authorizeContextUse({ request, manifest: context.manifest, useBoundary: "generation" }, signal ?? new AbortController().signal);
    if (!authorization.fence) throw new RagError("STALE_AUTHORITY", "Context use was not fenced.");
    return authorization.fence;
  }

  async resolveCitation(request: RetrievalRequest, context: RagContext, citation: CitationReference, signal?: AbortSignal): Promise<RetrievedContext | undefined> {
    if (context.noContext || !context.manifest.sources.some((source) => this.sameCitation(source, citation))) return undefined;
    this.assertActive(request, signal);
    const authorization = await this.authorizer.authorizeContextUse({ request, manifest: context.manifest, useBoundary: "citation" }, signal ?? new AbortController().signal);
    if (!authorization.fence) throw new RagError("STALE_AUTHORITY", "Citation use was not fenced.");
    const refreshed = await this.retrieval.refreshCitation({ request, citation }, signal ?? new AbortController().signal);
    this.assertActive(request, signal);
    if (!refreshed) return undefined;
    if (!this.sameCitation(refreshed, citation)) throw new RagError("STALE_AUTHORITY", "Citation refresh changed immutable source identity.");
    return refreshed;
  }

  private validateResult(result: Extract<RetrievalResult, { status: "context" }>): void {
    const maxSources = this.options.maxSources ?? 20;
    const maxContextBytes = this.options.maxContextBytes ?? 64 * 1024;
    if (!/^sha256:[a-f0-9]{64}$/.test(result.manifest.digest) || !/^sha256:[a-f0-9]{64}$/.test(result.manifest.sourceRevisionDigest) || result.sources.length === 0 || result.sources.length > maxSources) {
      throw new RagError("INVALID_ARGUMENT", "Retrieval returned an invalid context manifest.");
    }
    const manifestKeys = new Set(result.manifest.sources.map((source) => this.citationKey(source)));
    const sourceKeys = result.sources.map((source) => this.citationKey(source));
    if (new Set(sourceKeys).size !== sourceKeys.length || sourceKeys.some((key) => !manifestKeys.has(key)) || result.sources.reduce((bytes, source) => bytes + source.text.length, 0) > maxContextBytes) {
      throw new RagError("INVALID_ARGUMENT", "Retrieval context exceeded its immutable bounds.");
    }
  }

  private assertActive(request: RetrievalRequest, signal?: AbortSignal): void {
    if (signal?.aborted) throw new RagError("CANCELLED", "Retrieval was cancelled.");
    if (request.deadlineAt <= (this.options.now ?? (() => Date.now()))()) throw new RagError("DEADLINE_EXCEEDED", "Retrieval deadline elapsed.");
  }

  private sameCitation(left: CitationReference, right: CitationReference): boolean {
    return this.citationKey(left) === this.citationKey(right);
  }

  private citationKey(citation: CitationReference): string {
    return `${citation.documentVersionRef}\u0000${citation.chunkRef}\u0000${citation.contentDigest}\u0000${citation.citationAnchor}`;
  }
}
