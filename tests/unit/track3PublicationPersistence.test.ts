import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PublicationAuthority, PublicationError } from "../../services/retrieval/PublicationAuthority";
import { PublicationStore } from "../../services/retrieval/publicationStore";
import { simpleHash, type IndexProfile } from "../../services/retrieval/indexGenerationManifest";

const profile: IndexProfile = {
  embeddingModelDigest: `sha256:${"a".repeat(64)}`,
  tokenizerDigest: `sha256:${"b".repeat(64)}`,
  vectorDimensions: 768,
  distanceMetric: "cosine",
  chunkingProfile: "markdown-headings",
  schemaVersion: "rag-v1",
};
const hash = (value: string): `sha256:${string}` => `sha256:${simpleHash(value)}`;
const candidate = (versionRef: string, chunkRef: string) => ({ versionRef, chunkRef, contentHash: hash(chunkRef), classificationRef: "internal" as const });

function withStore(run: (store: PublicationStore) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "lens-publication-"));
  const store = new PublicationStore(join(directory, "publication.sqlite"));
  try {
    run(store);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function publish(authority: PublicationAuthority, generationId: string, versionRef: string, writerToken = 5): void {
  authority.beginGeneration(writerToken, generationId, profile, 7, hash("rag-profile-v7"));
  authority.addCandidate(writerToken, generationId, candidate(versionRef, `${generationId}-chunk`));
  authority.finalize(writerToken, generationId);
  authority.publish(writerToken, generationId);
}

describe("Track 3 durable publication authority", () => {
  it("rehydrates a published generation exactly into an independent authority", () => withStore((store) => {
    const first = new PublicationAuthority("enterprise-docs", () => 1_000, store);
    publish(first, "gen-1", "v1");

    const reloaded = new PublicationAuthority("enterprise-docs", () => 1_000, store);
    expect(reloaded.snapshot()).toEqual(first.snapshot());
    expect(reloaded.state()).toEqual(first.state());
  }));

  it("preserves a crash-mid-generation build and all of its candidates", () => withStore((store) => {
    const first = new PublicationAuthority("enterprise-docs", () => 1_000, store);
    first.beginGeneration(5, "gen-building", profile, 7, hash("rag-profile-v7"));
    first.addCandidate(5, "gen-building", candidate("v1", "c1"));
    first.addCandidate(5, "gen-building", candidate("v2", "c2"));

    new PublicationAuthority("enterprise-docs", () => 1_000, store);
    expect(store.load("enterprise-docs").generations).toEqual([expect.objectContaining({
      generationId: "gen-building", state: "building", candidateRefs: [candidate("v1", "c1"), candidate("v2", "c2")],
    })]);
  }));

  it("retains writer fencing across an authority restart", () => withStore((store) => {
    const first = new PublicationAuthority("enterprise-docs", () => 1_000, store);
    first.beginGeneration(5, "gen-1", profile, 7, hash("rag-profile-v7"));

    const reloaded = new PublicationAuthority("enterprise-docs", () => 1_000, store);
    let error: unknown;
    try {
      reloaded.addCandidate(6, "gen-1", candidate("v1", "c1"));
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: "STALE_AUTHORITY" });
  }));

  it("restores the last retired generation after restart", () => withStore((store) => {
    const first = new PublicationAuthority("enterprise-docs", () => 1_000, store);
    publish(first, "gen-1", "v1");
    publish(first, "gen-2", "v2");

    const reloaded = new PublicationAuthority("enterprise-docs", () => 2_000, store);
    const restored = reloaded.rollback(5);
    expect(restored).toMatchObject({ indexGeneration: "gen-1", searchableVersionRefs: ["v1"], visibilitySequence: 3 });
    expect(reloaded.isSearchable("v2")).toBe(false);
  }));

  it("fails closed when a store-backed authority has an unavailable database path", () => {
    const missingPath = join(tmpdir(), `lens-publication-missing-${Date.now()}`, "publication.sqlite");
    expect(() => new PublicationAuthority("enterprise-docs", () => 1_000, new PublicationStore(missingPath))).toThrow();
  });

  it("continues to support the in-memory-only authority path", () => {
    const authority = new PublicationAuthority("enterprise-docs", () => 1_000);
    publish(authority, "gen-1", "v1", 1);
    expect(authority.snapshot()).toMatchObject({ indexGeneration: "gen-1", searchableVersionRefs: ["v1"] });
    expect(() => authority.beginGeneration(2, "gen-2", profile, 7, hash("rag-profile-v7"))).toThrow(PublicationError);
  });
});
