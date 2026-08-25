import { describe, expect, it } from "vitest";
import { VectorSearchIndex } from "../../services/retrieval/VectorSearchIndex";
import { simpleHash } from "../../services/retrieval/indexGenerationManifest";

const digest = (value: string): `sha256:${string}` => `sha256:${simpleHash(value)}`;

describe("vector search index", () => {
  it("ranks cosine-nearest entries and removes a version", () => {
    const index = new VectorSearchIndex();
    const base = { corpusRef: "docs", resourceRef: "doc", contentHash: digest("x"), classificationRef: "public" as const };
    index.write({ ...base, versionRef: "v1", chunkRef: "near", vector: [1, 0] });
    index.write({ ...base, versionRef: "v1", chunkRef: "far", vector: [0, 1] });
    expect(index.hasEntries("docs")).toBe(true);
    expect(index.search({ corpusRef: "docs", queryVector: [1, 0], laneLimit: 2 }).map((entry) => entry.chunkRef)).toEqual(["near", "far"]);
    index.removeVersion("docs", "v1");
    expect(index.hasEntries("docs")).toBe(false);
  });
});
