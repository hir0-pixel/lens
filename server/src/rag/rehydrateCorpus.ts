import { existsSync } from "node:fs";
import type { ModelProviderAdapter } from "../../../services/model-provider/ProviderAdapter";
import { SqliteIngestionOwnerStore } from "../../../services/ingestion/ingestionOwnerStore";
import type { RetrievalDeployment } from "../../../services/retrieval/ProductionRetrievalWiring";
import type { Classification } from "../../../services/governance/GovernanceAuthority";

/** Rebuild in-memory search indexes and content from durable ingestion records after restart. */
export async function rehydrateCorpusIndexes(options: {
  retrieval: RetrievalDeployment;
  corpora: readonly string[];
  ingestionStorePathPrefix: string;
  provider: ModelProviderAdapter;
  embeddingModel: string;
}): Promise<number> {
  let versions = 0;
  for (const corpusRef of options.corpora) {
    const path = `${options.ingestionStorePathPrefix}-${corpusRef}.db`;
    if (!existsSync(path)) continue;
    const store = new SqliteIngestionOwnerStore(path);
    try {
      for (const version of store.snapshot().versions) {
        if (version.state !== "COMMITTED" || version.request.parse.status !== "accepted") continue;
        const { request } = version;
        const sample = request.parse.chunks[0]?.text ?? "";
        const alreadyIndexed = sample.length > 0 && options.retrieval.searchIndex
          .search({ corpusRef, queryText: sample, laneLimit: 8 })
          .some((entry) => entry.versionRef === request.versionRef);
        if (alreadyIndexed) continue;

        options.retrieval.governance.registerVersion({
          documentVersionRef: request.versionRef,
          classification: request.classificationRef,
          aclDigest: request.aclDigest,
        });
        options.retrieval.governance.mutateSecurity(
          request.versionRef,
          { publication: "active", processing: "indexed", integrity: "valid" },
          {
            fenceId: `rehydrate-${request.versionRef}`,
            actorRef: "ingestion",
            approverRef: "platform",
            expiresAt: Date.now() + 3_600_000,
          },
        );
        const classificationRef = request.classificationRef as Classification;
        for (const chunk of request.parse.chunks) {
          options.retrieval.contentStore.write({
            versionRef: request.versionRef,
            chunkRef: chunk.chunkRef,
            contentHash: chunk.contentDigest,
            text: chunk.text,
            citationAnchor: chunk.citationAnchor,
          });
          options.retrieval.searchIndex.write({
            corpusRef,
            resourceRef: request.documentRef,
            versionRef: request.versionRef,
            chunkRef: chunk.chunkRef,
            contentHash: chunk.contentDigest,
            classificationRef,
            text: chunk.text,
          });
          const vector = await options.provider.embed({ model: options.embeddingModel, text: chunk.text });
          options.retrieval.vectorIndex.write({
            corpusRef,
            resourceRef: request.documentRef,
            versionRef: request.versionRef,
            chunkRef: chunk.chunkRef,
            contentHash: chunk.contentDigest,
            classificationRef,
            vector,
          });
        }
        versions += 1;
      }
    } finally {
      store.close();
    }
  }
  return versions;
}
