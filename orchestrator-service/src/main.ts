import { pathToFileURL } from "node:url";
import { generateKeyPairSync } from "node:crypto";
import { AuthorityHttpClient } from "./authorityClient";
import { createOrchestratorHttp } from "./http";
import { DevelopmentHeuristicTurnRouter } from "./router";
import { InternalInferenceClient } from "./internalInferenceClient";
import { RetrievalHttpClient } from "./retrievalClient";
import { ProductionOrchestratorService, SingleDigestModelSelection, SingleDigestModelEligibility, CompositeModelEligibility, EmployeeCatalogModelEligibility } from "./service";
import { InMemoryConversationHistory, type ConversationHistoryPort } from "./conversationHistory";
import { DurableConversationHistory } from "./durableConversationHistory";
import { MemoryServiceHttpClient } from "./memoryClient";
import { StaticModelCatalog, type ModelCatalogEntry, type ModelSelectionPort } from "./modelSelection";
import { bootstrapModelGovernance, type ModelEligibilityCheckPort, type ModelGovernanceManifest } from "./modelGovernance";
import { DelegatedSessionAssertionVerifier } from "../../services/security/delegatedSessionAssertion";
import { readFileSync } from "node:fs";
import { SignedRoutePolicyManifestPort, HmacRoutePolicyManifestSigner, Ed25519RoutePolicyManifestVerifier, RoutePolicyError, type RoutePolicyManifest, type RoutePolicyManifestVerifier, type RoutePolicyPort } from "./groundingPolicy";
import { AuthorityReceiptIssuer, Ed25519ReceiptVerifier, type ReceiptVerifier } from "../../services/security/authorityReceipt";
import { CompositeReceiptVerifier } from "../../services/security/compositeReceiptVerifier";
import { SqliteClaimStore, type ClaimStore } from "../../services/security/replayClaimStore";
import { SubjectDeviceModelUseAuthority, type ModelUseAuthorityPort } from "../../services/pdp/ModelUseAuthority";
import { ModelUseAuthorityHttpClient } from "../../services/pdp/ModelUseAuthorityHttpClient";
import { SqliteCostAuthority } from "../../services/cost-authority/SqliteCostAuthority";
import type { CostAuthorityPort } from "../../services/cost-authority/CostAuthority";
import { CostAuthorityHttpClient } from "../../services/cost-authority/CostAuthorityHttpClient";
import { SqliteAgentRunAuthority } from "../../services/agent-run-authority/SqliteAgentRunAuthority";
import type { AgentRunAuthorityPort } from "../../services/agent-run-authority/AgentRunAuthority";
import { AgentRunAuthorityHttpClient } from "../../services/agent-run-authority/AgentRunAuthorityHttpClient";
import { RuntimeAttemptHttpClient } from "../../services/runtime-attempt/RuntimeAttemptHttpClient";
import { loadApprovedCatalogFromBff } from "./approvedCatalogClient";
import { assertCompanyRagProfile } from "../../services/rag-profile/companyRagProfile";

