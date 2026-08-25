export {
  DEFAULT_INGESTION_BOUNDS,
  InMemoryIngestionOwnerStore,
  IngestionError,
  IngestionService,
  type AttestedParseResult,
  type DrainResult,
  type EmbeddingPort,
  type EventBackbonePort,
  type GovernancePort,
  type IndexPort,
  type IngestionBounds,
  type IngestionJobRecord,
  type IngestionOwnerSnapshot,
  type IngestionOwnerStore,
  type IngestionRequest,
  type IngestionStage,
  type IngestionState,
  type InvalidationEvent,
  type VersionRecord,
} from "./IngestionService";

export { SqliteIngestionOwnerStore } from "./ingestionOwnerStore";
export { PublicationIndexPortAdapter } from "./indexPortAdapter";
export { ProviderEmbeddingPortAdapter } from "./embeddingPortAdapter";
export { GovernanceAuthorityPortAdapter } from "./governancePortAdapter";
export { createIngestionDeployment, type IngestionDeployment, type IngestionDeploymentOptions } from "./ProductionIngestionWiring";
