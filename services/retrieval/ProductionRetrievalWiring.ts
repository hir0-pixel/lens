import { PolicyDecisionPoint, type FactReaders, type PdpAuditPort, type SubjectFacts } from "../pdp/PolicyDecisionPoint";
import { GovernanceAuthority, type ResourceSecurityFacts } from "../governance/GovernanceAuthority";
import { AuditLedger } from "../audit/AuditLedger";
import { RetrievalService, type RetrievalCandidate, type RetrievalPdpPort, type RetrievalSearchResult } from "./RetrievalService";
import { PublicationAuthority, PublicationAuthorityRegistry, type IndexProfile } from "./PublicationAuthority";
import { PublicationStore } from "./publicationStore";
import { SovereignContentStore } from "./SovereignContentStore";
import { LexicalSearchIndex } from "./LexicalSearchIndex";
import { VectorSearchIndex } from "./VectorSearchIndex";
import type { ModelProviderAdapter } from "../model-provider/ProviderAdapter";

export interface RetrievalWiringOptions {
  now?: () => number;
  partitionCount?: number;
  persistencePath?: string;
  subject?: (subjectRef: string) => SubjectFacts;
}

export interface ContentDocument {
  versionRef: string;
  chunkRef: string;
  contentHash: `sha256:${string}`;
  text: string;
  citationAnchor: string;
  classificationRef: "public" | "internal" | "confidential" | "restricted";
}

export interface SearchIndexEntry {
  versionRef: string;
  resourceRef: string;
  chunkRef: string;
  contentHash: `sha256:${string}`;
  classificationRef: "public" | "internal" | "confidential" | "restricted";
  lexicalScore: number;
  vectorScore: number;
  graphScore: number;
  metadataScore: number;
}

export interface PublicationManifestState {
  activeGeneration: string;
  visibilitySequence: number;
  sourceRevisionDigest: `sha256:${string}`;
}

/**
 * Binds the production Retrieval pipeline to the repository's reference
 * authorities without duplicating their ownership:
 *  - PolicyDecisionPoint is the sole authorization authority;
 *  - GovernanceAuthority provides one committed resource-security snapshot;
 *  - AuditLedger provides quorum receipts;
 *  - a content store and index adapter are injected by the deployer.
 */
export function createRetrievalWiring(options: RetrievalWiringOptions = {}) {
  const now = options.now ?? (() => Date.now());

  // One committed snapshot reader over the governance security facts.
  const factReaders: FactReaders = {
    subject: options.subject ?? (() => ({ revision: 1, active: true, groups: [] })),
    device: () => ({ revision: 1, compliant: true }),
    resources: (refs: readonly string[]) =>
      refs.map((ref) => {
        const facts = governance.getResourceSecurityFacts([ref])[0];
        return {
          resourceRef: facts.documentVersionRef,
          revision: facts.resourceSecurityRevision,
          published: facts.publication === "active",
          integrityValid: facts.integrity === "valid",
          aclAllows: facts.retrievalEligible,
        };
      }),
  };

  const pdpAudit: PdpAuditPort = {
    admitDecision: (input) => {
      auditLedger.appendIntent({ workloadId: "pdp", attested: true }, {
        eventId: input.decisionId,
        partitionKey: input.requestId,
        eventType: "pdp.decision",
        requestId: input.requestId,
        action: input.action,
        intentDigest: input.candidateDigest,
        byteLength: input.allowedDigest.length + input.revisionDigest.length,
      });
      return { receiptDigest: `pdp:${input.decisionId}` };
    },
  };

  const pdp = new PolicyDecisionPoint(factReaders, pdpAudit, {
    sign: (fence) => `signed:${fence.fenceId}`,
    verify: (fence) => fence.signature === `signed:${fence.fenceId}`,
  }, now);

  const governance = new GovernanceAuthority(now);
  const auditLedger = new AuditLedger({
    retrieval: ["retrieval.retrieve"],
    pdp: ["pdp.decision"],
    ingestion: ["ingestion.job.submitted", "ingestion.job.withdrawn"],
  }, () => new Date(), options.partitionCount ?? 64, undefined, undefined, options.persistencePath);

  return {
    pdp,
    governance,
    auditLedger,
    now,
    activation: {
      activatePolicy() {
        pdp.activate(
          {
            revision: 1,
            digest: "sha256:policy-v1",
            signed: true,
            evaluate: () => true,
          },
          { independent: true, auditAdmitted: true, compatibilityPassed: true },
        );
      },
      registerContent(facts: { documentVersionRef: string; classification: "public" | "internal" | "confidential" | "restricted"; aclDigest: `sha256:${string}`; active?: boolean }) {
        const registered = governance.registerVersion(facts);
        if (facts.active) {
          governance.mutateSecurity(
            facts.documentVersionRef,
            { processing: "indexed", integrity: "valid", publication: "active" },
            { fenceId: `fence-${facts.documentVersionRef}`, actorRef: "governance", approverRef: "platform", expiresAt: now() + 3600_000 },
          );
        }
        return registered;
      },
      mutateSecurity(
        documentVersionRef: string,
        mutation: { publication?: "active" | "withdrawn" | "deleted"; processing?: "indexed"; integrity?: "valid" },
      ) {
        return governance.mutateSecurity(
          documentVersionRef,
          mutation,
          { fenceId: `fence-${documentVersionRef}`, actorRef: "governance", approverRef: "platform", expiresAt: now() + 3600_000 },
        );
      },
      health: (state: { quorumAvailable?: boolean; witnessHealthy?: boolean }) => {
        auditLedger.setHealth(state);
      },
    },
  };
}

