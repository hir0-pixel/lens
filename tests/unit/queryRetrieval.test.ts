import { describe, expect, it } from "vitest";
import { createIngestionDeployment } from "../../services/ingestion";
import type { ModelProviderAdapter } from "../../services/model-provider/ProviderAdapter";
import type { CompanyRagProfile } from "../../services/rag-profile/companyRagProfile";
import { createRetrievalDeployment } from "../../services/retrieval/ProductionRetrievalWiring";
import { simpleHash } from "../../services/retrieval/indexGenerationManifest";
import type { IndexProfile } from "../../services/retrieval/PublicationAuthority";

const digest = (value: string): `sha256:${string}` => `sha256:${simpleHash(value)}`;
const indexProfile: IndexProfile = { embeddingModelDigest: digest("embedding"), tokenizerDigest: digest("tokenizer"), vectorDimensions: 2, distanceMetric: "cosine", chunkingProfile: "test", schemaVersion: "rag-v1" };
const ragProfile: CompanyRagProfile = { profileVersion: 1, companyId: "company", corpora: ["enterprise-docs"], connectors: [], chunking: { maxTokens: 100, overlapTokens: 10 }, embeddingAdapterRef: "provider", groundingPolicyRef: "policy", tools: [], retentionDays: 30, eligibleModelPatterns: ["embed"], retrievalProfiles: { default: { corpusRef: "enterprise-docs", mode: "hybrid" } } };
const provider: ModelProviderAdapter = { adapterType: "openai-compatible", discoverModels: async () => [], getModelCapabilities: async () => ["embed"], generateStream: async function* () { yield ""; }, embed: async () => [1, 2], health: async () => true, normalizeError: () => ({ code: "DEPENDENCY_UNAVAILABLE", retryable: true }), meterUsage: (text) => text.length };

const request = (queryText: string) => ({ request_id: `req-${queryText}`, turn_id: "turn-1", caller_workload_ref: "ai-orchestrator" as const, subject_ref: "employee", session_ref: "session", device_ref: "device", application_id: "lens-employee-client" as const, query_digest: digest(queryText), query_text: queryText, purpose_ref: "policy-help", retrieval_class: "enterprise-grounded" as const, corpus_ref: "enterprise-docs", mode: "lexical" as const, profile_version: 1, profile_digest: digest("rag-profile"), candidate_limit: 10, deadline_at: Date.now() + 10_000, cancellation: false, bulkhead: "interactive" as const, visibility_minimum: 0 });

describe("query-side lexical retrieval", () => {
  it("returns grounded matches and no context for unrelated terms", async () => {
    const profileDigest = digest("rag-profile");
    const retrieval = createRetrievalDeployment({ provider, embeddingModel: "embed-v1", publicationProfiles: { "enterprise-docs": { profile: indexProfile, ragProfileVersion: 1, ragProfileDigest: profileDigest } } });
    const ingestion = createIngestionDeployment({ retrieval, provider, embeddingModel: "embed-v1", ragProfile, corpora: { "enterprise-docs": { indexProfile, ragProfileVersion: 1, ragProfileDigest: profileDigest } } });
    retrieval.activatePolicy();
    retrieval.governance.registerVersion({ documentVersionRef: "enterprise-docs", classification: "internal", aclDigest: digest("corpus-acl") });
    retrieval.governance.mutateSecurity("enterprise-docs", { processing: "indexed", integrity: "valid", publication: "active" }, { fenceId: "fence-enterprise-docs", actorRef: "governance", approverRef: "platform", expiresAt: Date.now() + 3600_000 });
    const versionRef = "security-guide@v1";
    retrieval.governance.registerVersion({ documentVersionRef: "security-guide", classification: "internal", aclDigest: digest("document-acl") });
    retrieval.governance.mutateSecurity("security-guide", { processing: "indexed", integrity: "valid", publication: "active" }, { fenceId: "fence-security-guide", actorRef: "governance", approverRef: "platform", expiresAt: Date.now() + 3600_000 });
    const text = "Employees must complete security awareness training every twelve months.";
    await ingestion.services.get("enterprise-docs")!.ingest({ sourceId: "source", documentRef: "security-guide", version: "v1", versionRef, contentDigest: digest("document"), aclDigest: digest("acl"), classificationRef: "internal", parse: { status: "accepted", renditionDigest: digest("rendition"), chunks: [{ chunkRef: "security-chunk-1", contentDigest: digest(text), text, citationAnchor: "page:1" }] } });

    expect(retrieval.governance.getResourceSecurityFacts([versionRef])[0]?.retrievalEligible).toBe(true);
    expect(retrieval.searchIndex.search({ corpusRef: "enterprise-docs", queryText: "What must employees complete every twelve months?", laneLimit: 10 })).toHaveLength(1);
    const result = await retrieval.service.retrieve(request("What must employees complete every twelve months?"));
    expect(result.status).toBe("context");
    if (result.status === "context") expect(result.sources.some((source) => source.text.includes(text))).toBe(true);
    expect((await retrieval.service.retrieve(request("banana smoothie recipe"))).status).toBe("no_context");
  });
});
