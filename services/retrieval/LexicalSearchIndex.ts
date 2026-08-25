import type { Classification } from "../governance/GovernanceAuthority";
import type { SearchIndexEntry } from "./ProductionRetrievalWiring";

type LexicalEntry = Omit<SearchIndexEntry, "lexicalScore" | "vectorScore" | "graphScore" | "metadataScore"> & { corpusRef: string; text: string };

export class LexicalSearchIndex {
  private readonly entries = new Map<string, LexicalEntry>();

  // ponytail: naive term-overlap scoring, not BM25/vector similarity; upgrade by replacing with a real ranker or external search service.
  write(entry: { corpusRef: string; resourceRef: string; versionRef: string; chunkRef: string; contentHash: `sha256:${string}`; classificationRef: Classification; text: string }): void {
    this.entries.set(`${entry.corpusRef}|${entry.versionRef}|${entry.chunkRef}`, entry);
  }

  removeVersion(corpusRef: string, versionRef: string): void {
    for (const key of this.entries.keys()) if (key.startsWith(`${corpusRef}|${versionRef}|`)) this.entries.delete(key);
  }

  search(input: { corpusRef: string; queryText: string; laneLimit: number }): readonly SearchIndexEntry[] {
    const queryTokens = new Set(input.queryText.toLowerCase().split(/\W+/).filter(Boolean));
    if (queryTokens.size === 0) return [];
    return [...this.entries.values()]
      .filter((entry) => entry.corpusRef === input.corpusRef)
      .map((entry) => {
        const tokens = new Set(entry.text.toLowerCase().split(/\W+/).filter(Boolean));
        const shared = [...queryTokens].filter((token) => tokens.has(token)).length;
        return shared === 0 ? undefined : {
          resourceRef: entry.resourceRef,
          versionRef: entry.versionRef,
          chunkRef: entry.chunkRef,
          contentHash: entry.contentHash,
          classificationRef: entry.classificationRef,
          lexicalScore: 1 - shared / queryTokens.size,
          vectorScore: Number.NaN,
          graphScore: Number.NaN,
          metadataScore: Number.NaN,
        } satisfies SearchIndexEntry;
      })
      .filter((entry): entry is SearchIndexEntry => entry !== undefined)
      .sort((a, b) => a.lexicalScore - b.lexicalScore)
      .slice(0, input.laneLimit);
  }
}