export interface RetrievalDeployment {
  service: RetrievalService;
  governance: GovernanceAuthority;
  pdp: PolicyDecisionPoint;
  auditLedger: AuditLedger;
  activatePolicy: () => void;
  setAuditHealth: (state: { quorumAvailable?: boolean; witnessHealthy?: boolean }) => void;
  /** Track 3: the deployer's write-path handle to the independent publication authority. */
  publicationAuthority: PublicationAuthority;
  publicationAuthorities: ReadonlyMap<string, PublicationAuthority>;
  contentStore: SovereignContentStore;
  searchIndex: LexicalSearchIndex;
  vectorIndex: VectorSearchIndex;
}

export interface RetrievalDeploymentOptions {
  index?: {
    search(input: { mode: "lexical" | "semantic" | "graph" | "hybrid" | "structured" | "citation_refresh"; queryDigest: string; queryText: string; corpusRef: string; laneLimit: number; deadlineAt: number; signal?: AbortSignal }): readonly SearchIndexEntry[];
  };
  provider?: ModelProviderAdapter;
  embeddingModel?: string;
  contentStore?: {
    fetch(input: { fence: string; versionRefs: readonly string[]; resources: readonly { resourceRef: string; versionRef: string; chunkRef: string; contentHash: string }[] }): readonly ContentDocument[];
  };
  publicationProfile?: IndexProfile;
  ragProfileVersion?: number;
  ragProfileDigest?: `sha256:${string}`;
  /** Additional explicitly configured corpora, each with its own immutable lineage. */
  publicationProfiles?: Readonly<Record<string, { profile?: IndexProfile; ragProfileVersion: number; ragProfileDigest: `sha256:${string}` }>>;
  /** Optional SQLite database shared by the per-corpus publication authorities. */
  publicationStorePath?: string;
  persistencePath?: string;
  now?: () => number;
  subject?: (subjectRef: string) => SubjectFacts;
}

