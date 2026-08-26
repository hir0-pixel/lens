import { createHash } from "node:crypto";
import type { ModelProviderAdapter } from "../../../services/model-provider/ProviderAdapter";

/** Development/test embedding adapter matching the e2e RAG harness (deterministic bag-of-tokens vectors). */
export function createLocalIngestionEmbeddingAdapter(dimensions = 768): ModelProviderAdapter {
  return {
    adapterType: "openai-compatible",
    async discoverModels() {
      return [{ id: "local-embed", capabilities: ["embed"] }];
    },
    async getModelCapabilities() {
      return ["embed"];
    },
    async *generateStream() {
      yield "";
    },
    async embed(input) {
      const synonyms: Record<string, string> = {
        approved: "signoff", approve: "signoff", directors: "leaders", director: "leaders",
        spending: "budget", plans: "budget", money: "funds", goes: "disbursement",
        three: "quarterly", months: "quarterly", group: "team", sign: "signoff", off: "signoff",
      };
      const tokens = input.text.toLowerCase().split(/\W+/).filter(Boolean).map((token) => synonyms[token] ?? token);
      const vector = new Array<number>(dimensions).fill(0);
      for (const token of new Set(tokens)) {
        const hash = createHash("sha256").update(token).digest();
        for (let offset = 0; offset < 4; offset += 1) {
          vector[hash.readUInt32BE(offset * 4) % dimensions] += 1;
        }
      }
      return vector;
    },
    async health() {
      return true;
    },
    normalizeError() {
      return { code: "DEPENDENCY_UNAVAILABLE", retryable: false };
    },
    meterUsage(text) {
      return text.length;
    },
  };
}
