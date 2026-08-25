import { describe, expect, it } from "vitest";
import { createIngestionDeployment } from "../../services/ingestion";
import { createRetrievalDeployment } from "../../services/retrieval/ProductionRetrievalWiring";
import type { ModelProviderAdapter } from "../../services/model-provider/ProviderAdapter";
import type { CompanyRagProfile } from "../../services/rag-profile/companyRagProfile";
import type { IndexProfile } from "../../services/retrieval/PublicationAuthority";
import { simpleHash } from "../../services/retrieval/indexGenerationManifest";

const digest = (value: string): `sha256:${string}` => `sha256:${simpleHash(value)}`;
const indexProfile: IndexProfile = { embeddingModelDigest: digest("a"), tokenizerDigest: digest("b"), vectorDimensions: 2, distanceMetric: "cosine", chunkingProfile: "test", schemaVersion: "rag-v1" };
const ragProfile: CompanyRagProfile = { profileVersion: 1, companyId: "company", corpora: ["enterprise-docs"], connectors: [], chunking: { maxTokens: 100, overlapTokens: 10 }, embeddingAdapterRef: "provider", groundingPolicyRef: "policy", tools: [], retentionDays: 30, eligibleModelPatterns: ["embed"], retrievalProfiles: { default: { corpusRef: "enterprise-docs", mode: "hybrid" } } };
const provider: ModelProviderAdapter = { adapterType: "openai-compatible", discoverModels: async () => [], getModelCapabilities: async () => ["embed"], generateStream: async function* () { yield ""; }, embed: async () => [1, 2], health: async () => true, normalizeError: () => ({ code: "DEPENDENCY_UNAVAILABLE", retryable: true }), meterUsage: (text) => text.length };
const retrieval = () => createRetrievalDeployment({ index: { search: () => [] }, publicationProfiles: { "other-corpus": { profile: indexProfile, ragProfileVersion: 1, ragProfileDigest: digest("c") } } });
const request = { sourceId: "source", documentRef: "document", version: "v1", versionRef: "document@v1", contentDigest: digest("d"), aclDigest: digest("e"), classificationRef: "internal" as const, parse: { status: "accepted" as const, renditionDigest: digest("f"), chunks: [{ chunkRef: "chunk", contentDigest: digest("production wiring chunk"), text: "production wiring chunk", citationAnchor: "page:1" }] } };

describe("production ingestion wiring", () => {
  it("fails closed when a corpus has no publication authority", () => {
    expect(() => createIngestionDeployment({ retrieval: retrieval(), provider, embeddingModel: "embed", ragProfile, corpora: { missing: { indexProfile, ragProfileVersion: 1, ragProfileDigest: digest("c") } } })).toThrow("not configured");
  });

  it("creates independent services wired to the same publication authorities retrieval uses", async () => {
    const deployedRetrieval = retrieval();
    const deployment = createIngestionDeployment({ retrieval: deployedRetrieval, provider, embeddingModel: "embed", ragProfile, corpora: {
      "enterprise-docs": { indexProfile, ragProfileVersion: 1, ragProfileDigest: digest("c") },
      "other-corpus": { indexProfile, ragProfileVersion: 1, ragProfileDigest: digest("c") },
    } });
    expect(deployment.services.size).toBe(2);
    expect(deployment.services.get("enterprise-docs")).not.toBe(deployment.services.get("other-corpus"));
    await deployment.services.get("enterprise-docs")!.ingest(request);
    expect(deployedRetrieval.publicationAuthorities.get("enterprise-docs")!.isSearchable("document@v1")).toBe(true);
  });
});
