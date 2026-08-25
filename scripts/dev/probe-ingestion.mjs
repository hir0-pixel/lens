/**
 * Reproduce BFF ingestion path locally and print the real failure.
 * Run: server/node_modules/.bin/tsx scripts/dev/probe-ingestion.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AuditAdmissionError } from "../../services/audit/AuditLedger.ts";
import { createIngestionDeployment } from "../../services/ingestion/ProductionIngestionWiring.ts";
import { createLocalIngestionEmbeddingAdapter } from "../../server/src/rag/localIngestionEmbedding.ts";
import { assertCompanyRagProfile, computeCompanyRagProfileDigest } from "../../services/rag-profile/companyRagProfile.ts";
import { createRetrievalDeployment } from "../../services/retrieval/ProductionRetrievalWiring.ts";
import { simpleHash } from "../../services/retrieval/indexGenerationManifest.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const digest = (value) => `sha256:${simpleHash(value)}`;

function loadEnvFile(path) {
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

loadEnvFile(resolve(root, "server/.env"));

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
for (const corpusRef of profile.corpora) {
  const aclDigest = digest(`corpus-acl:${corpusRef}`);
  retrieval.governance.registerVersion({ documentVersionRef: corpusRef, classification: "internal", aclDigest });
  retrieval.governance.mutateSecurity(corpusRef, { processing: "indexed", integrity: "valid", publication: "active" }, {
    fenceId: `fence-${corpusRef}`,
    actorRef: "governance",
    approverRef: "platform",
    expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
  });
}

const ingestionDeployment = createIngestionDeployment({
  retrieval,
  provider,
  embeddingModel: "local-embed",
  ragProfile: profile,
  corpora: Object.fromEntries(profile.corpora.map((corpusRef) => [corpusRef, { indexProfile, ragProfileVersion: profile.profileVersion, ragProfileDigest }])),
  ingestionStorePathPrefix: process.env.INGESTION_STORE_PATH_PREFIX,
});

const auditLedger = retrieval.auditLedger;
const service = ingestionDeployment.services.get("enterprise-docs");
if (!service) throw new Error("missing enterprise-docs service");

const text = "The quarterly budget must be approved by directors before spending.";
const versionRef = `probe-doc@v${Date.now()}`;
const body = {
  sourceId: "admin-paste",
  documentRef: "probe-doc",
  version: `v${Date.now()}`,
  versionRef,
  contentDigest: digest(text),
  aclDigest: digest("acl:probe-doc"),
  classificationRef: "internal",
  parse: {
    status: "accepted",
    renditionDigest: digest(`rendition:${versionRef}`),
    chunks: [{ chunkRef: "chunk-1", contentDigest: digest(text), text, citationAnchor: "chunk:1" }],
  },
  ragProfileVersion: profile.profileVersion,
  ragProfileDigest,
};

function appendAudit(input) {
  const intent = { ...input, requestId: input.eventId, action: "ingestion.submit" };
  try {
    auditLedger.appendIntent({ workloadId: "ingestion", attested: true }, intent);
  } catch (error) {
    if (error instanceof AuditAdmissionError && error.code === "AUDIT_DR_CHECKPOINT_STALE") {
      auditLedger.setHealth({ checkpointAt: Date.now() });
      auditLedger.appendIntent({ workloadId: "ingestion", attested: true }, intent);
      return;
    }
    if (error instanceof AuditAdmissionError && error.code === "AUDIT_EVENT_ID_CONFLICT") return;
    throw error;
  }
}

auditLedger.setHealth({ checkpointAt: Date.now() - 120_000 });

try {
  const eventId = `ingest:${body.sourceId}:${body.version}:default-ingestion-profile`;
  appendAudit({
    eventId,
    partitionKey: body.versionRef,
    eventType: "ingestion.job.submitted",
    intentDigest: body.contentDigest,
    byteLength: JSON.stringify(body).length,
  });
  await service.enqueueIngest(body);
  await service.drain();
  const version = await service.version(body.versionRef);
  console.log("SUCCESS", version);
} catch (error) {
  console.error("FAILED", error);
  if (error instanceof Error && error.stack) console.error(error.stack);
  process.exit(1);
}
