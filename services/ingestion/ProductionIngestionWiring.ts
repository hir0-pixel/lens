import type { ModelProviderAdapter } from "../model-provider/ProviderAdapter";
import type { CompanyRagProfile } from "../rag-profile/companyRagProfile";
import type { RetrievalDeployment } from "../retrieval/ProductionRetrievalWiring";
import type { IndexProfile } from "../retrieval/PublicationAuthority";
import { IngestionService } from "./IngestionService";
import { InMemoryIngestionOwnerStore } from "./IngestionService";
import { SqliteIngestionOwnerStore } from "./ingestionOwnerStore";
import { PublicationIndexPortAdapter } from "./indexPortAdapter";
import { ProviderEmbeddingPortAdapter } from "./embeddingPortAdapter";
import { GovernanceAuthorityPortAdapter } from "./governancePortAdapter";

export interface IngestionDeploymentOptions {
  retrieval: RetrievalDeployment;
  provider: ModelProviderAdapter;
  embeddingModel: string;
  ragProfile: CompanyRagProfile;
  corpora: Readonly<Record<string, { indexProfile: IndexProfile; ragProfileVersion: number; ragProfileDigest: `sha256:${string}` }>>;
  ingestionStorePathPrefix?: string;
  now?: () => number;
}

export interface IngestionDeployment {
  services: ReadonlyMap<string, IngestionService>;
  ragProfile: CompanyRagProfile;
}

export function createIngestionDeployment(options: IngestionDeploymentOptions): IngestionDeployment {
  const now = options.now ?? (() => Date.now());
  const governance = new GovernanceAuthorityPortAdapter(options.retrieval.governance, now);
  const embedding = new ProviderEmbeddingPortAdapter(options.provider, options.embeddingModel);
  const services = new Map<string, IngestionService>();

  for (const [corpusRef, config] of Object.entries(options.corpora)) {
    const authority = options.retrieval.publicationAuthorities.get(corpusRef);
    if (!authority) throw new Error(`Ingestion corpus "${corpusRef}" is not configured for retrieval publication.`);
    const index = new PublicationIndexPortAdapter(authority, 1, config.indexProfile, config.ragProfileVersion, config.ragProfileDigest, options.retrieval.contentStore, corpusRef, options.retrieval.searchIndex, options.retrieval.vectorIndex);
    const store = options.ingestionStorePathPrefix
      ? new SqliteIngestionOwnerStore(`${options.ingestionStorePathPrefix}-${corpusRef}.db`)
      : new InMemoryIngestionOwnerStore();
    services.set(corpusRef, new IngestionService(governance, embedding, index, store, undefined, undefined, now));
  }

  return { services, ragProfile: options.ragProfile };
}