export interface OrchestratorServiceEnv {
  PORT?: string;
  HOST?: string;
  ORCHESTRATOR_WORKLOAD_TOKEN: string;
  RETRIEVAL_URL: string;
  RETRIEVAL_WORKLOAD_TOKEN: string;
  MODEL_RUNTIME_URL: string;
  MODEL_RUNTIME_WORKLOAD_TOKEN: string;
  MODEL_ARTIFACT_DIGEST: `sha256:${string}` | string;
  AUTHORITY_URL: string;
  AUTHORITY_WORKLOAD_TOKEN: string;
  /** Ed25519 public key for BFF audience=orchestrator assertions. */
  ASSERTION_VERIFY_KEY?: string;
  /** Ed25519 public key for BFF audience=memory assertions. */
  MEMORY_ASSERTION_VERIFY_KEY?: string;
  CONVERSATION_HISTORY_PROFILE?: string;
  MEMORY_URL?: string;
  MEMORY_WORKLOAD_TOKEN?: string;
  /** Optional JSON map of { [model_ref]: { artifactDigest, approvedCapabilities } }. Sovereign-only internal artifacts; never a provider URL. */
  MODEL_CATALOG_JSON?: string;
  MODEL_DEFAULT_REF?: string;
  /** SQLite development/test-only path; production requires an injected replicated ConversationHistoryPort. */
  CONVERSATION_HISTORY_DB_PATH?: string;
  /** 64 hex chars (32 bytes), AES-256-GCM key for conversation turn text. Required with CONVERSATION_HISTORY_DB_PATH. */
  HISTORY_ENCRYPTION_KEY?: string;
  /** Dev/test-only escape hatch: skip durable history and use the process-local, non-durable, non-shared stopgap. Never set in production. */
  ALLOW_IN_MEMORY_HISTORY?: string;
  /** JSON ModelGovernanceManifest — drives a real ModelRegistry bootstrap (evidence gates, signed change-fences, live-revocable eligibility). Preferred over MODEL_CATALOG_JSON when both are set. */
  MODEL_GOVERNANCE_MANIFEST_JSON?: string;
  /** 64 hex chars (32 bytes), HMAC-SHA256 key authorizing registry changes (approve/promote/revoke/alias) and snapshot signing. Required with MODEL_GOVERNANCE_MANIFEST_JSON. */
  MODEL_GOVERNANCE_OPS_KEY?: string;
  /** JSON RoutePolicyManifest ({ manifestRevision, entries: RoutePolicyManifestEntry[] }) — the signed, server-owned route policy (Doc 004 §23). Required in production; there is no permissive default. Used as the INITIAL boot value; if ROUTE_POLICY_MANIFEST_PATH/ROUTE_POLICY_SIGNATURE_PATH are also set, SIGHUP re-reads from those files instead (env vars are fixed at process start and cannot themselves hot-reload). */
  ROUTE_POLICY_MANIFEST_JSON?: string;
  /** Signature over the canonicalized manifest — hex-encoded HMAC (legacy) or Ed25519 (preferred), matching whichever of ROUTE_POLICY_OPS_KEY/ROUTE_POLICY_VERIFY_KEY is set. Required with ROUTE_POLICY_MANIFEST_JSON. */
  ROUTE_POLICY_MANIFEST_SIGNATURE?: string;
  /** LEGACY: 64 hex chars (32 bytes), HMAC-SHA256 key verifying the route-policy manifest signature. A process holding this key could also SIGN policy — prefer ROUTE_POLICY_VERIFY_KEY (item 7). Ignored when ROUTE_POLICY_VERIFY_KEY is set. */
  ROUTE_POLICY_OPS_KEY?: string;
  /** PREFERRED (item 7): PEM-encoded Ed25519 PUBLIC key. The Orchestrator holds only verification capability — never a key that can sign policy. */
  ROUTE_POLICY_VERIFY_KEY?: string;
  /** Optional: file path to the live route-policy manifest JSON. When set alongside ROUTE_POLICY_SIGNATURE_PATH, SIGHUP triggers a bounded reload() from these files (item 7) instead of requiring a restart. */
  ROUTE_POLICY_MANIFEST_PATH?: string;
  /** Optional: file path to the hex-encoded signature over the manifest at ROUTE_POLICY_MANIFEST_PATH. */
  ROUTE_POLICY_SIGNATURE_PATH?: string;
  /** Required, explicit: development, test, or production. Governs how the shared model-use/Cost/Agent-run/receipt-verification/replay-claim authorities (items 1/2/3/5) are wired — see loadSharedAuthorities. */
  ORCHESTRATOR_AUTHORITY_PROFILE?: string;
  /** SQLite development/test-only path for the durable Cost authority. Required for development/test unless ALLOW_IN_MEMORY_AUTHORITIES=true. */
  COST_AUTHORITY_DB_PATH?: string;
  /** SQLite development/test-only path for the durable Agent-run authority. Required for development/test unless ALLOW_IN_MEMORY_AUTHORITIES=true. */
  AGENT_RUN_AUTHORITY_DB_PATH?: string;
  /** SQLite development/test-only path for the durable replay-claim store. Required for development/test unless ALLOW_IN_MEMORY_AUTHORITIES=true. */
  CLAIM_STORE_DB_PATH?: string;
  /** Dev/test-only escape hatch: skip durable authority storage and use SQLite's ":memory:" (real relational/atomic logic, zero durability, zero cross-replica sharing). Never set in production. */
  ALLOW_IN_MEMORY_AUTHORITIES?: string;
  MODEL_USE_AUTHORITY_URL?: string;
  MODEL_USE_AUTHORITY_WORKLOAD_TOKEN?: string;
  COST_AUTHORITY_URL?: string;
  COST_AUTHORITY_WORKLOAD_TOKEN?: string;
  AGENT_RUN_AUTHORITY_URL?: string;
  AGENT_RUN_AUTHORITY_WORKLOAD_TOKEN?: string;
  MODEL_USE_RECEIPT_PUBLIC_KEY?: string;
  COST_RECEIPT_PUBLIC_KEY?: string;
  AGENT_RUN_RECEIPT_PUBLIC_KEY?: string;
  SCHEDULER_LEASE_PUBLIC_KEY?: string;
  USAGE_RECEIPT_PUBLIC_KEY?: string;
  APPROVED_CATALOG_URL?: string;
  APPROVED_CATALOG_TOKEN?: string;
  COMPANY_RAG_PROFILE_JSON?: string;
  /** Dev lab: set false to use deterministic route classification instead of dispatching router model "default" (not in BFF catalog). */
  USE_GATEWAY_TURN_ROUTER?: string;
}

