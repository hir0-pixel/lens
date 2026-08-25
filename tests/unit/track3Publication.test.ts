import { describe, expect, it } from "vitest";
import { PublicationAuthority, PublicationAuthorityRegistry, PublicationError } from "../../services/retrieval/PublicationAuthority";
import { SovereignContentStore, ContentIntegrityError } from "../../services/retrieval/SovereignContentStore";
import { assertIndexProfile, computeCandidateRefsDigest, simpleHash, type IndexProfile } from "../../services/retrieval/indexGenerationManifest";

const profile: IndexProfile = {
  embeddingModelDigest: `sha256:${"a".repeat(64)}`,
  tokenizerDigest: `sha256:${"b".repeat(64)}`,
  vectorDimensions: 768,
  distanceMetric: "cosine",
  chunkingProfile: "markdown-headings",
  schemaVersion: "rag-v1",
};

const hash = (prefix: string): `sha256:${string}` => `sha256:${simpleHash(prefix)}`;
const ragProfileVersion = 1;
const ragProfileDigest = hash("company-rag-profile-v1");

describe("Track 3 index/content separation", () => {
  it("rejects an index profile that is not pinned to an embedding model digest", () => {
    expect(() => assertIndexProfile({ ...profile, embeddingModelDigest: "mdl-v1" })).toThrow();
  });

  it("rejects an index profile with an invalid vector geometry or metric", () => {
    expect(() => assertIndexProfile({ ...profile, vectorDimensions: 0 })).toThrow();
    expect(() => assertIndexProfile({ ...profile, distanceMetric: "hamming" as never })).toThrow();
  });

  it("computes a deterministic candidate-refs digest that changes when content changes", () => {
    const a = computeCandidateRefsDigest([{ versionRef: "v1", chunkRef: "c1", contentHash: hash("c1"), classificationRef: "internal" }]);
    const b = computeCandidateRefsDigest([{ versionRef: "v1", chunkRef: "c1", contentHash: hash("c2"), classificationRef: "internal" }]);
    expect(a).toMatch(/^sha256:/);
    expect(a).not.toBe(b);
  });
});

describe("Track 3 sovereign content store", () => {
  it("stores immutable chunk content keyed by content hash and serves it only via an exact reference", () => {
    const store = new SovereignContentStore();
    store.write({ versionRef: "v1", chunkRef: "c1", contentHash: hash("alpha"), text: "alpha", citationAnchor: "p1" });
    const served = store.fetch({ fence: "signed:fence-1", resources: [{ versionRef: "v1", chunkRef: "c1", contentHash: hash("alpha") }] });
    expect(served).toHaveLength(1);
    expect(served[0].text).toBe("alpha");
  });

  it("never serves content whose digest does not match its declared hash (no text, no mismatched bytes)", () => {
    const store = new SovereignContentStore();
    store.write({ versionRef: "v1", chunkRef: "c1", contentHash: hash("alpha"), text: "alpha", citationAnchor: "p1" });
    expect(() => store.fetch({ fence: "signed:fence-1", resources: [{ versionRef: "v1", chunkRef: "c1", contentHash: hash("WRONG") }] })).toThrow(ContentIntegrityError);
  });

  it("quarantines a chunk whose stored text does not match its content hash and refuses to write it", () => {
    const store = new SovereignContentStore();
    expect(() => store.write({ versionRef: "v1", chunkRef: "c1", contentHash: hash("alpha"), text: "tampered", citationAnchor: "p1" })).toThrow(ContentIntegrityError);
  });

  it("stops serving a quarantined chunk", () => {
    const store = new SovereignContentStore();
    store.write({ versionRef: "v1", chunkRef: "c1", contentHash: hash("alpha"), text: "alpha", citationAnchor: "p1" });
    store.quarantineChunk("v1", "c1");
    expect(() => store.fetch({ fence: "signed:fence-1", resources: [{ versionRef: "v1", chunkRef: "c1", contentHash: hash("alpha") }] })).toThrow(ContentIntegrityError);
  });

  it("makes removed versions unretrievable (removed documents do not remain retrievable)", () => {
    const store = new SovereignContentStore();
    store.write({ versionRef: "v1", chunkRef: "c1", contentHash: hash("alpha"), text: "alpha", citationAnchor: "p1" });
    store.removeVersion("v1");
    expect(() => store.fetch({ fence: "signed:fence-1", resources: [{ versionRef: "v1", chunkRef: "c1", contentHash: hash("alpha") }] })).toThrow(ContentIntegrityError);
    expect(store.verify("c1", hash("alpha"))).toBe(false);
  });
});