export function createRetrievalDeployment(options: RetrievalDeploymentOptions): RetrievalDeployment {
  const wiring = createRetrievalWiring({ now: options.now, persistencePath: options.persistencePath, subject: options.subject });
  const now = options.now ?? (() => Date.now());
  const searchIndex = new LexicalSearchIndex();
  const vectorIndex = new VectorSearchIndex();
  const indexPort = options.index ?? { search: (input: { queryText: string; corpusRef: string; laneLimit: number }) => searchIndex.search(input) };
  const publicationProfile: IndexProfile = options.publicationProfile ?? {
    embeddingModelDigest: `sha256:${"a".repeat(64)}`,
    tokenizerDigest: `sha256:${"b".repeat(64)}`,
    vectorDimensions: 768,
    distanceMetric: "cosine",
    chunkingProfile: "markdown-headings",
    schemaVersion: "rag-v1",
  };

  // Track 3: each explicitly configured corpus owns an independent publication authority.
  const defaultContentStore = new SovereignContentStore();
  const publicationStore = options.publicationStorePath ? new PublicationStore(options.publicationStorePath) : undefined;
  const authorityByCorpus = new Map<string, PublicationAuthority>();
  const configuredProfiles = new Map<string, { profile: IndexProfile; ragProfileVersion: number; ragProfileDigest: `sha256:${string}` }>([
    ["enterprise-docs", {
      profile: publicationProfile,
      ragProfileVersion: options.ragProfileVersion ?? 1,
      ragProfileDigest: options.ragProfileDigest ?? `sha256:${"c".repeat(64)}`,
    }],
    ...Object.entries(options.publicationProfiles ?? {}).map(([corpusRef, config]) => [corpusRef, {
      profile: config.profile ?? publicationProfile,
      ragProfileVersion: config.ragProfileVersion,
      ragProfileDigest: config.ragProfileDigest,
    }] as const),
  ]);
  for (const [corpusRef, config] of configuredProfiles) {
    const persisted = publicationStore?.load(corpusRef);
    const authority = new PublicationAuthority(corpusRef, now, publicationStore);
    // A durable authority owns its prior active or in-progress generation after restart.
    if (!persisted || persisted.generations.length === 0) {
      const generationId = `index:${corpusRef}:gen1`;
      authority.beginGeneration(1, generationId, config.profile, config.ragProfileVersion, config.ragProfileDigest);
      const seedEntries = indexPort.search({
        mode: "lexical", queryDigest: "seed", queryText: "seed", corpusRef, laneLimit: 1_000, deadlineAt: now() + 10_000,
      });
      if (seedEntries.length > 0) {
        for (const entry of seedEntries) {
          try {
            authority.addCandidate(1, generationId, {
              versionRef: entry.versionRef, chunkRef: entry.chunkRef, contentHash: entry.contentHash, classificationRef: entry.classificationRef,
            });
          } catch {
            // Duplicate chunk refs in the seed search are coalesced; ignore.
          }
        }
        authority.finalize(1, generationId);
        authority.publish(1, generationId);
      }
    }
    authorityByCorpus.set(corpusRef, authority);
  }
  const authority = authorityByCorpus.get("enterprise-docs")!;
  const authorityRegistry = new PublicationAuthorityRegistry(authorityByCorpus);

  const pdpPort: RetrievalPdpPort = {
    authorizeOperation: (input) => {
      const decision = wiring.pdp.decideBatch({
        requestId: input.requestId,
        callerWorkloadRef: "ai-orchestrator",
        subjectRef: input.subjectRef,
        deviceRef: input.deviceRef,
        action: "retrieve:operation",
        resourceRefs: [input.corpusRef],
        normalizedContextDigest: input.purposeRef,
        useBoundary: "operation",
        deadlineAt: input.deadlineAt,
      });
      return {
        allowed: decision.allowed.length > 0,
        decisionRef: decision.fence?.decisionId ?? "operation",
        policyRevision: decision.fence?.policyRevision ?? 1,
      };
    },
    authorizeBatch: (input) => {
      const decision = wiring.pdp.decideBatch({
        requestId: input.requestId,
        callerWorkloadRef: "ai-orchestrator",
        subjectRef: input.subjectRef,
        deviceRef: input.deviceRef,
        action: "retrieve:candidates",
        resourceRefs: input.resourceRefs,
        normalizedContextDigest: input.candidateDigest,
        useBoundary: "operation",
        deadlineAt: input.deadlineAt,
      });
      if (!decision.fence) {
        return {
          allowedRefs: [],
          decisionRef: `decision:${input.requestId}`,
          fence: "",
          revisionDigest: "revisions",
          policyRevision: 1,
          subjectSecurityRevision: 1,
          resourceSecurityRevisionDigest: "sha256:resources",
        };
      }
      return {
        allowedRefs: decision.allowed,
        decisionRef: decision.fence.decisionId,
        fence: decision.fence.signature,
        revisionDigest: decision.fence.resourceRevisionDigest,
        policyRevision: decision.fence.policyRevision,
        subjectSecurityRevision: decision.fence.subjectRevision,
        resourceSecurityRevisionDigest: decision.fence.resourceRevisionDigest as `sha256:${string}`,
      };
    },
  };

  const service = new RetrievalService(
    pdpPort,
    {
      search: async (input) => {
        const lexicalEntries = () => options.index?.search(input) ?? searchIndex.search(input);
        const toCandidates = (entries: readonly SearchIndexEntry[], lane: RetrievalCandidate["lane"], score: (entry: SearchIndexEntry) => number): RetrievalCandidate[] => entries.map((entry) => ({
          resourceRef: entry.resourceRef,
          versionRef: entry.versionRef,
          chunkRef: entry.chunkRef,
          contentHash: entry.contentHash,
          lane,
          rank: score(entry),
          classificationRef: entry.classificationRef,
        }));
        const vectorEntries = async () => {
          if (!options.provider || !options.embeddingModel || !options.provider.embed || !vectorIndex.hasEntries(input.corpusRef)) {
            throw new Error("Vector search backend is not configured for this corpus.");
          }
          const queryVector = await options.provider.embed({ model: options.embeddingModel, text: input.queryText }, input.signal);
          return vectorIndex.search({ corpusRef: input.corpusRef, queryVector, laneLimit: input.laneLimit });
        };
        let candidates: RetrievalCandidate[];
        if (input.mode === "lexical") {
          candidates = toCandidates(lexicalEntries(), "lexical", (entry) => entry.lexicalScore);
        } else if (input.mode === "semantic") {
          candidates = toCandidates(await vectorEntries(), "vector", (entry) => entry.vectorScore);
        } else if (input.mode === "hybrid") {
          candidates = [
            ...toCandidates(lexicalEntries(), "lexical", (entry) => entry.lexicalScore),
            ...toCandidates(await vectorEntries(), "vector", (entry) => entry.vectorScore),
          ];
        } else {
          const entries = indexPort.search(input);
          const lane: RetrievalCandidate["lane"] = input.mode === "graph" ? "graph" : input.mode === "structured" ? "metadata" : "lexical";
          const ranked = new Map<string, RetrievalCandidate>();
          for (const entry of entries) {
            const scores = [entry.lexicalScore, entry.vectorScore, entry.graphScore, entry.metadataScore].filter((value) => Number.isFinite(value));
            ranked.set(`${entry.resourceRef}|${entry.versionRef}|${entry.chunkRef}`, {
              resourceRef: entry.resourceRef,
              versionRef: entry.versionRef,
              chunkRef: entry.chunkRef,
              contentHash: entry.contentHash,
              lane,
              rank: scores.length === 0 ? Number.MAX_SAFE_INTEGER : Math.min(...scores),
              classificationRef: entry.classificationRef,
            });
          }
          candidates = [...ranked.values()].sort((a, b) => a.rank - b.rank).slice(0, input.laneLimit);
        }
        return { indexGeneration: input.indexGeneration, visibilitySequence: input.visibilitySequence, sourceRevisionDigest: input.sourceRevisionDigest, candidates } satisfies RetrievalSearchResult;
      },
    },
    {
      fetch: (input) => {
        const allowedVersionRefs = new Set(input.resources.map((resource) => resource.versionRef));
        const documents = options.contentStore
          ? options.contentStore.fetch({
              fence: input.fence,
              versionRefs: [...allowedVersionRefs],
              resources: input.resources,
            })
          : defaultContentStore.fetch({
              fence: input.fence,
              resources: input.resources.map((resource) => ({
                versionRef: resource.versionRef,
                chunkRef: resource.chunkRef,
                contentHash: resource.contentHash as `sha256:${string}`,
              })),
            });
        return documents.map((document) => ({
          resourceRef: input.resources.find((resource) => resource.versionRef === document.versionRef && resource.chunkRef === document.chunkRef)?.resourceRef ?? document.versionRef,
          versionRef: document.versionRef,
          chunkRef: document.chunkRef,
          contentHash: document.contentHash,
          text: document.text,
          citationAnchor: document.citationAnchor,
        }));
      },
    },
    {
      admit: (input) => {
        const receipt = wiring.auditLedger.appendIntent({ workloadId: "retrieval", attested: true }, {
          eventId: input.eventId,
          partitionKey: input.requestId,
          eventType: "retrieval.retrieve",
          requestId: input.requestId,
          action: "retrieve",
          intentDigest: input.manifestDigest,
          byteLength: input.candidateDigest.length + input.allowedDigest.length,
        });
        return { receipt: receipt.receiptDigest };
      },
    },
    {
      activeGeneration: (input) => {
        try {
          const active = authorityRegistry.activeGeneration({ corpusRef: input.corpusRef, deadlineAt: input.deadlineAt, signal: input.signal });
          return {
            indexGeneration: active.indexGeneration,
            visibilitySequence: active.visibilitySequence,
            sourceRevisionDigest: active.sourceRevisionDigest,
            ragProfileVersion: active.ragProfileVersion,
            ragProfileDigest: active.ragProfileDigest,
          };
        } catch (error) {
          throw new Error(`No active publication generation is available: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },
    now,
  );

  return {
    service,
    governance: wiring.governance,
    pdp: wiring.pdp,
    auditLedger: wiring.auditLedger,
    activatePolicy: wiring.activation.activatePolicy,
    setAuditHealth: wiring.activation.health,
    publicationAuthority: authority,
    publicationAuthorities: authorityByCorpus,
    contentStore: defaultContentStore,
    searchIndex,
    vectorIndex,
  };
}

export { ResourceSecurityFacts };
