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

const request = (queryText: string, overrides: { subject_ref?: string; mode?: "lexical" | "semantic" | "hybrid" } = {}) => ({
  request_id: `req-${queryText}-${overrides.subject_ref ?? "employee"}`,
  turn_id: "turn-1",
  caller_workload_ref: "ai-orchestrator" as const,
  subject_ref: overrides.subject_ref ?? "employee",
  session_ref: "session",
  device_ref: "device",
  application_id: "lens-employee-client" as const,
  query_digest: digest(queryText),
  query_text: queryText,
  purpose_ref: "policy-help",
  retrieval_class: "enterprise-grounded" as const,
  corpus_ref: "enterprise-docs",
  mode: overrides.mode ?? "lexical" as const,
  profile_version: 1,
  profile_digest: digest("rag-profile"),
  candidate_limit: 10,
  deadline_at: Date.now() + 10_000,
  cancellation: false,
  bulkhead: "interactive" as const,
  visibility_minimum: 0,
});

function deploy(subject?: (subjectRef: string) => { revision: number; active: boolean; groups: readonly string[] }) {
  const profileDigest = digest("rag-profile");
  const retrieval = createRetrievalDeployment({
    provider,
    embeddingModel: "embed-v1",
    publicationProfiles: { "enterprise-docs": { profile: indexProfile, ragProfileVersion: 1, ragProfileDigest: profileDigest } },
    ...(subject ? { subject } : {}),
  });
  const ingestion = createIngestionDeployment({
    retrieval,
    provider,
    embeddingModel: "embed-v1",
    ragProfile,
    corpora: { "enterprise-docs": { indexProfile, ragProfileVersion: 1, ragProfileDigest: profileDigest } },
  });
  retrieval.activatePolicy();
  retrieval.governance.registerVersion({ documentVersionRef: "enterprise-docs", classification: "internal", aclDigest: digest("corpus-acl") });
  retrieval.governance.mutateSecurity("enterprise-docs", { processing: "indexed", integrity: "valid", publication: "active" }, { fenceId: "fence-enterprise-docs", actorRef: "governance", approverRef: "platform", expiresAt: Date.now() + 3600_000 });
  return { retrieval, ingestion };
}

async function ingest(ingestion: ReturnType<typeof createIngestionDeployment>, input: { documentRef: string; version: string; versionRef: string; text: string; chunkRef: string }) {
  await ingestion.services.get("enterprise-docs")!.ingest({
    sourceId: "source",
    documentRef: input.documentRef,
    version: input.version,
    versionRef: input.versionRef,
    contentDigest: digest(input.versionRef),
    aclDigest: digest("acl"),
    classificationRef: "internal",
    parse: { status: "accepted", renditionDigest: digest(`${input.versionRef}:rendition`), chunks: [{ chunkRef: input.chunkRef, contentDigest: digest(input.text), text: input.text, citationAnchor: "page:1" }] },
  });
}

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

  it("publishes searchable refs without text, then replaces and withdraws old content", async () => {
    const { retrieval, ingestion } = deploy();
    retrieval.governance.registerVersion({ documentVersionRef: "quokka-guide", classification: "internal", aclDigest: digest("document-acl") });
    retrieval.governance.mutateSecurity("quokka-guide", { processing: "indexed", integrity: "valid", publication: "active" }, { fenceId: "fence-quokka-guide", actorRef: "governance", approverRef: "platform", expiresAt: Date.now() + 3600_000 });
    const v1 = { documentRef: "quokka-guide", version: "v1", versionRef: "quokka-guide@v1", text: "the quokka prefers rotational grazing", chunkRef: "quokka-v1" };
    await ingest(ingestion, v1);

    const hits = retrieval.searchIndex.search({ corpusRef: "enterprise-docs", queryText: "rotational grazing", laneLimit: 10 });
    expect(hits).toHaveLength(1);
    expect(hits[0]).not.toHaveProperty("text");
    expect(JSON.stringify(hits)).not.toContain("rotational grazing");
    expect(retrieval.contentStore.fetch({ fence: "signed:ingestion-test", resources: [{ versionRef: v1.versionRef, chunkRef: v1.chunkRef, contentHash: digest(v1.text) }] })[0]?.text).toContain("rotational grazing");
    expect(retrieval.publicationAuthority.isSearchable(v1.versionRef)).toBe(true);

    await ingest(ingestion, { documentRef: "quokka-guide", version: "v2", versionRef: "quokka-guide@v2", text: "the quokka now prefers paddock rest", chunkRef: "quokka-v2" });
    await ingestion.services.get("enterprise-docs")!.withdraw(v1.versionRef);

    expect(retrieval.searchIndex.search({ corpusRef: "enterprise-docs", queryText: "rotational grazing", laneLimit: 10 })).toHaveLength(0);
    expect(retrieval.searchIndex.search({ corpusRef: "enterprise-docs", queryText: "paddock rest", laneLimit: 10 })).toHaveLength(1);
    expect(retrieval.vectorIndex.hasEntries("enterprise-docs")).toBe(true);
    expect(retrieval.publicationAuthority.isSearchable(v1.versionRef)).toBe(false);
    expect(retrieval.publicationAuthority.isSearchable("quokka-guide@v2")).toBe(true);
    expect(() => retrieval.contentStore.fetch({ fence: "signed:ingestion-test", resources: [{ versionRef: v1.versionRef, chunkRef: v1.chunkRef, contentHash: digest(v1.text) }] })).toThrow();

    await ingestion.services.get("enterprise-docs")!.withdraw("quokka-guide@v2");
    expect(retrieval.publicationAuthority.isSearchable("quokka-guide@v2")).toBe(false);
    expect(retrieval.searchIndex.search({ corpusRef: "enterprise-docs", queryText: "paddock rest", laneLimit: 10 })).toHaveLength(0);
    expect(retrieval.vectorIndex.hasEntries("enterprise-docs")).toBe(false);
  });

  it("does not return ingested text to an unauthorized subject", async () => {
    const { retrieval, ingestion } = deploy((subjectRef) => ({ revision: 1, active: subjectRef !== "unauthorized", groups: [] }));
    retrieval.governance.registerVersion({ documentVersionRef: "quokka-guide", classification: "internal", aclDigest: digest("document-acl") });
    retrieval.governance.mutateSecurity("quokka-guide", { processing: "indexed", integrity: "valid", publication: "active" }, { fenceId: "fence-quokka-guide", actorRef: "governance", approverRef: "platform", expiresAt: Date.now() + 3600_000 });
    await ingest(ingestion, { documentRef: "quokka-guide", version: "v1", versionRef: "quokka-guide@v1", text: "the quokka prefers rotational grazing", chunkRef: "quokka-v1" });
    const denied = await retrieval.service.retrieve(request("What grazing does the quokka prefer?", { subject_ref: "unauthorized" }));
    expect(denied.status).toBe("denied_policy");
    expect(JSON.stringify(denied)).not.toContain("rotational grazing");
  });
});