describe("Track 3 independent publication authority", () => {
  const build = () => new PublicationAuthority("enterprise-docs", () => 1_000);

  it("rejects invalid or missing RAG profile lineage when beginning a generation", () => {
    const authority = build();
    expect(() => authority.beginGeneration(1, "bad-version", profile, 0, ragProfileDigest)).toThrow();
    expect(() => authority.beginGeneration(1, "unsafe-version", profile, Number.MAX_SAFE_INTEGER + 1, ragProfileDigest)).toThrow();
    expect(() => authority.beginGeneration(1, "bad-digest", profile, 1, "sha256:not-a-digest" as `sha256:${string}`)).toThrow();
    expect(() => authority.beginGeneration(1, "missing-version", profile, undefined as never, ragProfileDigest)).toThrow();
  });

  it("builds an inactive generation, validates it, then atomically publishes with a monotonic visibility_sequence", () => {
    const authority = build();
    authority.beginGeneration(1, "gen-1", profile, ragProfileVersion, ragProfileDigest);
    authority.addCandidate(1, "gen-1", { versionRef: "v1", chunkRef: "c1", contentHash: hash("c1"), classificationRef: "internal" });
    const finalized = authority.finalize(1, "gen-1");
    const published = authority.publish(1, "gen-1");
    const active = authority.snapshot();
    expect(finalized).toMatchObject({ ragProfileVersion, ragProfileDigest });
    expect(published).toMatchObject({ ragProfileVersion, ragProfileDigest });
    expect(active.indexGeneration).toBe("gen-1");
    expect(active.visibilitySequence).toBe(1);
    expect(active.searchableVersionRefs).toEqual(["v1"]);
    expect(active.profile.embeddingModelDigest).toBe(profile.embeddingModelDigest);
    expect(active.ragProfileVersion).toBe(ragProfileVersion);
    expect(active.ragProfileDigest).toBe(ragProfileDigest);
  });

  it("returns no active candidates before publish and the exact candidate list after publish", () => {
    const authority = build();
    expect(authority.activeCandidateRefs()).toEqual([]);
    const candidate = { versionRef: "v1", chunkRef: "c1", contentHash: hash("c1"), classificationRef: "internal" as const };
    authority.beginGeneration(1, "gen-1", profile, ragProfileVersion, ragProfileDigest);
    authority.addCandidate(1, "gen-1", candidate);
    authority.finalize(1, "gen-1");
    authority.publish(1, "gen-1");
    expect(authority.activeCandidateRefs()).toEqual([candidate]);
  });

  it("never mutates the active generation in place; cutover retires the prior generation in one step", () => {
    const authority = build();
    authority.beginGeneration(1, "gen-1", profile, ragProfileVersion, ragProfileDigest);
    authority.addCandidate(1, "gen-1", { versionRef: "v1", chunkRef: "c1", contentHash: hash("c1"), classificationRef: "internal" });
    authority.finalize(1, "gen-1");
    authority.publish(1, "gen-1");

    authority.beginGeneration(1, "gen-2", profile, ragProfileVersion, ragProfileDigest);
    authority.addCandidate(1, "gen-2", { versionRef: "v2", chunkRef: "c2", contentHash: hash("c2"), classificationRef: "internal" });
    authority.finalize(1, "gen-2");
    authority.publish(1, "gen-2");

    const active = authority.snapshot();
    expect(active.indexGeneration).toBe("gen-2");
    expect(active.visibilitySequence).toBe(2);
    expect(active.searchableVersionRefs).toEqual(["v2"]);
    // The prior active generation is retired, not partially visible.
    expect(authority.isSearchable("v1")).toBe(false);
    expect(authority.isSearchable("v2")).toBe(true);
  });

  it("prevents a stale index hint from granting access (version outside the active searchable set is dropped)", () => {
    const authority = build();
    authority.beginGeneration(1, "gen-1", profile, ragProfileVersion, ragProfileDigest);
    authority.addCandidate(1, "gen-1", { versionRef: "v1", chunkRef: "c1", contentHash: hash("c1"), classificationRef: "internal" });
    authority.finalize(1, "gen-1");
    authority.publish(1, "gen-1");

    // A stale hint for v-old must never resolve to a searchable candidate.
    expect(authority.isSearchable("v-old")).toBe(false);
  });

  it("cannot publish an unfinalized or empty generation", () => {
    const authority = build();
    authority.beginGeneration(1, "gen-1", profile, ragProfileVersion, ragProfileDigest);
    expect(() => authority.finalize(1, "gen-1")).toThrow(PublicationError);
    authority.addCandidate(1, "gen-1", { versionRef: "v1", chunkRef: "c1", contentHash: hash("c1"), classificationRef: "internal" });
    expect(() => authority.publish(1, "gen-1")).toThrow(PublicationError);
  });

  it("enforces the single-author writer: a stale writer token is rejected", () => {
    const authority = build();
    authority.beginGeneration(1, "gen-1", profile, ragProfileVersion, ragProfileDigest);
    expect(() => authority.beginGeneration(2, "gen-x", profile, ragProfileVersion, ragProfileDigest)).toThrow(PublicationError);
    expect(() => authority.addCandidate(2, "gen-1", { versionRef: "v1", chunkRef: "c1", contentHash: hash("c1"), classificationRef: "internal" })).toThrow(PublicationError);
  });

  it("rolls back to the last retired generation and bumps the visibility_sequence (rollback under concurrency)", () => {
    const authority = build();
    authority.beginGeneration(1, "gen-1", profile, ragProfileVersion, ragProfileDigest);
    authority.addCandidate(1, "gen-1", { versionRef: "v1", chunkRef: "c1", contentHash: hash("c1"), classificationRef: "internal" });
    authority.finalize(1, "gen-1");
    authority.publish(1, "gen-1");

    const newerRagProfileDigest = hash("company-rag-profile-v2");
    authority.beginGeneration(1, "gen-2", profile, 2, newerRagProfileDigest);
    authority.addCandidate(1, "gen-2", { versionRef: "v2", chunkRef: "c2", contentHash: hash("c2"), classificationRef: "internal" });
    authority.finalize(1, "gen-2");
    authority.publish(1, "gen-2");
    expect(authority.snapshot().searchableVersionRefs).toEqual(["v2"]);

    const restored = authority.rollback(1);
    expect(restored.indexGeneration).toBe("gen-1");
    expect(restored.visibilitySequence).toBe(3);
    expect(restored.searchableVersionRefs).toEqual(["v1"]);
    expect(restored.ragProfileVersion).toBe(ragProfileVersion);
    expect(restored.ragProfileDigest).toBe(ragProfileDigest);
    // The rolled-forward generation is no longer searchable.
    expect(authority.isSearchable("v2")).toBe(false);
    expect(authority.isSearchable("v1")).toBe(true);
  });

  it("routes configured corpora to their own active generations and rejects unconfigured corpora", () => {
    const hr = new PublicationAuthority("hr", () => 1_000);
    const sales = new PublicationAuthority("sales", () => 1_000);
    for (const [authority, generationId, versionRef, lineageVersion, lineageDigest] of [
      [hr, "hr-gen", "hr-v1", 1, hash("hr-profile")],
      [sales, "sales-gen", "sales-v1", 2, hash("sales-profile")],
    ] as const) {
      authority.beginGeneration(1, generationId, profile, lineageVersion, lineageDigest);
      authority.addCandidate(1, generationId, { versionRef, chunkRef: `${versionRef}-chunk`, contentHash: hash(versionRef), classificationRef: "internal" });
      authority.finalize(1, generationId);
      authority.publish(1, generationId);
    }
    const registry = new PublicationAuthorityRegistry(new Map([["hr", hr], ["sales", sales]]));
    expect(registry.activeGeneration({ corpusRef: "hr", deadlineAt: 2_000 }).ragProfileVersion).toBe(1);
    expect(registry.activeGeneration({ corpusRef: "sales", deadlineAt: 2_000 }).ragProfileVersion).toBe(2);
    expect(() => registry.activeGeneration({ corpusRef: "typo", deadlineAt: 2_000 })).toThrow(PublicationError);
  });

  it("removes a version from the active searchable set without mutating the generation manifest", () => {
    const authority = build();
    authority.beginGeneration(1, "gen-1", profile, ragProfileVersion, ragProfileDigest);
    authority.addCandidate(1, "gen-1", { versionRef: "v1", chunkRef: "c1", contentHash: hash("c1"), classificationRef: "internal" });
    authority.addCandidate(1, "gen-1", { versionRef: "v2", chunkRef: "c2", contentHash: hash("c2"), classificationRef: "internal" });
    authority.finalize(1, "gen-1");
    authority.publish(1, "gen-1");

    authority.removeVersion(1, "v1");
    expect(authority.isSearchable("v1")).toBe(false);
    expect(authority.isSearchable("v2")).toBe(true);
  });

  it("keeps a retired generation from ever becoming searchable again after deletion", () => {
    const authority = build();
    authority.beginGeneration(1, "gen-1", profile, ragProfileVersion, ragProfileDigest);
    authority.addCandidate(1, "gen-1", { versionRef: "v1", chunkRef: "c1", contentHash: hash("c1"), classificationRef: "internal" });
    authority.finalize(1, "gen-1");
    authority.publish(1, "gen-1");
    authority.beginGeneration(1, "gen-2", profile, ragProfileVersion, ragProfileDigest);
    authority.addCandidate(1, "gen-2", { versionRef: "v2", chunkRef: "c2", contentHash: hash("c2"), classificationRef: "internal" });
    authority.finalize(1, "gen-2");
    authority.publish(1, "gen-2");
    authority.removeVersion(1, "v1");
    authority.rollback(1);
    expect(authority.isSearchable("v1")).toBe(false);
  });
});
