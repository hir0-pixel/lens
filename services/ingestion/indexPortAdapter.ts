import { PublicationAuthority, type IndexProfile } from "../retrieval/PublicationAuthority";
import { SovereignContentStore } from "../retrieval/SovereignContentStore";
import type { Classification } from "../governance/GovernanceAuthority";
import type { IndexPort, ParsedChunk } from "./IngestionService";
import { LexicalSearchIndex } from "../retrieval/LexicalSearchIndex";
import { VectorSearchIndex } from "../retrieval/VectorSearchIndex";

interface StagedWrite {
  versionRef: string;
  chunks: readonly ParsedChunk[];
  vectorsDigest: `sha256:${string}`;
  vectors: readonly (readonly number[])[];
  profileRef: string;
  classificationRef: Classification;
}

export class PublicationIndexPortAdapter implements IndexPort {
  private readonly staged = new Map<string, StagedWrite>();

  constructor(
    private readonly authority: PublicationAuthority,
    private readonly writerToken: number,
    private readonly indexProfile: IndexProfile,
    private readonly ragProfileVersion: number,
    private readonly ragProfileDigest: `sha256:${string}`,
    private readonly contentStore: SovereignContentStore,
    private readonly corpusRef: string,
    private readonly searchIndex: LexicalSearchIndex,
    private readonly vectorIndex: VectorSearchIndex,
  ) {}

  async writeGeneration(input: { generation: string; versionRef: string; chunks: readonly ParsedChunk[]; vectorsDigest: `sha256:${string}`; vectors: readonly (readonly number[])[]; profileRef: string; classificationRef: Classification }): Promise<void> {
    this.staged.set(input.generation, {
      versionRef: input.versionRef,
      chunks: input.chunks,
      vectorsDigest: input.vectorsDigest,
      vectors: input.vectors,
      profileRef: input.profileRef,
      classificationRef: input.classificationRef,
    });
  }

  async verifyGeneration(input: { generation: string; versionRef: string; vectorsDigest: `sha256:${string}`; profileRef: string }): Promise<{ verified: boolean; reason?: string }> {
    const staged = this.staged.get(input.generation);
    if (!staged) return { verified: false, reason: "NOT_STAGED" };
    if (staged.versionRef !== input.versionRef || staged.vectorsDigest !== input.vectorsDigest || staged.profileRef !== input.profileRef) {
      return { verified: false, reason: "STAGED_WRITE_MISMATCH" };
    }
    return { verified: true };
  }

  async commitGeneration(input: { documentRef: string; versionRef: string; generation: string; resourceSecurityRevision: number }): Promise<void> {
    const staged = this.staged.get(input.generation);
    if (!staged || staged.versionRef !== input.versionRef) {
      throw new Error("Cannot commit a generation that was not written and verified first.");
    }
    for (const [index, chunk] of staged.chunks.entries()) {
      this.contentStore.write({
        versionRef: input.versionRef,
        chunkRef: chunk.chunkRef,
        contentHash: chunk.contentDigest,
        text: chunk.text,
        citationAnchor: chunk.citationAnchor,
      });
      this.searchIndex.write({
        corpusRef: this.corpusRef,
        resourceRef: input.documentRef,
        versionRef: input.versionRef,
        chunkRef: chunk.chunkRef,
        contentHash: chunk.contentDigest,
        classificationRef: staged.classificationRef,
        text: chunk.text,
      });
      const vector = staged.vectors[index];
      if (!vector) throw new Error(`Missing vector for chunk ${chunk.chunkRef}.`);
      this.vectorIndex.write({ corpusRef: this.corpusRef, resourceRef: input.documentRef, versionRef: input.versionRef, chunkRef: chunk.chunkRef, contentHash: chunk.contentDigest, classificationRef: staged.classificationRef, vector });
    }
    const carried = this.authority.activeCandidateRefs().filter((ref) => ref.versionRef !== input.versionRef && this.authority.isSearchable(ref.versionRef));
    const own = staged.chunks.map((chunk) => ({
      versionRef: input.versionRef,
      chunkRef: chunk.chunkRef,
      contentHash: chunk.contentDigest,
      classificationRef: staged.classificationRef,
    }));
    const generationId = `publication:${input.generation}`;
    this.authority.beginGeneration(this.writerToken, generationId, this.indexProfile, this.ragProfileVersion, this.ragProfileDigest);
    for (const ref of [...carried, ...own]) this.authority.addCandidate(this.writerToken, generationId, ref);
    this.authority.finalize(this.writerToken, generationId);
    this.authority.publish(this.writerToken, generationId);
    this.staged.delete(input.generation);
  }

  async removeGeneration(input: { documentRef: string; versionRef: string; generation: string }): Promise<void> {
    this.authority.removeVersion(this.writerToken, input.versionRef);
    this.contentStore.removeVersion(input.versionRef);
    this.searchIndex.removeVersion(this.corpusRef, input.versionRef);
    this.vectorIndex.removeVersion(this.corpusRef, input.versionRef);
    this.staged.delete(input.generation);
  }
}
