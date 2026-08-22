import { createHash } from "node:crypto";
import type { PolicyChunk, PolicyCorpus, PolicyCorpusSnapshot } from "./policyCorpus";
import { normalizeTokens } from "./policyCorpus";

export interface RetrievedPolicyChunk {
  chunk: PolicyChunk;
  score: number;
  matchedTerms: string[];
}

export interface RetrievalOptions {
  topK?: number;
  relevanceThreshold?: number;
  minMatchedTerms?: number;
  maxContextBytes?: number;
  cacheTtlMs?: number;
  cacheEntries?: number;
}

export class RagDeadlineError extends Error {
  constructor() { super("RAG request deadline exceeded"); this.name = "RagDeadlineError"; }
}

const queryDigest = (query: string) => createHash("sha256").update(query.normalize("NFKC"), "utf8").digest("hex");
const STOPWORDS = new Set([
  "a", "about", "an", "and", "are", "as", "at", "be", "by", "can", "do", "for", "from", "how", "i", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "what", "when", "where", "which", "who", "why", "with", "you",
]);

export function createPolicyRetriever(corpus: PolicyCorpus, options: RetrievalOptions = {}) {
  const topK = Math.max(1, options.topK ?? 6);
  const threshold = Math.max(0, options.relevanceThreshold ?? 0.15);
  const minMatchedTerms = Math.max(1, options.minMatchedTerms ?? 1);
  const maxContextBytes = Math.max(512, options.maxContextBytes ?? 14_000);
  const cacheTtlMs = Math.max(1_000, options.cacheTtlMs ?? 30_000);
  const cacheEntries = Math.max(1, options.cacheEntries ?? 128);
  const cache = new Map<string, { expiresAt: number; ids: string[]; generation: string }>();

  function check(deadline?: number, signal?: AbortSignal): void {
    if (signal?.aborted || deadline !== undefined && Date.now() >= deadline) throw new RagDeadlineError();
  }

  function score(queryTerms: string[], chunk: PolicyChunk, snapshot: PolicyCorpusSnapshot): RetrievedPolicyChunk {
    const matched = new Set<string>();
    let value = 0;
    const documentFrequency = (term: string) => snapshot.byToken.get(term)?.length ?? 0;
    const k1 = 1.2;
    const b = 0.75;
    for (const term of queryTerms) {
      const tf = chunk.tokens.get(term) ?? 0;
      const titleTf = chunk.titleTokens.get(term) ?? 0;
      if (!tf && !titleTf) continue;
      matched.add(term);
      const idf = Math.log(1 + (snapshot.chunks.length - documentFrequency(term) + 0.5) / (documentFrequency(term) + 0.5));
      const norm = tf ? (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * chunk.length / snapshot.averageLength)) : 0;
      value += idf * (norm + Math.min(2, titleTf) * 1.5);
    }
    // Keep the gate stable as corpus size changes while rewarding multiple
    // independent query terms.
    const normalized = queryTerms.length ? value / Math.sqrt(queryTerms.length) : 0;
    return { chunk, score: normalized, matchedTerms: [...matched].sort() };
  }

  async function retrieve(query: string, request?: { deadline?: number; signal?: AbortSignal }): Promise<RetrievedPolicyChunk[]> {
    const terms = [...new Set(normalizeTokens(query).filter((term) => !STOPWORDS.has(term)))];
    if (!terms.length) return [];
    check(request?.deadline, request?.signal);
    const snapshot = await corpus.getSnapshot(false, request);
    check(request?.deadline, request?.signal);
    const key = `${snapshot.generation}:${queryDigest(query)}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      const byId = new Map(snapshot.chunks.map((chunk) => [chunk.id, chunk]));
      const hits = cached.ids.map((id) => byId.get(id)).filter((chunk): chunk is PolicyChunk => Boolean(chunk));
      if (hits.length) return hits.map((chunk) => score(terms, chunk, snapshot));
    }
    const candidateIndices = new Set<number>();
    for (const term of terms) {
      for (const index of snapshot.byToken.get(term) ?? []) candidateIndices.add(index);
      check(request?.deadline, request?.signal);
    }
    const requiredTerms = terms.length > 1 ? Math.max(2, minMatchedTerms) : minMatchedTerms;
    const requiredScore = terms.length === 1 ? Math.max(threshold, 0.8) : threshold;
    const results = [...candidateIndices].map((index) => score(terms, snapshot.chunks[index], snapshot))
      .filter((result) => result.matchedTerms.length >= requiredTerms && result.score >= requiredScore)
      .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id));
    const selected: RetrievedPolicyChunk[] = [];
    let contextBytes = 0;
    for (const result of results) {
      const bytes = Buffer.byteLength(result.chunk.text, "utf8");
      if (selected.length >= topK || contextBytes + bytes > maxContextBytes) break;
      selected.push(result); contextBytes += bytes;
    }
    cache.delete(key);
    cache.set(key, { expiresAt: Date.now() + cacheTtlMs, ids: selected.map((item) => item.chunk.id), generation: snapshot.generation });
    while (cache.size > cacheEntries) cache.delete(cache.keys().next().value!);
    return selected;
  }

  async function ready(request?: { deadline?: number; signal?: AbortSignal }): Promise<{ generation: string; chunks: number }> {
    const snapshot = await corpus.getSnapshot(false, request);
    return { generation: snapshot.generation, chunks: snapshot.chunks.length };
  }

  async function overview(request?: { deadline?: number; signal?: AbortSignal }): Promise<RetrievedPolicyChunk[]> {
    check(request?.deadline, request?.signal);
    const snapshot = await corpus.getSnapshot(false, request);
    const selected: RetrievedPolicyChunk[] = [];
    const seenResources = new Set<string>();
    let contextBytes = 0;
    for (const chunk of snapshot.chunks) {
      if (seenResources.has(chunk.citation.resource)) continue;
      const bytes = Buffer.byteLength(chunk.text, "utf8");
      if (selected.length >= topK || contextBytes + bytes > maxContextBytes) break;
      seenResources.add(chunk.citation.resource);
      contextBytes += bytes;
      selected.push({ chunk, score: 1, matchedTerms: ["policy-overview"] });
    }
    return selected;
  }

  return { retrieve, overview, ready };
}

export type PolicyRetriever = ReturnType<typeof createPolicyRetriever>;
