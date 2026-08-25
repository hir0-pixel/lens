import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createAuthorityHttp } from "./http";
import { AuthorityService, type GovernancePort, type ProductionAuditAdmissionPort, type ProductionOutputDisclosureAuthorizationPort } from "./service";
import { createAuthorityStorage, type ProductionAuthorityStorageAdapter, type AuthorityStorageProfile } from "./store";
import { OutputBlobCrypto } from "./outputCrypto";
import { readFileSync } from "node:fs";
import { AuthorityReceiptIssuer } from "../../services/security/authorityReceipt";
import { SubjectDeviceModelUseAuthority } from "../../services/pdp/ModelUseAuthority";
import {
  DevAutoProvisioningResourceFactReader,
  DevAutoProvisioningSubjectDeviceDirectory,
  FailClosedContextFencePolicy,
  HmacFenceSigner,
  InMemoryPdpAuditPort,
  PdpBackedContextFencePolicy,
  bootstrapGenerationPdp,
  type ContextFencePolicyPort,
} from "./pdpAdapter";
import { GovernanceAuthority } from "../../services/governance/GovernanceAuthority";

export interface AuthorityServiceEnv {
  PORT?: string;
  HOST?: string;
  AUTHORITY_WORKLOAD_TOKEN: string;
  AUTHORITY_DB_PATH?: string;
  AUTHORITY_STORAGE_PROFILE?: string;
  AUTHORITY_OUTPUT_KEY_HEX: string;
  /**
   * DEV/TEST ONLY. When "true", wires a real PolicyDecisionPoint against an
   * auto-registering subject/device directory and a fresh GovernanceAuthority
   * that auto-publishes any resource ref it is asked about. This makes
   * revalidate() actually run through the real PDP decision machinery
   * (decideBatch/consumeFence, revision pinning, single-use fences) so local
   * development and CI can exercise the real code path — but it is NOT a
   * real identity/document-governance integration, and must never be set in
   * a real deployment. Without it, the service starts but fails closed:
   * every revalidate() call is denied until a real ContextFencePolicyPort
   * (backed by real corporate IAM/MDM/document-governance systems) is wired
   * in by the deployer.
   */
  AUTHORITY_ALLOW_DEV_FACTS?: string;
  /** Ops key for the dev PDP's HMAC fence signer. Required when AUTHORITY_ALLOW_DEV_FACTS=true; auto-generated (and unusable across restarts) otherwise. */
  AUTHORITY_DEV_PDP_SIGNING_KEY?: string;
  MODEL_USE_SIGNING_KEY?: string;
  MODEL_ARTIFACT_DIGEST?: string;
}

function loadEnv(): AuthorityServiceEnv {
  return {
    PORT: process.env.PORT ?? "8790",
    HOST: process.env.HOST ?? "127.0.0.1",
    AUTHORITY_WORKLOAD_TOKEN: process.env.AUTHORITY_WORKLOAD_TOKEN ?? "",
    AUTHORITY_DB_PATH: process.env.LENS_AUTHORITY_DB_PATH,
    AUTHORITY_STORAGE_PROFILE: process.env.LENS_AUTHORITY_STORAGE_PROFILE,
    AUTHORITY_OUTPUT_KEY_HEX: process.env.LENS_AUTHORITY_OUTPUT_KEY_HEX ?? "",
    AUTHORITY_ALLOW_DEV_FACTS: process.env.LENS_AUTHORITY_ALLOW_DEV_FACTS,
    AUTHORITY_DEV_PDP_SIGNING_KEY: process.env.LENS_AUTHORITY_DEV_PDP_SIGNING_KEY,
    MODEL_USE_SIGNING_KEY: process.env.LENS_MODEL_USE_SIGNING_KEY,
    MODEL_ARTIFACT_DIGEST: process.env.LENS_MODEL_ARTIFACT_DIGEST,
  };
}

/**
 * A resource/subject/device directory that auto-provisions on first sight —
 * every resource is treated as published/valid, every subject active, every
 * device compliant. This is ONLY acceptable because it is gated behind
 * `AUTHORITY_ALLOW_DEV_FACTS=true` and documented as such everywhere it is
 * constructed; it exists so the real PDP decision machinery (fences,
 * revision pinning, audit, single-use consumption) can be exercised in
 * development/CI without hand-registering every fixture. A production
 * deployment must NEVER set this flag — see loadContextFencePolicy below.
 */
function loadContextFencePolicy(env: AuthorityServiceEnv, governance: GovernanceAuthority, now: () => number): ContextFencePolicyPort {
  if (env.AUTHORITY_ALLOW_DEV_FACTS !== "true") {
    return new FailClosedContextFencePolicy();
  }
  const directory = new DevAutoProvisioningSubjectDeviceDirectory();
  // Uses the SAME GovernanceAuthority instance AuthorityService books
  // disclosures against, not a separate one — resource registration and the
  // disclosure exposure ledger must agree within one process.
  const resourceReader = new DevAutoProvisioningResourceFactReader(governance, now);
  const signingKeyHex = env.AUTHORITY_DEV_PDP_SIGNING_KEY ?? randomBytes(32).toString("hex");
  const signer = new HmacFenceSigner(Buffer.from(signingKeyHex, "hex"));
  const pdp = bootstrapGenerationPdp({ directory, resourceReader, audit: new InMemoryPdpAuditPort(), signer, now });
  return new PdpBackedContextFencePolicy(pdp, now);
}

