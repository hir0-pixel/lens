import type { Classification } from "../governance/GovernanceAuthority";
import type { SearchIndexEntry } from "./ProductionRetrievalWiring";

type VectorEntry = Omit<SearchIndexEntry, "lexicalScore" | "vectorScore" | "graphScore" | "metadataScore"> & { corpusRef: string; vector: readonly number[] };

export class VectorSearchIndex {
  private readonly entries = new Map<string, VectorEntry>();

  // ponytail: brute-force cosine scan over an in-memory map, no ANN index; upgrade to a real vector store if corpus size demands it.
  write(entry: { corpusRef: string; resourceRef: string; versionRef: string; chunkRef: string; contentHash: `sha256:${string}`; classificationRef: Classification; vector: readonly number[] }): void {
    this.entries.set(`${entry.corpusRef}|${entry.versionRef}|${entry.chunkRef}`, entry);
  }

  removeVersion(corpusRef: string, versionRef: string): void {
    for (const key of this.entries.keys()) if (key.startsWith(`${corpusRef}|${versionRef}|`)) this.entries.delete(key);
  }

  hasEntries(corpusRef: string): boolean {
    return [...this.entries.values()].some((entry) => entry.corpusRef === corpusRef);
  }

  search(input: { corpusRef: string; queryVector: readonly number[]; laneLimit: number }): readonly SearchIndexEntry[] {
    const queryMagnitude = Math.sqrt(input.queryVector.reduce((sum, value) => sum + value * value, 0));
    return [...this.entries.values()]
      .filter((entry) => entry.corpusRef === input.corpusRef)
      .map((entry) => {
        const entryMagnitude = Math.sqrt(entry.vector.reduce((sum, value) => sum + value * value, 0));
        const dot = entry.vector.reduce((sum, value, index) => sum + value * (input.queryVector[index] ?? 0), 0);
        const similarity = queryMagnitude === 0 || entryMagnitude === 0 ? 0 : dot / (queryMagnitude * entryMagnitude);
        return {
          resourceRef: entry.resourceRef,
          versionRef: entry.versionRef,
          chunkRef: entry.chunkRef,
          contentHash: entry.contentHash,
          classificationRef: entry.classificationRef,
          lexicalScore: Number.NaN,
          vectorScore: 1 - similarity,
          graphScore: Number.NaN,
          metadataScore: Number.NaN,
        } satisfies SearchIndexEntry;
      })
      .sort((a, b) => a.vectorScore - b.vectorScore)
      .slice(0, input.laneLimit);
  }
}