function loadEnv(): OrchestratorServiceEnv {
  return {
    PORT: process.env.PORT ?? "8789",
    HOST: process.env.HOST ?? "127.0.0.1",
    ORCHESTRATOR_WORKLOAD_TOKEN: process.env.LENS_ORCHESTRATOR_WORKLOAD_TOKEN ?? "",
    RETRIEVAL_URL: process.env.LENS_RETRIEVAL_URL ?? "",
    RETRIEVAL_WORKLOAD_TOKEN: process.env.LENS_RETRIEVAL_WORKLOAD_TOKEN ?? "",
    MODEL_RUNTIME_URL: process.env.LENS_MODEL_RUNTIME_URL ?? "",
    MODEL_RUNTIME_WORKLOAD_TOKEN: process.env.LENS_MODEL_RUNTIME_WORKLOAD_TOKEN ?? "",
    MODEL_ARTIFACT_DIGEST: process.env.LENS_MODEL_ARTIFACT_DIGEST ?? "",
    AUTHORITY_URL: process.env.LENS_AUTHORITY_URL ?? "",
    AUTHORITY_WORKLOAD_TOKEN: process.env.LENS_AUTHORITY_WORKLOAD_TOKEN ?? "",
    ASSERTION_VERIFY_KEY: process.env.LENS_ORCHESTRATOR_ASSERTION_PUBLIC_KEY,
    MEMORY_ASSERTION_VERIFY_KEY: process.env.LENS_MEMORY_ASSERTION_PUBLIC_KEY,
    CONVERSATION_HISTORY_PROFILE: process.env.LENS_CONVERSATION_HISTORY_PROFILE,
    MEMORY_URL: process.env.LENS_MEMORY_URL,
    MEMORY_WORKLOAD_TOKEN: process.env.LENS_MEMORY_WORKLOAD_TOKEN,
    MODEL_CATALOG_JSON: process.env.LENS_MODEL_CATALOG_JSON,
    MODEL_DEFAULT_REF: process.env.LENS_MODEL_DEFAULT_REF ?? "default",
    CONVERSATION_HISTORY_DB_PATH: process.env.LENS_CONVERSATION_HISTORY_DB_PATH,
    HISTORY_ENCRYPTION_KEY: process.env.LENS_HISTORY_ENCRYPTION_KEY,
    ALLOW_IN_MEMORY_HISTORY: process.env.LENS_ALLOW_IN_MEMORY_HISTORY ?? "",
    MODEL_GOVERNANCE_MANIFEST_JSON: process.env.LENS_MODEL_GOVERNANCE_MANIFEST_JSON,
    MODEL_GOVERNANCE_OPS_KEY: process.env.LENS_MODEL_GOVERNANCE_OPS_KEY,
    ROUTE_POLICY_MANIFEST_JSON: process.env.LENS_ROUTE_POLICY_MANIFEST_JSON,
    ROUTE_POLICY_MANIFEST_SIGNATURE: process.env.LENS_ROUTE_POLICY_MANIFEST_SIGNATURE,
    ROUTE_POLICY_OPS_KEY: process.env.LENS_ROUTE_POLICY_OPS_KEY,
    ROUTE_POLICY_VERIFY_KEY: process.env.LENS_ROUTE_POLICY_VERIFY_KEY,
    ROUTE_POLICY_MANIFEST_PATH: process.env.LENS_ROUTE_POLICY_MANIFEST_PATH,
    ROUTE_POLICY_SIGNATURE_PATH: process.env.LENS_ROUTE_POLICY_SIGNATURE_PATH,
    ORCHESTRATOR_AUTHORITY_PROFILE: process.env.LENS_ORCHESTRATOR_AUTHORITY_PROFILE,
    COST_AUTHORITY_DB_PATH: process.env.LENS_COST_AUTHORITY_DB_PATH,
    AGENT_RUN_AUTHORITY_DB_PATH: process.env.LENS_AGENT_RUN_AUTHORITY_DB_PATH,
    CLAIM_STORE_DB_PATH: process.env.LENS_CLAIM_STORE_DB_PATH,
    ALLOW_IN_MEMORY_AUTHORITIES: process.env.LENS_ALLOW_IN_MEMORY_AUTHORITIES ?? "",
    MODEL_USE_AUTHORITY_URL: process.env.LENS_MODEL_USE_AUTHORITY_URL,
    MODEL_USE_AUTHORITY_WORKLOAD_TOKEN: process.env.LENS_MODEL_USE_AUTHORITY_WORKLOAD_TOKEN,
    COST_AUTHORITY_URL: process.env.LENS_COST_AUTHORITY_URL,
    COST_AUTHORITY_WORKLOAD_TOKEN: process.env.LENS_COST_AUTHORITY_WORKLOAD_TOKEN,
    AGENT_RUN_AUTHORITY_URL: process.env.LENS_AGENT_RUN_AUTHORITY_URL,
    AGENT_RUN_AUTHORITY_WORKLOAD_TOKEN: process.env.LENS_AGENT_RUN_AUTHORITY_WORKLOAD_TOKEN,
    MODEL_USE_RECEIPT_PUBLIC_KEY: process.env.LENS_MODEL_USE_RECEIPT_PUBLIC_KEY,
    COST_RECEIPT_PUBLIC_KEY: process.env.LENS_COST_RECEIPT_PUBLIC_KEY,
    AGENT_RUN_RECEIPT_PUBLIC_KEY: process.env.LENS_AGENT_RUN_RECEIPT_PUBLIC_KEY,
    SCHEDULER_LEASE_PUBLIC_KEY: process.env.LENS_SCHEDULER_LEASE_PUBLIC_KEY,
    USAGE_RECEIPT_PUBLIC_KEY: process.env.LENS_USAGE_RECEIPT_PUBLIC_KEY,
    APPROVED_CATALOG_URL: process.env.LENS_APPROVED_CATALOG_URL,
    APPROVED_CATALOG_TOKEN: process.env.LENS_APPROVED_CATALOG_TOKEN,
    COMPANY_RAG_PROFILE_JSON: process.env.LENS_COMPANY_RAG_PROFILE_JSON,
    USE_GATEWAY_TURN_ROUTER: process.env.LENS_USE_GATEWAY_TURN_ROUTER,
  };
}

/**
 * Production startup fails closed if the signed route-policy authority is
 * absent, invalid, or unparseable (item 1/2). There is no permissive
 * fallback here — a missing/invalid manifest is a startup error, not a
 * runtime "grounding not required" default.
 */
/** Item 7: prefers the asymmetric verifier (ROUTE_POLICY_VERIFY_KEY) — the Orchestrator then holds only a public key, never anything capable of signing policy. Falls back to the legacy symmetric HMAC key only when the asymmetric one isn't configured. */
function routePolicyVerifier(env: OrchestratorServiceEnv): RoutePolicyManifestVerifier {
  if (env.ROUTE_POLICY_VERIFY_KEY) {
    return new Ed25519RoutePolicyManifestVerifier(env.ROUTE_POLICY_VERIFY_KEY);
  }
  if (env.ROUTE_POLICY_OPS_KEY) {
    return new HmacRoutePolicyManifestSigner(Buffer.from(env.ROUTE_POLICY_OPS_KEY, "hex"));
  }
  throw new Error(
    "LENS_ROUTE_POLICY_VERIFY_KEY (preferred, Ed25519 public key) or LENS_ROUTE_POLICY_OPS_KEY (legacy HMAC key) is required — " +
    "there is no permissive route-policy default in production.",
  );
}

export function loadRoutePolicy(env: OrchestratorServiceEnv): RoutePolicyPort {
  if (!env.ROUTE_POLICY_MANIFEST_JSON || !env.ROUTE_POLICY_MANIFEST_SIGNATURE) {
    throw new Error(
      "LENS_ROUTE_POLICY_MANIFEST_JSON and LENS_ROUTE_POLICY_MANIFEST_SIGNATURE are required — " +
      "there is no permissive route-policy default in production. Sign a manifest with signRoutePolicyManifestEd25519() (preferred) or signRoutePolicyManifest() and supply it here.",
    );
  }
  const manifest = JSON.parse(env.ROUTE_POLICY_MANIFEST_JSON) as RoutePolicyManifest;
  return new SignedRoutePolicyManifestPort(manifest, env.ROUTE_POLICY_MANIFEST_SIGNATURE, routePolicyVerifier(env));
}

