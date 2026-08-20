const MAX_OUTPUT_CHARS = 64_000;
const MAX_CITATIONS = 20;

export interface RagCitation {
  source: string;
  section: string;
}

export interface RagAnswer {
  output: string;
  citations: readonly RagCitation[];
}

export class LocalRagClientError extends Error {}

function localServiceUrl(value: string): URL {
  const endpoint = new URL(value);
  const allowedHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (
    endpoint.protocol !== "http:" ||
    !allowedHosts.has(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new LocalRagClientError("RAG_SERVICE_URL must be a loopback HTTP URL.");
  }
  return endpoint;
}

/**
 * The BFF may contact only the local, separately deployed RAG service. That
 * service owns its retrieval/model-provider configuration; the browser never
 * learns the provider address or API key.
 */
export class LocalRagClient {
  private readonly endpoint: URL;

  constructor(
    serviceUrl: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.endpoint = localServiceUrl(serviceUrl);
    if (token.length < 32) {
      throw new LocalRagClientError("RAG_SERVICE_TOKEN must contain at least 32 characters.");
    }
  }

  async ask(input: { requestId: string; subjectRef: string; query: string }, signal?: AbortSignal): Promise<RagAnswer> {
    const url = new URL("/v1/ask", this.endpoint);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-lens-rag-token": this.token,
          "x-lens-request-id": input.requestId,
          "x-lens-subject-ref": input.subjectRef,
        },
        body: JSON.stringify({ query: input.query }),
        signal,
      });
    } catch {
      throw new LocalRagClientError("RAG_SERVICE_UNAVAILABLE");
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new LocalRagClientError("RAG_SERVICE_UNAVAILABLE");
    }
    if (!response.ok || !payload || typeof payload !== "object") {
      throw new LocalRagClientError("RAG_SERVICE_UNAVAILABLE");
    }

    const result = payload as { output?: unknown; citations?: unknown };
    if (
      typeof result.output !== "string" ||
      result.output.length === 0 ||
      result.output.length > MAX_OUTPUT_CHARS ||
      !Array.isArray(result.citations) ||
      result.citations.length > MAX_CITATIONS ||
      result.citations.some((citation) =>
        !citation || typeof citation !== "object" ||
        typeof (citation as RagCitation).source !== "string" ||
        typeof (citation as RagCitation).section !== "string",
      )
    ) {
      throw new LocalRagClientError("RAG_SERVICE_INVALID_RESPONSE");
    }
    return {
      output: result.output,
      citations: result.citations.map((citation) => ({
        source: (citation as RagCitation).source,
        section: (citation as RagCitation).section,
      })),
    };
  }
}