export interface AuthorityMainDependencies {
  productionStorageAdapter?: ProductionAuthorityStorageAdapter;
  /** Real replicated governance/exposure authority. Never use GovernanceAuthority here. */
  productionGovernance?: GovernancePort;
  /** Real production PDP/context-fence adapter backed by live policy sources. */
  productionContextFencePolicy?: ContextFencePolicyPort;
  /** Readiness must represent the remote authority, not process-local construction. */
  productionGovernanceReady?: () => Promise<boolean>;
  /** Doc 005-backed live result authorization; local release-fence creation is dev/test only. */
  productionOutputAuthorization?: ProductionOutputDisclosureAuthorizationPort;
  /** Doc 021 quorum-backed audit admission; local receipt creation is dev/test only. */
  productionAuditAdmission?: ProductionAuditAdmissionPort;
  productionReleaseReady?: () => Promise<boolean>;
}

function parseStorageProfile(value: string | undefined): AuthorityStorageProfile {
  if (value === "development" || value === "test" || value === "production") return value;
  throw new Error("LENS_AUTHORITY_STORAGE_PROFILE must be explicitly set to development, test, or production.");
}

export async function main(
  env: AuthorityServiceEnv = loadEnv(),
  dependencies: AuthorityMainDependencies = {},
): Promise<{ close: () => Promise<void> }> {
  if (env.AUTHORITY_WORKLOAD_TOKEN.length < 32) {
    throw new Error("AUTHORITY_WORKLOAD_TOKEN must contain at least 32 characters.");
  }
  const port = Number(env.PORT ?? "8790");
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error("PORT must be an integer from 0 to 65535.");

  const storageProfile = parseStorageProfile(env.AUTHORITY_STORAGE_PROFILE);
  if (port === 0 && storageProfile === "production") throw new Error("PORT 0 is only valid for development/test Authority startup.");
  if ((storageProfile === "development" || storageProfile === "test") && !env.AUTHORITY_DB_PATH) {
    throw new Error(`LENS_AUTHORITY_DB_PATH is required for ${storageProfile} Authority storage.`);
  }
  if (storageProfile === "production" && env.AUTHORITY_ALLOW_DEV_FACTS === "true") {
    throw new Error("LENS_AUTHORITY_ALLOW_DEV_FACTS cannot be enabled with production Authority storage.");
  }
  if (storageProfile === "production" && (!dependencies.productionStorageAdapter || !dependencies.productionGovernance || !dependencies.productionContextFencePolicy || !dependencies.productionGovernanceReady || !dependencies.productionOutputAuthorization || !dependencies.productionAuditAdmission || !dependencies.productionReleaseReady)) {
    throw new Error("Production Authority requires deployer-supplied replicated storage, Governance, PDP, Doc 005 release authorization, Doc 021 audit admission, and readiness adapters; local stand-ins are not accepted.");
  }
  const outputCrypto = OutputBlobCrypto.fromHex(env.AUTHORITY_OUTPUT_KEY_HEX);

  let storeReady = false;
  let store: ReturnType<typeof createAuthorityStorage>;
  try {
    store = createAuthorityStorage({
      profile: storageProfile,
      sqlitePath: env.AUTHORITY_DB_PATH,
      productionAdapter: dependencies.productionStorageAdapter,
    });
    storeReady = true;
  } catch (error) {
    throw new Error(`Failed to open Authority store: ${(error as Error).message}`);
  }
  const now = () => Date.now();
  const localGovernance = new GovernanceAuthority(now);
  const governance = storageProfile === "production" ? dependencies.productionGovernance! : localGovernance;
  const contextFencePolicy = storageProfile === "production"
    ? dependencies.productionContextFencePolicy!
    : loadContextFencePolicy(env, localGovernance, now);
  const service = new AuthorityService(store, undefined, now, contextFencePolicy, governance, outputCrypto, storageProfile === "production" ? dependencies.productionOutputAuthorization : undefined, storageProfile === "production" ? dependencies.productionAuditAdmission : undefined);

  if (!env.MODEL_USE_SIGNING_KEY) throw new Error("LENS_MODEL_USE_SIGNING_KEY is required so Authority can issue AuthorizeGenerate/AuthorizeModelUse receipts.");
  const modelUsePem = env.MODEL_USE_SIGNING_KEY.includes("BEGIN") ? env.MODEL_USE_SIGNING_KEY : readFileSync(env.MODEL_USE_SIGNING_KEY, "utf8");
  const modelUseIssuer = new AuthorityReceiptIssuer(modelUsePem, { now });
  const artifactDigest = (env.MODEL_ARTIFACT_DIGEST && /^sha256:[a-f0-9]{64}$/.test(env.MODEL_ARTIFACT_DIGEST)
    ? env.MODEL_ARTIFACT_DIGEST
    : `sha256:${"c".repeat(64)}`) as `sha256:${string}`;
  const modelUseAuthority = new SubjectDeviceModelUseAuthority(
    {
      subject: () => ({ revision: 1, active: true, groups: [] }),
      device: () => ({ revision: 1, compliant: true }),
    },
    {
      resolveEndpoint: async (input) => {
        if (input.artifactDigest !== artifactDigest) throw new Error("ineligible");
        return { endpointRef: `internal-model:${input.artifactDigest}`, snapshotExpiresAt: now() + 60_000, external: false };
      },
      currentDenyEpoch: () => 0,
    },
    modelUseIssuer,
    now,
  );

  const http = createAuthorityHttp({
    workloadToken: env.AUTHORITY_WORKLOAD_TOKEN,
    service,
    isStoreReady: () => storeReady,
    isGovernanceReady: storageProfile === "production" ? dependencies.productionGovernanceReady : undefined,
    isReleaseReady: storageProfile === "production" ? dependencies.productionReleaseReady : undefined,
    modelUseAuthority,
  });

  await http.listen(port, env.HOST ?? "127.0.0.1");
  return {
    close: async () => {
      await http.close();
      storeReady = false;
      await store.close();
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