/**
 * Item 7: bounded hot-reload from the file pair at
 * ROUTE_POLICY_MANIFEST_PATH/ROUTE_POLICY_SIGNATURE_PATH, wired to SIGHUP.
 * Env vars are fixed at process start (they cannot themselves change without
 * a restart), so a real reload path has to read from something that CAN
 * change on disk between requests — these two files. A malformed file, a
 * signature that fails verification, or a manifest that fails `reload()`'s
 * own rollback/duplicate/expiry checks is logged and otherwise ignored: the
 * previously-verified manifest keeps serving, so a bad reload attempt never
 * takes the route policy down.
 */
export function reloadRoutePolicyFromDisk(env: OrchestratorServiceEnv, routePolicy: RoutePolicyPort, logger: Pick<typeof console, "error" | "info"> = console): void {
  if (!(routePolicy instanceof SignedRoutePolicyManifestPort)) return;
  if (!env.ROUTE_POLICY_MANIFEST_PATH || !env.ROUTE_POLICY_SIGNATURE_PATH) return;
  try {
    const manifest = JSON.parse(readFileSync(env.ROUTE_POLICY_MANIFEST_PATH, "utf8")) as RoutePolicyManifest;
    const signature = readFileSync(env.ROUTE_POLICY_SIGNATURE_PATH, "utf8").trim();
    routePolicy.reload(manifest, signature);
    logger.info(`Route policy reloaded to manifest revision ${routePolicy.currentManifestRevision()}.`);
  } catch (error) {
    const code = error instanceof RoutePolicyError ? error.code : "PARSE_OR_IO_ERROR";
    logger.error(`Route policy reload rejected (${code}); the previously-verified manifest (revision ${routePolicy.currentManifestRevision()}) remains in effect.`);
  }
}

/**
 * Preference order: a signed ModelRegistry manifest (real evidence gates,
 * live revocation) over a static alias catalog (validated, but no evidence
 * workflow or live revocation) over the single-digest legacy default
 * (scoped to exactly one pre-approved artifact). Never a blanket-permissive
 * fallback in any branch.
 */
function loadModelGovernance(env: OrchestratorServiceEnv): { modelSelection?: ModelSelectionPort; modelEligibility?: ModelEligibilityCheckPort } {
  if (env.MODEL_GOVERNANCE_MANIFEST_JSON && env.MODEL_GOVERNANCE_OPS_KEY) {
    const manifest = JSON.parse(env.MODEL_GOVERNANCE_MANIFEST_JSON) as ModelGovernanceManifest;
    const governance = bootstrapModelGovernance(manifest, env.MODEL_GOVERNANCE_OPS_KEY);
    return { modelSelection: governance, modelEligibility: governance };
  }
  if (env.MODEL_CATALOG_JSON) {
    const parsed = JSON.parse(env.MODEL_CATALOG_JSON) as Record<string, ModelCatalogEntry>;
    // Without a governance manifest there is no live eligibility source to
    // trust for any digest but the single pinned one (the Orchestrator falls
    // back to SingleDigestModelEligibility, which only approves
    // MODEL_ARTIFACT_DIGEST). A catalog alias resolving to any other digest
    // would otherwise pass alias resolution at boot and only fail later, at
    // request time, inside a live user's turn. Fail closed at boot instead.
    const offending = Object.entries(parsed).filter(([, entry]) => entry.artifactDigest !== env.MODEL_ARTIFACT_DIGEST);
    if (offending.length > 0) {
      throw new Error(
        `LENS_MODEL_CATALOG_JSON contains model_ref(s) [${offending.map(([ref]) => ref).join(", ")}] whose artifact digest ` +
        "does not match LENS_MODEL_ARTIFACT_DIGEST. Without LENS_MODEL_GOVERNANCE_MANIFEST_JSON there is no live eligibility " +
        "source to approve any other digest — every catalog entry must resolve to the single pinned artifact.",
      );
    }
    return { modelSelection: new StaticModelCatalog(parsed, env.MODEL_DEFAULT_REF ?? "default") };
  }
  return {};
}

/**
 * Item 6: enumerate every `router_model_ref` a live route-policy scope could
 * resolve to and validate each against Registry eligibility/capabilities —
 * at startup, and again on every readiness probe (so a model revoked after
 * boot degrades readiness without a restart, matching how `hasLiveEntries`
 * already degrades readiness on manifest expiry). A scope whose
 * `router_model_ref` cannot resolve an artifact digest (unknown alias) or
 * whose resolved digest is not eligible for `rag-route-classification`
 * (unavailable, unauthorized, revoked, or incapable) fails this check.
 */
export async function checkRoutePolicyModelsReady(
  routePolicy: RoutePolicyPort,
  modelSelection: ModelSelectionPort,
  modelEligibility: ModelEligibilityCheckPort,
): Promise<{ ready: true } | { ready: false; offending: readonly string[] }> {
  if (!(routePolicy instanceof SignedRoutePolicyManifestPort)) return { ready: true };
  const denyEpoch = modelEligibility.currentDenyEpoch();
  const offending: string[] = [];
  for (const entry of routePolicy.liveEntries()) {
    try {
      const { artifactDigest } = modelSelection.resolve({ modelRef: entry.routerModelRef, capability: "rag-route-classification" });
      await modelEligibility.resolveEndpoint({ capability: "rag-route-classification", artifactDigest, denyEpoch });
      // resolveEndpoint alone does not verify the artifact is approved for
      // rag-route-classification SPECIFICALLY (RegistryModelGovernance's
      // capability param is otherwise advisory only) — a model approved
      // exclusively for a different capability (e.g. final generation) must
      // not pass this gate just because it happens to be routable for
      // something. Ports without a real per-capability distinction (the
      // SingleDigest* fallback) omit capabilityApproved and are trusted.
      if (modelEligibility.capabilityApproved && !modelEligibility.capabilityApproved({ artifactDigest, capability: "rag-route-classification" })) {
        throw new Error("router model is not approved for rag-route-classification");
      }
    } catch {
      offending.push(entry.routerModelRef);
    }
  }
  return offending.length === 0 ? { ready: true } : { ready: false, offending };
}

