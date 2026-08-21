import { PolicyDecisionPoint, type FactReaders, type PdpAuditPort } from "../pdp/PolicyDecisionPoint";
import { GovernanceAuthority, type ResourceSecurityFacts } from "../governance/GovernanceAuthority";
import { AuditLedger } from "../audit/AuditLedger";
import { RetrievalService, type RetrievalCandidate, type RetrievalPdpPort, type RetrievalSearchResult } from "./RetrievalService";
import { PublicationAuthority, type IndexProfile } from "./PublicationAuthority";
import { SovereignContentStore } from "./SovereignContentStore";

export interface RetrievalWiringOptions {
  now?: () => number;
  partitionCount?: number;
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
    subject: () => ({ revision: 1, active: true, groups: [] }),
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
  }, () => new Date(), options.partitionCount ?? 64);

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
  contentStore: SovereignContentStore;
}

export interface RetrievalDeploymentOptions {
  index: {
    search(input: { mode: "lexical" | "semantic" | "graph" | "hybrid" | "structured" | "citation_refresh"; queryDigest: string; queryText: string; corpusRef: string; laneLimit: number; deadlineAt: number; signal?: AbortSignal }): readonly SearchIndexEntry[];
  };
  contentStore?: {
    fetch(input: { fence: string; versionRefs: readonly string[]; resources: readonly { resourceRef: string; versionRef: string; chunkRef: string; contentHash: string }[] }): readonly ContentDocument[];
  };
  publication?: PublicationManifestState;
  publicationProfile?: IndexProfile;
  now?: () => number;
}

export function createRetrievalDeployment(options: RetrievalDeploymentOptions): RetrievalDeployment {
  const wiring = createRetrievalWiring({ now: options.now });
  const now = options.now ?? (() => Date.now());
  const publicationProfile: IndexProfile = options.publicationProfile ?? {
    embeddingModelDigest: `sha256:${"a".repeat(64)}`,
    tokenizerDigest: `sha256:${"b".repeat(64)}`,
    vectorDimensions: 768,
    distanceMetric: "cosine",
    chunkingProfile: "markdown-headings",
    schemaVersion: "rag-v1",
  };

  // Track 3: the independent publication authority owns the active generation.
  const authority = new PublicationAuthority("enterprise-docs", now);
  const defaultContentStore = new SovereignContentStore();

  // If a caller supplies a static publication state, seed a matching generation.
  const seededProfile = publicationProfile;
  authority.beginGeneration(1, "index:enterprise-docs:gen1", seededProfile);
  const seedEntries = options.index.search({
    mode: "hybrid",
    queryDigest: "seed",
    queryText: "seed",
    corpusRef: "enterprise-docs",
    laneLimit: 1_000,
    deadlineAt: now() + 10_000,
  });
  if (seedEntries.length > 0) {
    for (const entry of seedEntries) {
      try {
        authority.addCandidate(1, "index:enterprise-docs:gen1", {
          versionRef: entry.versionRef,
          chunkRef: entry.chunkRef,
          contentHash: entry.contentHash,
          classificationRef: entry.classificationRef,
        });
      } catch {
        // Duplicate chunk refs in the seed search are coalesced; ignore.
      }
    }
    authority.finalize(1, "index:enterprise-docs:gen1");
    authority.publish(1, "index:enterprise-docs:gen1");
  }

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
      search: (input) => {
        const entries = options.index.search(input);
        const ranked = new Map<string, RetrievalCandidate>();
        for (const entry of entries) {
          const scores = [
            entry.lexicalScore,
            entry.vectorScore,
            entry.graphScore,
            entry.metadataScore,
          ].filter((value) => Number.isFinite(value));
          const lane: RetrievalCandidate["lane"] = input.mode === "hybrid"
            ? "lexical"
            : input.mode === "semantic"
              ? "vector"
              : input.mode === "graph"
                ? "graph"
                : input.mode === "structured"
                  ? "metadata"
                  : "lexical";
          const rank = scores.length === 0 ? Number.MAX_SAFE_INTEGER : Math.min(...scores);
          ranked.set(`${entry.resourceRef}|${entry.versionRef}|${entry.chunkRef}`, {
            resourceRef: entry.resourceRef,
            versionRef: entry.versionRef,
            chunkRef: entry.chunkRef,
            contentHash: entry.contentHash,
            lane,
            rank,
            classificationRef: entry.classificationRef,
          });
        }
        const candidates = [...ranked.values()]
          .sort((a, b) => a.rank - b.rank)
          .slice(0, input.laneLimit);
        return {
          indexGeneration: input.indexGeneration,
          visibilitySequence: input.visibilitySequence,
          sourceRevisionDigest: input.sourceRevisionDigest,
          candidates,
        } satisfies RetrievalSearchResult;
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
          resourceRef: document.versionRef,
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
        const fallback = options.publication;
        try {
          const active = authority.activeGeneration({ corpusRef: input.corpusRef, deadlineAt: input.deadlineAt, signal: input.signal });
          return {
              indexGeneration: active.indexGeneration,
              visibilitySequence: active.visibilitySequence,
              sourceRevisionDigest: active.sourceRevisionDigest,
            };
        } catch {
          if (fallback) {
            return {
              indexGeneration: fallback.activeGeneration,
              visibilitySequence: fallback.visibilitySequence,
              sourceRevisionDigest: fallback.sourceRevisionDigest,
            };
          }
          throw new Error("No active publication generation is available.");
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
    contentStore: defaultContentStore,
  };
}

export { ResourceSecurityFacts };
