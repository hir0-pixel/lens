import { describe, expect, it } from "vitest";
import { PublicationAuthority } from "../../services/retrieval/PublicationAuthority";
import { simpleHash, type IndexProfile } from "../../services/retrieval/indexGenerationManifest";
import { PublicationIndexPortAdapter, ProviderEmbeddingPortAdapter } from "../../services/ingestion";
import { SovereignContentStore } from "../../services/retrieval/SovereignContentStore";
import { LexicalSearchIndex } from "../../services/retrieval/LexicalSearchIndex";
import { VectorSearchIndex } from "../../services/retrieval/VectorSearchIndex";
import type { ModelProviderAdapter } from "../../services/model-provider/ProviderAdapter";
import type { ParsedChunk } from "../../services/ingestion";

const digest = (value: string): `sha256:${string}` => `sha256:${simpleHash(value)}`;
const profile: IndexProfile = {
  embeddingModelDigest: digest("model"),
  tokenizerDigest: digest("tokenizer"),
  vectorDimensions: 3,
  distanceMetric: "cosine",
  chunkingProfile: "test",
  schemaVersion: "rag-v1",
};
const chunk = (chunkRef: string, content: string): ParsedChunk => ({ chunkRef, contentDigest: digest(content), text: content, citationAnchor: `p:${chunkRef}` });

function stage(adapter: PublicationIndexPortAdapter, generation: string, versionRef: string, chunks: readonly ParsedChunk[]) {
  return adapter.writeGeneration({ generation, versionRef, chunks, vectorsDigest: digest(`${generation}:vectors`), vectors: chunks.map(() => [1, 0]), profileRef: "profile-v1", classificationRef: "internal" });
}

function provider(overrides: Partial<ModelProviderAdapter> = {}): ModelProviderAdapter {
  return {
    adapterType: "openai-compatible",
    discoverModels: async () => [],
    getModelCapabilities: async () => ["embed"],
    generateStream: async function* () { yield ""; },
    health: async () => true,
    normalizeError: () => ({ code: "DEPENDENCY_UNAVAILABLE", retryable: true }),
    meterUsage: (text) => text.length,
    ...overrides,
  };
}

describe("ingestion port adapters", () => {
  it("carries forward other versions and replaces only the committing version", async () => {
    const authority = new PublicationAuthority("enterprise-docs");
    const adapter = new PublicationIndexPortAdapter(authority, 1, profile, 1, digest("rag-profile"), new SovereignContentStore(), "enterprise-docs", new LexicalSearchIndex(), new VectorSearchIndex());

    await stage(adapter, "gen-a-1", "version-a", [chunk("a-1", "old-a"), chunk("a-2", "old-a-2")]);
    expect((await adapter.verifyGeneration({ generation: "gen-a-1", versionRef: "version-a", vectorsDigest: digest("gen-a-1:vectors"), profileRef: "profile-v1" })).verified).toBe(true);
    await adapter.commitGeneration({ documentRef: "doc-a", versionRef: "version-a", generation: "gen-a-1", resourceSecurityRevision: 1 });
    expect(authority.isSearchable("version-a")).toBe(true);

    await stage(adapter, "gen-b-1", "version-b", [chunk("b-1", "b")]);
    expect((await adapter.verifyGeneration({ generation: "gen-b-1", versionRef: "version-b", vectorsDigest: digest("gen-b-1:vectors"), profileRef: "profile-v1" })).verified).toBe(true);
    await adapter.commitGeneration({ documentRef: "doc-b", versionRef: "version-b", generation: "gen-b-1", resourceSecurityRevision: 1 });
    expect(authority.isSearchable("version-a")).toBe(true);
    expect(authority.isSearchable("version-b")).toBe(true);

    await stage(adapter, "gen-a-2", "version-a", [chunk("a-new", "new-a")]);
    expect((await adapter.verifyGeneration({ generation: "gen-a-2", versionRef: "version-a", vectorsDigest: digest("gen-a-2:vectors"), profileRef: "profile-v1" })).verified).toBe(true);
    await adapter.commitGeneration({ documentRef: "doc-a", versionRef: "version-a", generation: "gen-a-2", resourceSecurityRevision: 2 });
    expect(authority.activeCandidateRefs().filter((ref) => ref.versionRef === "version-a")).toEqual([
      { versionRef: "version-a", chunkRef: "a-new", contentHash: digest("new-a"), classificationRef: "internal" },
    ]);
    expect(authority.isSearchable("version-b")).toBe(true);
  });

  it("rejects committing an unstaged generation and removes only the requested version", async () => {
    const authority = new PublicationAuthority("enterprise-docs");
    const adapter = new PublicationIndexPortAdapter(authority, 1, profile, 1, digest("rag-profile"), new SovereignContentStore(), "enterprise-docs", new LexicalSearchIndex(), new VectorSearchIndex());
    await expect(adapter.commitGeneration({ documentRef: "doc-a", versionRef: "version-a", generation: "missing", resourceSecurityRevision: 1 })).rejects.toThrow("not written and verified");
    await stage(adapter, "gen-a", "version-a", [chunk("a", "a")]);
    await adapter.commitGeneration({ documentRef: "doc-a", versionRef: "version-a", generation: "gen-a", resourceSecurityRevision: 1 });
    await stage(adapter, "gen-b", "version-b", [chunk("b", "b")]);
    await adapter.commitGeneration({ documentRef: "doc-b", versionRef: "version-b", generation: "gen-b", resourceSecurityRevision: 1 });
    await adapter.removeGeneration({ documentRef: "doc-a", versionRef: "version-a", generation: "gen-a" });
    expect(authority.isSearchable("version-a")).toBe(false);
    expect(authority.isSearchable("version-b")).toBe(true);
  });

  it("embeds chunk text and returns a deterministic digest", async () => {
    const calls: Array<{ model: string; text: string }> = [];
    const fake = provider({ embed: async (input) => { calls.push(input); return input.text === "a" ? [1, 2] : [3, 4]; } });
    const adapter = new ProviderEmbeddingPortAdapter(fake, "embedding-v1");
    const input = { versionRef: "version-a", chunks: [chunk("a", "a"), chunk("b", "b")], profileRef: "profile-v1" };
    const first = await adapter.embed(input);
    const second = await adapter.embed(input);
    expect(first).toEqual({ profileRef: "profile-v1", vectorsDigest: first.vectorsDigest, vectors: [[1, 2], [3, 4]] });
    expect(first).toEqual(second);
    expect(calls).toHaveLength(4);
    expect(calls[0]).toEqual({ model: "embedding-v1", text: "a" });
  });

  it("fails clearly when the provider does not support embedding", async () => {
    const adapter = new ProviderEmbeddingPortAdapter(provider({ embed: undefined }), "embedding-v1");
    await expect(adapter.embed({ versionRef: "version-a", chunks: [chunk("a", "a")], profileRef: "profile-v1" })).rejects.toThrow('Provider adapter "openai-compatible" does not support embedding.');
  });
});