export interface OrchestratorMainDependencies {
  /** Real network client to the shared model-use authority (Doc 004 §23 AuthorizeGenerate/AuthorizeModelUse). Required in production; there is no permissive default and no in-repo network implementation ships in this package — deployers must supply one. */
  productionModelUseAuthority?: ModelUseAuthorityPort;
  /** Real network client to the shared Cost owner (Doc 019). Required in production — "Production Orchestrator must use an injected network client"; SQLite (even durable) is a development/test profile only, never production. */
  productionCostAuthority?: CostAuthorityPort;
  /** Real network client to the shared Agent-run/step authority (Doc 014). Required in production. */
  productionAgentRunAuthority?: AgentRunAuthorityPort;
  /** Verifier for receipts issued by the production authorities above — must hold only the public key. Required in production. */
  productionReceiptVerifier?: ReceiptVerifier;
  /** Shared, cross-replica replay-claim store backing ModelGateway's one-use enforcement. Required in production. */
  productionClaimStore?: ClaimStore;
  /** Readiness for the four adapters above — must reflect the remote authority, not process-local construction. Required in production. */
  productionAuthoritiesReady?: () => Promise<boolean>;
}

export type SharedAuthorities = {
  modelUseAuthority: ModelUseAuthorityPort;
  costAuthority: CostAuthorityPort;
  agentRunAuthority: AgentRunAuthorityPort;
  receiptVerifier: ReceiptVerifier;
  claimStore: ClaimStore;
  ready: () => Promise<boolean>;
};

function parseAuthorityProfile(value: string | undefined): "development" | "test" | "production" {
  if (value === "development" || value === "test" || value === "production") return value;
  throw new Error("LENS_ORCHESTRATOR_AUTHORITY_PROFILE must be explicitly set to development, test, or production.");
}

/**
 * Items 1/2/3/5/7: the model-use, Cost, and Agent-run authorities, the receipt verifier that
 * checks their output, and the replay-claim store ModelGateway claims one-use dispatch
 * receipts against. Production constructs HTTP clients from LENS_*_URL, workload tokens,
 * and public verification keys. Adapter injection remains a test override only.
 * SQLite/in-memory remain development/test-only.
 */
