import { createHash } from "node:crypto";
import type { ModelProviderAdapter } from "../model-provider/ProviderAdapter";
import type { EmbeddingPort, ParsedChunk } from "./IngestionService";

export class ProviderEmbeddingPortAdapter implements EmbeddingPort {
  constructor(
    private readonly provider: ModelProviderAdapter,
    private readonly model: string,
  ) {}

  async embed(input: { versionRef: string; chunks: readonly ParsedChunk[]; profileRef: string }): Promise<{ profileRef: string; vectorsDigest: `sha256:${string}`; vectors: readonly (readonly number[])[] }> {
    if (!this.provider.embed) {
      throw new Error(`Provider adapter "${this.provider.adapterType}" does not support embedding.`);
    }
    const controller = new AbortController();
    const vectors: number[][] = [];
    for (const chunk of input.chunks) {
      const vector = await this.provider.embed({ model: this.model, text: chunk.text }, controller.signal);
      vectors.push(vector);
    }
    const canonical = vectors.map((vector) => vector.join(",")).join("|");
    const vectorsDigest = `sha256:${createHash("sha256").update(canonical).digest("hex")}` as `sha256:${string}`;
    return { profileRef: input.profileRef, vectorsDigest, vectors };
  }
}
