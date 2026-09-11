export interface CorpusToolSource {
  documentVersionRef: string;
  chunkRef: string;
  contentDigest: `sha256:${string}`;
  citationAnchor: string;
  classificationRef: string;
}

export interface CorpusToolDetails {
  corpusRef: string;
  resourceRefs: readonly string[];
  sources: readonly CorpusToolSource[];
}