export function loadSharedAuthorities(
  env: OrchestratorServiceEnv,
  dependencies: OrchestratorMainDependencies,
  modelEligibility: Pick<ModelEligibilityCheckPort, "resolveEndpoint" | "currentDenyEpoch">,
  now: () => number = () => Date.now(),
): SharedAuthorities {
  const profile = parseAuthorityProfile(env.ORCHESTRATOR_AUTHORITY_PROFILE);
  if (profile === "production") {
    if (env.ALLOW_IN_MEMORY_AUTHORITIES === "true" || env.COST_AUTHORITY_DB_PATH || env.AGENT_RUN_AUTHORITY_DB_PATH || env.CLAIM_STORE_DB_PATH) {
      throw new Error("SQLite and in-memory shared authorities are development/test-only; production requires network authorities.");
    }
    if (dependencies.productionModelUseAuthority && dependencies.productionCostAuthority && dependencies.productionAgentRunAuthority && dependencies.productionReceiptVerifier && dependencies.productionClaimStore && dependencies.productionAuthoritiesReady) {
      return {
        modelUseAuthority: dependencies.productionModelUseAuthority,
        costAuthority: dependencies.productionCostAuthority,
        agentRunAuthority: dependencies.productionAgentRunAuthority,
        receiptVerifier: dependencies.productionReceiptVerifier,
        claimStore: dependencies.productionClaimStore,
        ready: dependencies.productionAuthoritiesReady,
      };
    }
    const modelUseUrl = env.MODEL_USE_AUTHORITY_URL || env.AUTHORITY_URL;
    const modelUseToken = env.MODEL_USE_AUTHORITY_WORKLOAD_TOKEN || env.AUTHORITY_WORKLOAD_TOKEN;
    if (!env.COST_AUTHORITY_URL || !env.COST_AUTHORITY_WORKLOAD_TOKEN || !env.AGENT_RUN_AUTHORITY_URL || !env.AGENT_RUN_AUTHORITY_WORKLOAD_TOKEN) {
      throw new Error("Production requires LENS_COST_AUTHORITY_URL/TOKEN and LENS_AGENT_RUN_AUTHORITY_URL/TOKEN.");
    }
    if (!env.MODEL_USE_RECEIPT_PUBLIC_KEY || !env.COST_RECEIPT_PUBLIC_KEY || !env.AGENT_RUN_RECEIPT_PUBLIC_KEY || !env.SCHEDULER_LEASE_PUBLIC_KEY) {
      throw new Error("Production requires receipt verification public keys for model-use, Cost, Agent-run, and Scheduler leases.");
    }
    const modelUse = dependencies.productionModelUseAuthority ?? new ModelUseAuthorityHttpClient(modelUseUrl, modelUseToken);
    const cost = dependencies.productionCostAuthority ?? new CostAuthorityHttpClient(env.COST_AUTHORITY_URL, env.COST_AUTHORITY_WORKLOAD_TOKEN);
    const agentRunClient = new AgentRunAuthorityHttpClient(env.AGENT_RUN_AUTHORITY_URL, env.AGENT_RUN_AUTHORITY_WORKLOAD_TOKEN);
    const agentRun = dependencies.productionAgentRunAuthority ?? agentRunClient;
    const claims = dependencies.productionClaimStore ?? agentRunClient;
    const verifier = dependencies.productionReceiptVerifier ?? new CompositeReceiptVerifier([
      env.MODEL_USE_RECEIPT_PUBLIC_KEY,
      env.COST_RECEIPT_PUBLIC_KEY,
      env.AGENT_RUN_RECEIPT_PUBLIC_KEY,
      env.SCHEDULER_LEASE_PUBLIC_KEY,
    ], { now });
    const ready = dependencies.productionAuthoritiesReady ?? (async () => {
      const [modelReady, costReady, agentReady] = await Promise.all([
        modelUse instanceof ModelUseAuthorityHttpClient ? modelUse.ready() : Promise.resolve(true),
        cost instanceof CostAuthorityHttpClient ? cost.ready() : Promise.resolve(true),
        agentRunClient.ready(),
      ]);
      return modelReady && costReady && agentReady;
    });
    return {
      modelUseAuthority: modelUse,
      costAuthority: cost,
      agentRunAuthority: agentRun,
      receiptVerifier: verifier,
      claimStore: claims,
      ready,
    };
  }
  const allowInMemory = env.ALLOW_IN_MEMORY_AUTHORITIES === "true";
  if (!allowInMemory && !(env.COST_AUTHORITY_DB_PATH && env.AGENT_RUN_AUTHORITY_DB_PATH && env.CLAIM_STORE_DB_PATH)) {
    throw new Error(
      `LENS_COST_AUTHORITY_DB_PATH, LENS_AGENT_RUN_AUTHORITY_DB_PATH, and LENS_CLAIM_STORE_DB_PATH are required for ${profile} durable authority storage. ` +
      "Set LENS_ALLOW_IN_MEMORY_AUTHORITIES=true only for local development/tests.",
    );
  }
  const costPath = allowInMemory && !env.COST_AUTHORITY_DB_PATH ? ":memory:" : env.COST_AUTHORITY_DB_PATH!;
  const agentRunPath = allowInMemory && !env.AGENT_RUN_AUTHORITY_DB_PATH ? ":memory:" : env.AGENT_RUN_AUTHORITY_DB_PATH!;
  const claimPath = allowInMemory && !env.CLAIM_STORE_DB_PATH ? ":memory:" : env.CLAIM_STORE_DB_PATH!;
  // A fresh keypair per process boot is sufficient here: every receipt this bundle issues is
  // claimed/consumed synchronously within the same process and request that issued it (short
  // TTL, single-use) — only the durable ledger rows (reservations, consumed units, step
  // state) need to survive a restart, and those don't depend on the signing key.
  const keys = generateKeyPairSync("ed25519");
  const issuer = new AuthorityReceiptIssuer(keys.privateKey, { now });
  // Dev/test authorities mint model-use/Cost/Agent-run receipts with the throwaway
  // keypair above, but scheduler leases (and optionally usage receipts) are signed
  // by the runtime sidecar's own key — Model Gateway must verify both issuers.
  const verificationKeys: (string | import("node:crypto").KeyObject)[] = [keys.publicKey];
  if (env.SCHEDULER_LEASE_PUBLIC_KEY) {
    verificationKeys.push(env.SCHEDULER_LEASE_PUBLIC_KEY.replace(/\\n/g, "\n"));
  }
  const receiptVerifier = verificationKeys.length === 1
    ? new Ed25519ReceiptVerifier(verificationKeys[0], { now })
    : new CompositeReceiptVerifier(verificationKeys, { now });
  return {
    modelUseAuthority: new SubjectDeviceModelUseAuthority(
      { subject: () => ({ revision: 1, active: true, groups: [] }), device: () => ({ revision: 1, compliant: true }) },
      modelEligibility,
      issuer,
      now,
    ),
    costAuthority: new SqliteCostAuthority(costPath, issuer, now),
    agentRunAuthority: new SqliteAgentRunAuthority(agentRunPath, issuer, now),
    receiptVerifier,
    claimStore: new SqliteClaimStore(claimPath),
    ready: async () => true,
  };
}

function parseConversationHistoryProfile(value: string | undefined): "development" | "test" | "production" {
  if (value === "development" || value === "test" || value === "production") return value;
  throw new Error("LENS_CONVERSATION_HISTORY_PROFILE must be explicitly set to development, test, or production.");
}

export function loadConversationHistory(env: OrchestratorServiceEnv, _dependencies: OrchestratorMainDependencies = {}): { history: ConversationHistoryPort; purge?: () => number } {
  const profile = parseConversationHistoryProfile(env.CONVERSATION_HISTORY_PROFILE);
  if (profile === "production") {
    if (env.ALLOW_IN_MEMORY_HISTORY === "true" || env.CONVERSATION_HISTORY_DB_PATH || env.HISTORY_ENCRYPTION_KEY) {
      throw new Error("SQLite and in-memory conversation history are development/test-only; production requires a replicated ConversationHistoryPort.");
    }
    if (!env.MEMORY_URL || !env.MEMORY_WORKLOAD_TOKEN) throw new Error("Production conversation history requires LENS_MEMORY_URL and LENS_MEMORY_WORKLOAD_TOKEN for the replicated Memory Service.");
    return { history: new MemoryServiceHttpClient(env.MEMORY_URL, env.MEMORY_WORKLOAD_TOKEN) };
  }
  if (env.CONVERSATION_HISTORY_DB_PATH && env.HISTORY_ENCRYPTION_KEY) {
    const durable = new DurableConversationHistory({
      dbPath: env.CONVERSATION_HISTORY_DB_PATH,
      encryptionKeyHex: env.HISTORY_ENCRYPTION_KEY,
    });
    return { history: durable, purge: () => durable.purgeExpired() };
  }
  if (env.ALLOW_IN_MEMORY_HISTORY === "true") {
    return { history: new InMemoryConversationHistory() };
  }
  throw new Error(
    `LENS_CONVERSATION_HISTORY_DB_PATH and LENS_HISTORY_ENCRYPTION_KEY are required for ${profile} durable test storage. ` +
    "Set LENS_ALLOW_IN_MEMORY_HISTORY=true only for local development/tests.",
  );
}

