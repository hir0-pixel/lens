import { describe, expect, it } from "vitest";
import { HybridRetrievalService } from "../../services/retrieval/HybridRetrievalService";
import { RetrievalCacheControl } from "../../services/cache-control/RetrievalCacheControl";

describe("M06 retrieval", () => {
  const candidate = { resourceRef: "document-version-1", versionRef: "v1", chunkRef: "chunk-1", contentHash: "sha256:chunk", lane: "lexical" as const, rank: 1 };
  const service = (allowed = ["v1"]) => new HybridRetrievalService({ authorizeOperation: () => ({ allowed: true, decisionRef: "operation" }), authorizeBatch: () => ({ allowedRefs: allowed, decisionRef: "batch", fence: "signed-fence", revisionDigest: "revisions" }) }, { search: () => [candidate] }, { fetch: () => [{ ...candidate, text: "protected text", citationAnchor: "page:1" }] }, { admit: () => ({ receipt: "audit" }) }, () => 1);
  const request = (overrides = {}) => ({ requestId: "request-1", subjectRef: "subject-1", deviceRef: "device-1", corpusRef: "corpus-1", mode: "hybrid" as const, queryDigest: "sha256:query", deadlineAt: 100, ...overrides });
  it("freshly authorizes, fence-fetches, audits, and packages only allowed content", () => { const response = service().retrieve(request()); expect(response.outcome).toBe("completed"); expect(response.chunks).toHaveLength(1); expect(response.manifest?.packagedContextDigest).toContain("chunk-1"); });
  it("normalizes denied candidates to no_context without fetching bytes", () => { expect(service([]).retrieve(request()).outcome).toBe("no_context"); });
  it("rejects oversized candidate envelopes before search", () => { expect(() => service().retrieve(request({ candidateLimit: 1001 }))).toThrow("INVALID_REQUEST"); });
  it("invalidates only immutable, HMAC-addressed dependent cache artifacts", () => { const cache = new RetrievalCacheControl(); cache.put({ namespace: "candidate-id", key: "hmac:candidate-list", securityDomainId: "corp", immutableDigest: "sha256:immutable", sourceRevision: "rev:1", indexGeneration: "index:1", schemaVersion: "v1", dependencyRefs: ["document-version-1"], valueRef: "cache:1" }); expect(cache.invalidate(["document-version-1"])).toBe(1); expect(cache.get("hmac:candidate-list")).toBeUndefined(); });
});
