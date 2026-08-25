import { describe, expect, it } from "vitest";
import { createIngestionDeployment } from "../../services/ingestion";
import type { ModelProviderAdapter } from "../../services/model-provider/ProviderAdapter";
import type { CompanyRagProfile } from "../../services/rag-profile/companyRagProfile";
import { createRetrievalDeployment } from "../../services/retrieval/ProductionRetrievalWiring";
import { simpleHash } from "../../services/retrieval/indexGenerationManifest";
import type { IndexProfile } from "../../services/retrieval/PublicationAuthority";

const digest = (value: string): `sha256:${string}` => `sha256:${simpleHash(value)}`;
const indexProfile: IndexProfile = {
  embeddingModelDigest: digest("embedding-model"),
  tokenizerDigest: digest("tokenizer"),
  vectorDimensions: 2,
  distanceMetric: "cosine",
  chunkingProfile: "test",
  schemaVersion: "rag-v1",
};
const ragProfile: CompanyRagProfile = {
  profileVersion: 1,
  companyId: "company",
  corpora: ["enterprise-docs"],
  connectors: [],
  chunking: { maxTokens: 100, overlapTokens: 10 },
  embeddingAdapterRef: "provider",
  groundingPolicyRef: "policy",
  tools: [],
  retentionDays: 30,
  eligibleModelPatterns: ["embed"],
  retrievalProfiles: { default: { corpusRef: "enterprise-docs", mode: "hybrid" } },
};
const provider: ModelProviderAdapter = {
  adapterType: "openai-compatible",
  discoverModels: async () => [],
  getModelCapabilities: async () => ["embed"],
  generateStream: async function* () { yield ""; },
  embed: async () => [1, 2],
  health: async () => true,
  normalizeError: () => ({ code: "DEPENDENCY_UNAVAILABLE", retryable: true }),
  meterUsage: (text) => text.length,
};

describe("ingestion content retrieval", () => {
  it("persists real chunk text through the production commit path", async () => {
    const retrieval = createRetrievalDeployment({ index: { search: () => [] } });
    const ingestion = createIngestionDeployment({
      retrieval,
      provider,
      embeddingModel: "embed-v1",
      ragProfile,
      corpora: { "enterprise-docs": { indexProfile, ragProfileVersion: 1, ragProfileDigest: digest("rag-profile") } },
    });
    const text = "the quokka prefers rotational grazing";
    const versionRef = "quokka-guide@v1";
    const chunkRef = "quokka-guide-chunk-1";

    await ingestion.services.get("enterprise-docs")!.ingest({
      sourceId: "source",
      documentRef: "quokka-guide",
      version: "v1",
      versionRef,
      contentDigest: digest("document-content"),
      aclDigest: digest("acl"),
      classificationRef: "internal",
      parse: {
        status: "accepted",
        renditionDigest: digest("rendition"),
        chunks: [{ chunkRef, contentDigest: digest(text), text, citationAnchor: "page:1" }],
      },
    });

    const fetched = retrieval.contentStore.fetch({
      fence: "signed:ingestion-test",
      resources: [{ versionRef, chunkRef, contentHash: digest(text) }],
    });
    expect(fetched[0]?.text).toContain("the quokka prefers rotational grazing");
  });
});