export async function main(env: OrchestratorServiceEnv = loadEnv(), dependencies: OrchestratorMainDependencies = {}): Promise<{ close: () => Promise<void> }> {
  if (env.ORCHESTRATOR_WORKLOAD_TOKEN.length < 32) {
    throw new Error("LENS_ORCHESTRATOR_WORKLOAD_TOKEN must contain at least 32 characters.");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(env.MODEL_ARTIFACT_DIGEST)) {
    throw new Error("LENS_MODEL_ARTIFACT_DIGEST must be a sha256 digest.");
  }
  const port = Number(env.PORT ?? "8789");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be an integer from 1 to 65535.");
  if (!env.ASSERTION_VERIFY_KEY) throw new Error("LENS_ORCHESTRATOR_ASSERTION_PUBLIC_KEY is required for request-bound session proof verification.");
  if (!env.MEMORY_ASSERTION_VERIFY_KEY) throw new Error("LENS_MEMORY_ASSERTION_PUBLIC_KEY is required for Memory request proof verification.");
  const assertionVerifier = new DelegatedSessionAssertionVerifier(env.ASSERTION_VERIFY_KEY);
  const memoryAssertionVerifier = new DelegatedSessionAssertionVerifier(env.MEMORY_ASSERTION_VERIFY_KEY);
  const retrieval = new RetrievalHttpClient(env.RETRIEVAL_URL, env.RETRIEVAL_WORKLOAD_TOKEN);
  const inference = new InternalInferenceClient(env.MODEL_RUNTIME_URL, env.MODEL_RUNTIME_WORKLOAD_TOKEN);
  const attempts = new RuntimeAttemptHttpClient(env.MODEL_RUNTIME_URL, env.MODEL_RUNTIME_WORKLOAD_TOKEN);
  const authority = new AuthorityHttpClient(env.AUTHORITY_URL, env.AUTHORITY_WORKLOAD_TOKEN);
  const { history, purge } = loadConversationHistory(env, dependencies);
  const { modelSelection, modelEligibility } = loadModelGovernance(env);
  const routePolicy = loadRoutePolicy(env);
  // Item 6: enumerate every router_model_ref a live route-policy scope could
  // resolve to and validate it against the exact same eligibility source the
  // service itself will use at request time — the RegistryModelGovernance
  // above when configured, otherwise the same SingleDigestModel* fallback
  // ProductionOrchestratorService falls back to. Fail startup outright if
  // any active scope references a router model that cannot resolve or is
  // not eligible for rag-route-classification.
  const modelArtifactDigest = env.MODEL_ARTIFACT_DIGEST as `sha256:${string}`;
  const pinnedModelEligibility = modelEligibility ?? new SingleDigestModelEligibility(modelArtifactDigest, () => Date.now());
  const ragProfile = env.COMPANY_RAG_PROFILE_JSON
    ? assertCompanyRagProfile(JSON.parse(env.COMPANY_RAG_PROFILE_JSON))
    : undefined;
  const employeeCatalog = env.APPROVED_CATALOG_URL && env.APPROVED_CATALOG_TOKEN
    ? await loadApprovedCatalogFromBff({
      catalogUrl: env.APPROVED_CATALOG_URL,
      token: env.APPROVED_CATALOG_TOKEN,
      ragProfile,
    })
    : undefined;
  const effectiveModelSelection = modelSelection ?? new SingleDigestModelSelection(modelArtifactDigest);
  const effectiveModelEligibility = employeeCatalog && !modelEligibility
    ? new CompositeModelEligibility([
      pinnedModelEligibility,
      new EmployeeCatalogModelEligibility(employeeCatalog),
    ])
    : pinnedModelEligibility;
  const routePolicyModelsAtBoot = await checkRoutePolicyModelsReady(routePolicy, effectiveModelSelection, effectiveModelEligibility);
  if (!routePolicyModelsAtBoot.ready) {
    throw new Error(
      `The signed route-policy manifest references router_model_ref(s) [${routePolicyModelsAtBoot.offending.join(", ")}] that are ` +
      "unavailable, unauthorized, revoked, or incapable of rag-route-classification. Fix the manifest or the model registry before starting.",
    );
  }
  const sharedAuthorities = loadSharedAuthorities(env, dependencies, effectiveModelEligibility);
  if (parseAuthorityProfile(env.ORCHESTRATOR_AUTHORITY_PROFILE) === "production" && !env.USAGE_RECEIPT_PUBLIC_KEY) {
    throw new Error("Production requires LENS_USAGE_RECEIPT_PUBLIC_KEY to verify sidecar-signed usage.");
  }
  // Fail-closed like every other production port (FailClosedRoutePolicyPort,
  // FailClosedOutputGuardPort, ...; see groundingPolicy.ts): production must not
  // silently fall back to resolveContext's dev-only "enterprise-docs"/"hybrid"
  // literals just because the profile env var was left unset.
  if (parseAuthorityProfile(env.ORCHESTRATOR_AUTHORITY_PROFILE) === "production" && !env.COMPANY_RAG_PROFILE_JSON) {
    throw new Error("Production requires LENS_COMPANY_RAG_PROFILE_JSON so retrieval corpus/mode is profile-driven, not a hard-coded default.");
  }
  const service = new ProductionOrchestratorService({
    retrieval,
    scheduler: inference,
    runtime: inference,
    generationContextFence: authority,
    auditAdmission: authority,
    outputGuards: authority,
    outputStore: authority,
    turnState: authority,
    disclosure: authority,
    resultAuthorization: authority,
    modelUseAuthority: sharedAuthorities.modelUseAuthority,
    costAuthority: sharedAuthorities.costAuthority,
    agentRunAuthority: sharedAuthorities.agentRunAuthority,
    receiptVerifier: sharedAuthorities.receiptVerifier,
    claimStore: sharedAuthorities.claimStore,
    runtimeAttempts: attempts,
    usageReceiptPublicKey: env.USAGE_RECEIPT_PUBLIC_KEY,
    routePolicy,
    // The route-classification model step dispatches through the same
    // ModelGateway/Scheduler as final generation when LENS_USE_GATEWAY_TURN_ROUTER
    // is not false. Lab stacks often set it false; without a stand-in, non-ack turns
    // become CLARIFY or forced SINGLE_RETRIEVAL. DevelopmentHeuristicTurnRouter keeps
    // greetings/unrelated chat on NO_RETRIEVAL and enterprise/doc questions on retrieval.
    useGatewayTurnRouter: env.USE_GATEWAY_TURN_ROUTER !== "false",
    ...(env.USE_GATEWAY_TURN_ROUTER === "false" && parseAuthorityProfile(env.ORCHESTRATOR_AUTHORITY_PROFILE) === "development"
      ? { turnRouter: new DevelopmentHeuristicTurnRouter() }
      : {}),
    modelArtifactDigest: env.MODEL_ARTIFACT_DIGEST as `sha256:${string}`,
    modelSelection: effectiveModelSelection,
    modelEligibility: effectiveModelEligibility,
    employeeCatalog,
    ragProfile,
    conversationHistory: history,
  });
  const http = createOrchestratorHttp({
    workloadToken: env.ORCHESTRATOR_WORKLOAD_TOKEN,
    handleChat: (request, signal) => service.handleChat(request, signal),
    sessionAssertionVerifier: assertionVerifier,
    memoryAssertionVerifier,
  });

  const PURGE_INTERVAL_MS = 60 * 60 * 1000;
  const purgeTimer = purge ? setInterval(() => purge(), PURGE_INTERVAL_MS) : undefined;
  purgeTimer?.unref();

  // Fail closed: /readyz starts not-ready and only flips true once every
  // hard dependency (Retrieval, Authority, and production Memory) confirms it is reachable,
  // refreshed on a bounded interval so probes never fabricate success or
  // hammer either dependency.
  const READINESS_TTL_MS = 5_000;
  const probe = async (baseUrl: string): Promise<boolean> => {
    try {
      const url = new URL("/readyz", baseUrl);
      const response = await fetch(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(2_000) });
      return response.ok;
    } catch {
      return false;
    }
  };
  const checkReady = async (): Promise<boolean> => {
    const memoryReady = parseConversationHistoryProfile(env.CONVERSATION_HISTORY_PROFILE) === "production"
      ? await probe(env.MEMORY_URL ?? "")
      : true;
    const [retrievalReady, authorityReady, runtimeReady] = await Promise.all([probe(env.RETRIEVAL_URL), probe(env.AUTHORITY_URL), probe(env.MODEL_RUNTIME_URL)]);
    // The signed route-policy manifest was already verified (signature +
    // non-empty) at startup — main() would have thrown otherwise. What can
    // still degrade at runtime is every entry expiring, at which point every
    // future turn would deny with POLICY_EXPIRED; readiness reflects that.
    const routePolicyReady = routePolicy instanceof SignedRoutePolicyManifestPort ? routePolicy.hasLiveEntries() : true;
    // Item 6: a router model revoked/de-registered after boot must degrade
    // readiness without a restart — re-checked on the same TTL as the other
    // dependency probes, against the exact eligibility source the service uses.
    const routePolicyModelsReady = (await checkRoutePolicyModelsReady(routePolicy, effectiveModelSelection, effectiveModelEligibility)).ready;
    const sharedAuthoritiesReady = await sharedAuthorities.ready();
    return retrievalReady && authorityReady && runtimeReady && memoryReady && routePolicyReady && routePolicyModelsReady && sharedAuthoritiesReady;
  };
  http.setReadiness(await checkReady());
  const readinessTimer = setInterval(() => {
    void checkReady().then((ready) => http.setReadiness(ready));
  }, READINESS_TTL_MS);
  readinessTimer.unref();

  // Item 7: bounded hot-reload, triggered by SIGHUP — a bad reload attempt
  // (invalid signature, rollback, duplicate revision, no live entries) is
  // logged and otherwise a no-op; see reloadRoutePolicyFromDisk's own doc
  // comment. Only registered when both file paths are configured, matching
  // this being an opt-in capability, not a requirement.
  const onSighup = env.ROUTE_POLICY_MANIFEST_PATH && env.ROUTE_POLICY_SIGNATURE_PATH
    ? () => reloadRoutePolicyFromDisk(env, routePolicy)
    : undefined;
  if (onSighup) process.on("SIGHUP", onSighup);

  await http.listen(port, env.HOST ?? "127.0.0.1");
  return {
    close: async () => {
      if (onSighup) process.removeListener("SIGHUP", onSighup);
      clearInterval(readinessTimer);
      if (purgeTimer) clearInterval(purgeTimer);
      if (history instanceof DurableConversationHistory) await history.close();
      if (sharedAuthorities.costAuthority instanceof SqliteCostAuthority) sharedAuthorities.costAuthority.close();
      if (sharedAuthorities.agentRunAuthority instanceof SqliteAgentRunAuthority) sharedAuthorities.agentRunAuthority.close();
      if (sharedAuthorities.claimStore instanceof SqliteClaimStore) sharedAuthorities.claimStore.close();
      await http.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then(({ close }) => {
    let closing = false;
    const shutdown = (): void => {
      if (closing) return;
      closing = true;
      void close().finally(() => process.exit(0));
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  }).catch(() => {
    process.exitCode = 1;
  });
}
