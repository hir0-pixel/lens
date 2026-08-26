import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCompanyRagProfile, computeCompanyRagProfileDigest } from "../../services/rag-profile/companyRagProfile.ts";
import { createRetrievalDeployment } from "../../services/retrieval/ProductionRetrievalWiring.ts";
import { createLocalIngestionEmbeddingAdapter } from "../../server/src/rag/localIngestionEmbedding.ts";
import { rehydrateCorpusIndexes } from "../../server/src/rag/rehydrateCorpus.ts";
import { RetrievalServiceError } from "../../services/retrieval/RetrievalService.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function loadEnv(path) {
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    let value = trimmed.slice(eq + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\n/g, "\n");
    }
    process.env[trimmed.slice(0, eq)] = value;
  }
}
loadEnv(resolve(root, "server/.env"));

const profile = assertCompanyRagProfile(JSON.parse(process.env.COMPANY_RAG_PROFILE_JSON ?? "{}"));
const ragProfileDigest = computeCompanyRagProfileDigest(profile);
const indexProfile = {
  embeddingModelDigest: ragProfileDigest,
  tokenizerDigest: `sha256:${"b".repeat(64)}`,
  vectorDimensions: 768,
  distanceMetric: "cosine",
  chunkingProfile: "markdown-headings",
  schemaVersion: "rag-v1",
};
const provider = createLocalIngestionEmbeddingAdapter(768);
const retrieval = createRetrievalDeployment({
  publicationProfiles: Object.fromEntries(profile.corpora.map((corpusRef) => [corpusRef, { profile: indexProfile, ragProfileVersion: profile.profileVersion, ragProfileDigest }])),
  publicationStorePath: process.env.PUBLICATION_STORE_PATH,
  persistencePath: process.env.AUDIT_LEDGER_STORE_PATH,
  provider,
  embeddingModel: "local-embed",
});
retrieval.activatePolicy();
retrieval.setAuditHealth({ quorumAvailable: true, witnessHealthy: true, checkpointAt: Date.now() });
for (const corpusRef of profile.corpora) {
  const aclDigest = `sha256:${createHash("sha256").update(`corpus-acl:${corpusRef}`).digest("hex")}`;
  retrieval.governance.registerVersion({ documentVersionRef: corpusRef, classification: "internal", aclDigest });
  retrieval.governance.mutateSecurity(corpusRef, { processing: "indexed", integrity: "valid", publication: "active" }, {
    fenceId: `fence-${corpusRef}`,
    actorRef: "governance",
    approverRef: "platform",
    expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
  });
}
try {
  const pdpProbe = retrieval.pdp.decideBatch({
    requestId: "pdp-probe",
    callerWorkloadRef: "ai-orchestrator",
    subjectRef: "dev-user-1",
    deviceRef: "probe",
    action: "retrieve:operation",
    resourceRefs: ["enterprise-docs"],
    normalizedContextDigest: "assistant",
    deadlineAt: Date.now() + 30_000,
  });
  console.log("pdp probe", pdpProbe.allowed.length, pdpProbe.fence?.decisionId ?? "no-fence");
} catch (error) {
  console.error("pdp probe failed", error);
  process.exit(1);
}
const rehydrated = await rehydrateCorpusIndexes({
  retrieval,
  corpora: profile.corpora,
  ingestionStorePathPrefix: process.env.INGESTION_STORE_PATH_PREFIX,
  provider,
  embeddingModel: "local-embed",
});
console.log("rehydrated", rehydrated);
const hits = retrieval.searchIndex.search({ corpusRef: "enterprise-docs", queryText: "directors budget approved", laneLimit: 10 });
console.log("index hits", hits.length, hits.map((hit) => hit.versionRef));

const query = process.argv[2] ?? "quarterly budget policy";
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
try {
  const result = await retrieval.service.retrieve({
    request_id: randomUUID(),
    turn_id: "probe",
    caller_workload_ref: "ai-orchestrator",
    subject_ref: "dev-user-1",
    session_ref: "probe",
    device_ref: "probe",
    application_id: "lens-employee-client",
    query_digest: digest(query),
    query_text: query,
    purpose_ref: "assistant",
    retrieval_class: "enterprise-grounded",
    corpus_ref: "enterprise-docs",
    mode: "hybrid",
    profile_version: profile.profileVersion,
    profile_digest: ragProfileDigest,
    candidate_limit: 10,
    deadline_at: Date.now() + 30_000,
    cancellation: false,
    bulkhead: "interactive",
    visibility_minimum: 0,
  });
  console.log("SUCCESS", JSON.stringify(result, null, 2).slice(0, 2000));
} catch (error) {
  console.error("FAILED", error);
  if (error instanceof RetrievalServiceError) {
    console.error("code", error.code, "message", error.message);
  }
  process.exit(1);
}
