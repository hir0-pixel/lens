/**
 * Generates gitignored local env files for the governed RAG stack (Task 5 paste-doc path).
 * Run: npm run rag:setup
 *
 * Ingestion and retrieval share the BFF process so published corpus is visible to Orchestrator.
 * Separate retrieval-service is not used for the document corpus in this lab layout.
 */
import { createHash, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const stackDir = resolve(root, ".local/rag-stack");
const dataDir = resolve(stackDir, "data");

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }
  return value;
}

function signRoutePolicyManifest(opsKeyHex, manifest) {
  return createHmac("sha256", Buffer.from(opsKeyHex, "hex"))
    .update(JSON.stringify(canonicalize(manifest)))
    .digest("hex");
}

function token() {
  return randomBytes(32).toString("hex");
}

function pemOneLine(pem) {
  return pem.replace(/\r?\n/g, "\\n");
}

function writeEnv(name, lines) {
  const body = Object.entries(lines)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value.includes(" ") || value.includes("\\n") ? `"${value}"` : value}`)
    .join("\n");
  writeFileSync(resolve(stackDir, name), `${body}\n`, "utf8");
}

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    let value = trimmed.slice(eq + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\n/g, "\n");
    }
    out[trimmed.slice(0, eq)] = value;
  }
  return out;
}

function preserved(existing, key, fallback) {
  const value = existing[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

const existingBff = parseEnvFile(resolve(stackDir, "bff-rag.env"));
const existingOrch = parseEnvFile(resolve(stackDir, "orchestrator.env"));
const existingAuthority = parseEnvFile(resolve(stackDir, "authority.env"));

const orchestratorToken = preserved(existingBff, "ORCHESTRATOR_TOKEN", token());
const retrievalToken = preserved(existingBff, "RETRIEVAL_WORKLOAD_TOKEN", token());
const authorityToken = preserved(existingAuthority, "AUTHORITY_WORKLOAD_TOKEN", token());
const runtimeToken = preserved(existingOrch, "LENS_MODEL_RUNTIME_WORKLOAD_TOKEN", token());
const catalogToken = preserved(existingBff, "CATALOG_WORKLOAD_TOKEN", token());
const providerSecretToken = preserved(existingBff, "PROVIDER_SECRET_WORKLOAD_TOKEN", token());
const conversationSecret = preserved(existingBff, "CONVERSATION_REFERENCE_SECRET", token());
const routeOpsKey = preserved(existingOrch, "LENS_ROUTE_POLICY_OPS_KEY", randomBytes(32).toString("hex"));
const authorityOutputKey = preserved(existingAuthority, "LENS_AUTHORITY_OUTPUT_KEY_HEX", randomBytes(32).toString("hex"));
const modelArtifactDigest = preserved(existingOrch, "LENS_MODEL_ARTIFACT_DIGEST", `sha256:${"a".repeat(64)}`);

let assertionPrivate = preserved(existingBff, "BFF_ASSERTION_PRIVATE_KEY", "");
let memoryPrivate = preserved(existingBff, "MEMORY_ASSERTION_PRIVATE_KEY", "");
const schedulerPrivateRaw = preserved(existingAuthority, "LENS_MODEL_USE_SIGNING_KEY", "");

let assertionPublic = preserved(existingOrch, "LENS_ORCHESTRATOR_ASSERTION_PUBLIC_KEY", "").replace(/\\n/g, "\n");
let memoryPublic = preserved(existingOrch, "LENS_MEMORY_ASSERTION_PUBLIC_KEY", "").replace(/\\n/g, "\n");

if (!assertionPrivate || !memoryPrivate || !assertionPublic || !memoryPublic) {
  const assertionKeys = generateKeyPairSync("ed25519");
  const memoryKeys = generateKeyPairSync("ed25519");
  if (!assertionPrivate) {
    assertionPrivate = assertionKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    assertionPublic = assertionKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
  }
  if (!memoryPrivate) {
    memoryPrivate = memoryKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    memoryPublic = memoryKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
  }
}

let schedulerPrivatePem = schedulerPrivateRaw.replace(/\\n/g, "\n");
if (!schedulerPrivatePem) {
  schedulerPrivatePem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}
const schedulerPublicPem = createPublicKey(createPrivateKey(schedulerPrivatePem)).export({ type: "spki", format: "pem" }).toString();

const companyRagProfile = {
  profileVersion: 1,
  companyId: "lens-dev",
  corpora: ["enterprise-docs"],
  connectors: [],
  chunking: { maxTokens: 400, overlapTokens: 40 },
  embeddingAdapterRef: "openai-compatible:embed",
  groundingPolicyRef: "dev-policy",
  tools: [],
  retentionDays: 30,
  eligibleModelPatterns: ["gemini-*", "gemini*"],
  // hybrid uses local deterministic embeddings on the BFF (INGESTION_USE_LOCAL_EMBEDDINGS)
  retrievalProfiles: { default: { corpusRef: "enterprise-docs", mode: "hybrid" } },
};

// groundingRequired true: with LENS_USE_GATEWAY_TURN_ROUTER=false the deterministic router
// fallback uses SINGLE_RETRIEVAL + defaultProfileSelector for non-greeting turns; greetings/acks
// still skip retrieval via the acknowledgement fast path.
const routePolicy = {
  manifestRevision: 1,
  entries: [{
    applicationRef: "lens-employee-client",
    workspaceRef: "default-workspace",
    purposeRef: "assistant",
    requestClass: "enterprise-grounded",
    routePolicyRevision: 1,
    groundingRequired: true,
    routerModelRef: "default",
    allowedProfileSelectors: ["default"],
    defaultProfileSelector: "default",
    noDefaultSelectorBehavior: "CLARIFY",
    clarificationText: "Please clarify.",
    expiresAt: Date.now() + 86_400_000 * 30,
  }],
};
const routePolicySignature = signRoutePolicyManifest(routeOpsKey, routePolicy);

mkdirSync(stackDir, { recursive: true });
mkdirSync(dataDir, { recursive: true });

writeEnv("authority.env", {
  NODE_ENV: "development",
  PORT: "8790",
  HOST: "127.0.0.1",
  AUTHORITY_WORKLOAD_TOKEN: authorityToken,
  LENS_AUTHORITY_DB_PATH: resolve(dataDir, "authority.db"),
  LENS_AUTHORITY_STORAGE_PROFILE: "development",
  LENS_AUTHORITY_OUTPUT_KEY_HEX: authorityOutputKey,
  LENS_AUTHORITY_ALLOW_DEV_FACTS: "true",
  LENS_MODEL_USE_SIGNING_KEY: pemOneLine(schedulerPrivatePem),
  LENS_MODEL_ARTIFACT_DIGEST: modelArtifactDigest,
});

writeEnv("runtime.env", {
  NODE_ENV: "development",
  PORT: "8793",
  HOST: "127.0.0.1",
  LENS_RUNTIME_ADAPTER_WORKLOAD_TOKEN: runtimeToken,
  LENS_ATTEMPT_STORE_PROFILE: "development",
  LENS_ATTEMPT_STORE_DB_PATH: resolve(dataDir, "runtime-attempts.sqlite"),
  LENS_SCHEDULER_SIGNING_KEY: pemOneLine(schedulerPrivatePem),
  LENS_USAGE_SIGNING_KEY: pemOneLine(schedulerPrivatePem),
  LENS_GPU_CAPACITY: "8",
  LENS_PROVIDER_RUNTIME_CONFIG_URL: "http://127.0.0.1:3001/internal/v1/provider-runtime-config",
  LENS_PROVIDER_RUNTIME_CONFIG_TOKEN: catalogToken,
  LENS_PROVIDER_SECRET_URL: "http://127.0.0.1:3001/internal/v1/provider-secret",
  LENS_PROVIDER_SECRET_TOKEN: providerSecretToken,
});

// Orchestrator retrieves from BFF in-process retrieval (same corpus as admin ingest)
writeEnv("orchestrator.env", {
  NODE_ENV: "development",
  PORT: "8789",
  HOST: "127.0.0.1",
  LENS_ORCHESTRATOR_WORKLOAD_TOKEN: orchestratorToken,
  LENS_RETRIEVAL_URL: "http://127.0.0.1:8788/",
  LENS_RETRIEVAL_WORKLOAD_TOKEN: retrievalToken,
  LENS_MODEL_RUNTIME_URL: "http://127.0.0.1:8793/",
  LENS_MODEL_RUNTIME_WORKLOAD_TOKEN: runtimeToken,
  LENS_MODEL_ARTIFACT_DIGEST: modelArtifactDigest,
  LENS_AUTHORITY_URL: "http://127.0.0.1:8790/",
  LENS_AUTHORITY_WORKLOAD_TOKEN: authorityToken,
  LENS_ORCHESTRATOR_ASSERTION_PUBLIC_KEY: pemOneLine(assertionPublic),
  LENS_MEMORY_ASSERTION_PUBLIC_KEY: pemOneLine(memoryPublic),
  LENS_ORCHESTRATOR_AUTHORITY_PROFILE: "development",
  LENS_ALLOW_IN_MEMORY_AUTHORITIES: "true",
  LENS_CONVERSATION_HISTORY_PROFILE: "development",
  LENS_ALLOW_IN_MEMORY_HISTORY: "true",
  LENS_ROUTE_POLICY_MANIFEST_JSON: JSON.stringify(routePolicy),
  LENS_ROUTE_POLICY_MANIFEST_SIGNATURE: routePolicySignature,
  LENS_ROUTE_POLICY_OPS_KEY: routeOpsKey,
  LENS_APPROVED_CATALOG_URL: "http://127.0.0.1:3001/internal/v1/approved-models",
  LENS_APPROVED_CATALOG_TOKEN: catalogToken,
  LENS_COMPANY_RAG_PROFILE_JSON: JSON.stringify(companyRagProfile),
  LENS_USE_GATEWAY_TURN_ROUTER: "false",
  // Runtime sidecar signs scheduler leases (and usage receipts) with LENS_SCHEDULER_SIGNING_KEY;
  // orchestrator Model Gateway must verify those tokens alongside its own dev authority receipts.
  LENS_SCHEDULER_LEASE_PUBLIC_KEY: pemOneLine(schedulerPublicPem),
  LENS_USAGE_RECEIPT_PUBLIC_KEY: pemOneLine(schedulerPublicPem),
});

writeEnv("bff-rag.env", {
  RAG_PROVIDER_MODE: "internal",
  ORCHESTRATOR_URL: "http://127.0.0.1:8789/",
  ORCHESTRATOR_TOKEN: orchestratorToken,
  BFF_ASSERTION_PRIVATE_KEY: pemOneLine(assertionPrivate),
  MEMORY_ASSERTION_PRIVATE_KEY: pemOneLine(memoryPrivate),
  CONVERSATION_REFERENCE_SECRET: conversationSecret,
  CATALOG_WORKLOAD_TOKEN: catalogToken,
  PROVIDER_SECRET_WORKLOAD_TOKEN: providerSecretToken,
  PROVIDER_REGISTRY_PATH: resolve(dataDir, "providers.sqlite"),
  SECRET_STORE_KEY: createHash("sha256").update("lens-dev-secret-store").digest("hex"),
  COMPANY_RAG_PROFILE_JSON: JSON.stringify(companyRagProfile),
  INGESTION_ENABLED: "true",
  INGESTION_USE_LOCAL_EMBEDDINGS: "true",
  AUDIT_LEDGER_STORE_PATH: resolve(dataDir, "audit-ledger"),
  PUBLICATION_STORE_PATH: resolve(dataDir, "publication.sqlite"),
  INGESTION_STORE_PATH_PREFIX: resolve(dataDir, "ingestion"),
  RETRIEVAL_HTTP_PORT: "8788",
  RETRIEVAL_WORKLOAD_TOKEN: retrievalToken,
});

writeFileSync(resolve(stackDir, "README.txt"), [
  "Generated by: npm run rag:setup",
  "",
  "Document RAG (Task 5 lab layout):",
  "- Admin paste/ingest runs on the BFF (INGESTION_ENABLED).",
  "- Orchestrator retrieves from the same BFF process on :8788 (not a separate empty retrieval-service).",
  "",
  "1. Merge bff-rag.env into server/.env (keep OIDC + ADMIN_SUBJECTS + PROVIDER_PROFILE=development).",
  "2. Restart the BFF from server/ (must listen retrieval on 8788 before Orchestrator starts).",
  "3. Re-register your Google provider if the registry path changed.",
  "4. npm run dev:rag-stack",
  "5. Keep IdP (3005), BFF (3001), Vite (1420) running.",
  "6. Settings → Providers → paste a document, then Ask in chat about it.",
  "",
  "Ports: authority 8790, BFF retrieval 8788, orchestrator 8789, runtime 8793",
].join("\n"), "utf8");

console.log(`Wrote local RAG stack env to ${stackDir}`);
console.log("Next:");
console.log("  1. Append .local/rag-stack/bff-rag.env lines into server/.env");
console.log("  2. Restart BFF (ingestion + retrieval :8788), then: npm run rag:setup && npm run dev:rag-stack");
if (existsSync(resolve(root, "server/.env"))) {
  console.log("  (server/.env exists — merge manually; never commit secrets)");
}
