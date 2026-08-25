import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

// Load the server's own .env (and fall back to the monorepo root .env) before
// any configuration is read. dotenv ignores files it cannot find.
import { config as loadEnv, parse as parseEnv } from "dotenv";
const here = fileURLToPath(import.meta.url);
const serverEnv = resolve(dirname(here), "../../.env");
const cwdEnv = resolve(process.cwd(), ".env");
const rootEnv = resolve(dirname(here), "../../../.env");
const envPath = [rootEnv, cwdEnv, serverEnv].filter((path) => existsSync(path)).at(-1);
if (envPath) {
  loadEnv({ path: envPath });
  const fromFile = parseEnv(readFileSync(envPath));
  // dotenv will not replace an empty parent ADMIN_SUBJECTS. Fill from the file if still unset.
  if (!process.env.ADMIN_SUBJECTS?.trim() && fromFile.ADMIN_SUBJECTS?.trim()) {
    process.env.ADMIN_SUBJECTS = fromFile.ADMIN_SUBJECTS.trim();
  }
  // Dev shells often inherit PORT from rag-stack services (e.g. runtime on 8793). Prefer server/.env.
  if (process.env.NODE_ENV !== "production" && fromFile.PORT?.trim()) {
    process.env.PORT = fromFile.PORT.trim();
  }
}

// z.coerce.boolean() coerces the string "false" to true (any non-empty string is
// truthy), which silently re-enables fail-closed checks. Parse booleans explicitly.
function boolFromEnv(defaultValue: boolean) {
  return z
    .string()
    .trim()
    .toLowerCase()
    .transform(v => v === "true" || v === "1")
    .default(String(defaultValue));
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3001),
  APP_ORIGIN: z.string().url().default("http://localhost:1420"),
  SESSION_SECRET: z.string().min(32),
  SESSION_COOKIE_NAME: z.string().default("lens_session"),
  SESSION_TTL_MS: z.coerce.number().default(30 * 60 * 1000),
  CSRF_COOKIE_NAME: z.string().default("lens_csrf"),
  CSRF_HEADER_NAME: z.string().default("x-lens-csrf"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  AUTH_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(10),
  ADMISSION_API_ORIGIN: z.string().url().optional(),
  ADMISSION_WORKLOAD_TOKEN: z.string().min(32).optional(),
  RATE_LIMIT_KEY_SECRET: z.string().min(32).optional(),
  // Internal Orchestrator ingress used by the production RAG path. The client
  // validates this as a loopback or internal network endpoint; the browser
  // never learns it and can never supply an endpoint or trusted identity.
  RAG_PROVIDER_MODE: z.enum(["disabled", "internal"]).default("disabled"),
  ORCHESTRATOR_URL: z.string().url().optional(),
  ORCHESTRATOR_TOKEN: z.string().min(32).optional(),
  /** Ed25519 private key held only by the BFF for Orchestrator assertions. */
  BFF_ASSERTION_PRIVATE_KEY: z.string().min(1).optional(),
  /** Ed25519 private key held only by the BFF for Memory assertions. */
  MEMORY_ASSERTION_PRIVATE_KEY: z.string().min(1).optional(),
  /** Dedicated HMAC key used only by the BFF to issue opaque conversation references. */
  CONVERSATION_REFERENCE_SECRET: z.string().min(32).optional(),
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_REDIRECT_URI: z.string().url().optional(),
  OIDC_SCOPES: z.string().default("openid profile email"),
  OIDC_PKCE_VERIFIER_LENGTH: z.coerce.number().default(48),
  OIDC_STATE_LENGTH: z.coerce.number().default(32),
  OIDC_NONCE_LENGTH: z.coerce.number().default(32),
  OIDC_PENDING_TTL_MS: z.coerce.number().default(5 * 60 * 1000),
  OIDC_BROWSER_BINDING_COOKIE_NAME: z.string().min(1).max(128).default("lens_oidc_binding"),
  OIDC_TOKEN_INTROSPECTION_ENDPOINT: z.string().url().optional(),
  OIDC_REVOCATION_ENDPOINT: z.string().url().optional(),
  OIDC_USERINFO_ENDPOINT: z.string().url().optional(),
  OIDC_JWKS_ENDPOINT: z.string().url().optional(),
  OIDC_ALLOWED_ISSUERS: z.string().optional(),
  OIDC_REQUIRE_HTTPS_ISSUER: boolFromEnv(true),
  OIDC_ALLOWED_REDIRECT_HOSTS: z.string().optional(),
  OIDC_ALLOWED_ORIGINS: z.string().optional(),
  OIDC_TEST_MODE: boolFromEnv(false),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  ADMIN_SUBJECTS: z.string().optional(),
  PROVIDER_PROFILE: z.enum(["sovereign", "development"]).default("sovereign"),
  PROVIDER_REGISTRY_PATH: z.string().optional(),
  PUBLICATION_STORE_PATH: z.string().optional(),
  SECRET_STORE_KEY: z.string().min(32).optional(),
  CATALOG_WORKLOAD_TOKEN: z.string().min(32).optional(),
  PROVIDER_SECRET_WORKLOAD_TOKEN: z.string().min(32).optional(),
  COMPANY_RAG_PROFILE_JSON: z.string().optional(),
  INGESTION_ENABLED: boolFromEnv(false),
  /** Development/test only: deterministic local embeddings for ingestion (same pattern as e2e harness). Forbidden in production. */
  INGESTION_USE_LOCAL_EMBEDDINGS: boolFromEnv(false),
  INGESTION_PROVIDER_ADAPTER: z.enum(["openai-compatible", "gemini-dev"]).optional(),
  INGESTION_PROVIDER_BASE_URL: z.string().url().optional(),
  INGESTION_PROVIDER_SECRET_REF: z.string().optional(),
  INGESTION_PROVIDER_TLS_WORKLOAD_REF: z.string().optional(),
  INGESTION_PROVIDER_MODEL: z.string().optional(),
  INGESTION_PROVIDER_ALLOWED_MODELS: z.string().optional(),
  INGESTION_PROVIDER_TIMEOUT_MS: z.coerce.number().default(30_000),
  INGESTION_PROVIDER_MAX_CONCURRENCY: z.coerce.number().default(4),
  INGESTION_STORE_PATH_PREFIX: z.string().optional(),
  /** When INGESTION_ENABLED, expose the same in-process retrieval deployment on this loopback port for Orchestrator. */
  RETRIEVAL_HTTP_PORT: z.coerce.number().optional(),
  RETRIEVAL_WORKLOAD_TOKEN: z.string().min(32).optional(),
  AUDIT_LEDGER_STORE_PATH: z.string().optional(),
});

type EnvConfig = z.infer<typeof envSchema>;

let config: EnvConfig | null = null;

export function getConfig(): EnvConfig {
  if (!config) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const errors = parsed.error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join("\n");
      throw new Error(`Invalid environment configuration:\n${errors}`);
    }
    const data = parsed.data;
    if (!data.ADMIN_SUBJECTS?.trim() && data.NODE_ENV !== "production") {
      // dev-idp may issue sub=devuser (preferred_username) or dev-user-1 depending on version/restart
      data.ADMIN_SUBJECTS = "dev-user-1,devuser";
    }
    config = data;
  }
  return config;
}

export function validateProductionConfig(): void {
  const cfg = getConfig();
  if (cfg.NODE_ENV === "production") {
    const required = [
      "OIDC_ISSUER",
      "OIDC_CLIENT_ID",
      "OIDC_CLIENT_SECRET",
      "OIDC_REDIRECT_URI",
      "SESSION_SECRET",
      "ADMISSION_API_ORIGIN",
      "ADMISSION_WORKLOAD_TOKEN",
      "RATE_LIMIT_KEY_SECRET",
      "PROVIDER_REGISTRY_PATH",
      "PUBLICATION_STORE_PATH",
      "INGESTION_STORE_PATH_PREFIX",
      "AUDIT_LEDGER_STORE_PATH",
      "SECRET_STORE_KEY",
    ];
    const missing = required.filter(key => !cfg[key as keyof EnvConfig]);
    if (missing.length > 0) {
      throw new Error(`Production configuration missing required values: ${missing.join(", ")}`);
    }
    if (cfg.OIDC_TEST_MODE) {
      throw new Error("OIDC_TEST_MODE cannot be enabled in production");
    }
    if (!cfg.OIDC_ISSUER?.startsWith("https://")) {
      throw new Error("OIDC_ISSUER must use HTTPS in production");
    }
    if (!cfg.APP_ORIGIN?.startsWith("https://")) {
      throw new Error("APP_ORIGIN must use HTTPS in production");
    }
    if (cfg.PROVIDER_REGISTRY_PATH?.trim() === ":memory:") {
      throw new Error("PROVIDER_REGISTRY_PATH must use a durable path in production");
    }
    if (cfg.PUBLICATION_STORE_PATH?.trim() === ":memory:") {
      throw new Error("PUBLICATION_STORE_PATH must use a durable path in production");
    }
    if (cfg.INGESTION_STORE_PATH_PREFIX?.trim() === ":memory:") {
      throw new Error("INGESTION_STORE_PATH_PREFIX must use a durable path in production");
    }
    if (cfg.AUDIT_LEDGER_STORE_PATH?.trim() === ":memory:") {
      throw new Error("AUDIT_LEDGER_STORE_PATH must use a durable path in production");
    }
  }
  if (cfg.NODE_ENV === "production" || cfg.RAG_PROVIDER_MODE === "internal") {
    const missingRagSecurityKeys = [
      ["BFF_ASSERTION_PRIVATE_KEY", cfg.BFF_ASSERTION_PRIVATE_KEY],
      ["MEMORY_ASSERTION_PRIVATE_KEY", cfg.MEMORY_ASSERTION_PRIVATE_KEY],
      ["CONVERSATION_REFERENCE_SECRET", cfg.CONVERSATION_REFERENCE_SECRET],
    ].filter(([, value]) => !value).map(([key]) => key);
    if (missingRagSecurityKeys.length > 0) {
      throw new Error(`Internal RAG configuration missing dedicated security keys: ${missingRagSecurityKeys.join(", ")}`);
    }
    const forbiddenReuse = [cfg.SESSION_SECRET, cfg.ORCHESTRATOR_TOKEN, cfg.ADMISSION_WORKLOAD_TOKEN].filter(Boolean);
    if ([cfg.BFF_ASSERTION_PRIVATE_KEY, cfg.MEMORY_ASSERTION_PRIVATE_KEY, cfg.CONVERSATION_REFERENCE_SECRET].some((key) => key && forbiddenReuse.includes(key))) {
      throw new Error("RAG security keys must be distinct from session and workload credentials.");
    }
    if (cfg.BFF_ASSERTION_PRIVATE_KEY === cfg.MEMORY_ASSERTION_PRIVATE_KEY) throw new Error("BFF and Memory assertion private keys must be distinct.");
    if (cfg.BFF_ASSERTION_PRIVATE_KEY === cfg.CONVERSATION_REFERENCE_SECRET || cfg.MEMORY_ASSERTION_PRIVATE_KEY === cfg.CONVERSATION_REFERENCE_SECRET) throw new Error("Assertion private keys and conversation key must be distinct.");
  }
  const admissionConfigured = [cfg.ADMISSION_API_ORIGIN, cfg.ADMISSION_WORKLOAD_TOKEN, cfg.RATE_LIMIT_KEY_SECRET].filter(Boolean).length;
  if (admissionConfigured !== 0 && admissionConfigured !== 3) {
    throw new Error("ADMISSION_API_ORIGIN, ADMISSION_WORKLOAD_TOKEN, and RATE_LIMIT_KEY_SECRET must be configured together");
  }
  const providerWorkloadConfigured = [cfg.CATALOG_WORKLOAD_TOKEN, cfg.PROVIDER_SECRET_WORKLOAD_TOKEN].filter(Boolean).length;
  if (providerWorkloadConfigured !== 0 && providerWorkloadConfigured !== 2) {
    throw new Error("CATALOG_WORKLOAD_TOKEN and PROVIDER_SECRET_WORKLOAD_TOKEN must be configured together");
  }
  if (cfg.CATALOG_WORKLOAD_TOKEN && cfg.PROVIDER_SECRET_WORKLOAD_TOKEN && cfg.CATALOG_WORKLOAD_TOKEN === cfg.PROVIDER_SECRET_WORKLOAD_TOKEN) {
    throw new Error("CATALOG_WORKLOAD_TOKEN and PROVIDER_SECRET_WORKLOAD_TOKEN must be distinct.");
  }
  if (cfg.RAG_PROVIDER_MODE === "internal") {
    if (!cfg.ORCHESTRATOR_URL || !cfg.ORCHESTRATOR_TOKEN) {
      throw new Error("The internal RAG path requires ORCHESTRATOR_URL and ORCHESTRATOR_TOKEN");
    }
  }
  if (cfg.INGESTION_USE_LOCAL_EMBEDDINGS && cfg.NODE_ENV === "production") {
    throw new Error("INGESTION_USE_LOCAL_EMBEDDINGS is development/test-only");
  }
  const retrievalHttpConfigured = [cfg.RETRIEVAL_HTTP_PORT, cfg.RETRIEVAL_WORKLOAD_TOKEN].filter(Boolean).length;
  if (retrievalHttpConfigured !== 0 && retrievalHttpConfigured !== 2) {
    throw new Error("RETRIEVAL_HTTP_PORT and RETRIEVAL_WORKLOAD_TOKEN must be configured together");
  }
  if (cfg.RETRIEVAL_HTTP_PORT && !cfg.INGESTION_ENABLED) {
    throw new Error("RETRIEVAL_HTTP_PORT requires INGESTION_ENABLED so Orchestrator retrieves from the same in-process corpus");
  }
  if ("RAG_SERVICE_URL" in process.env || "RAG_SERVICE_TOKEN" in process.env) {
    throw new Error("Legacy RAG_SERVICE bridge settings are not supported; use the internal Orchestrator path");
  }
  if (process.env.RAG_MODE) {
    throw new Error(`Legacy RAG_MODE="${process.env.RAG_MODE}" is not supported; the local_policy path is quarantined (see server/src/rag/service.ts) — use the internal Orchestrator path (RAG_PROVIDER_MODE=internal)`);
  }
}

export function isTestMode(): boolean {
  return getConfig().OIDC_TEST_MODE === true;
}

/** Test-only: clears the cached config so it can be re-read from process.env. */
export function __resetConfig(): void {
  config = null;
}

export function getAllowedOrigins(): string[] {
  const cfg = getConfig();
  if (cfg.OIDC_ALLOWED_ORIGINS) {
    return cfg.OIDC_ALLOWED_ORIGINS.split(",").map(s => s.trim());
  }
  return [cfg.APP_ORIGIN];
}

export function getAllowedRedirectHosts(): string[] {
  const cfg = getConfig();
  if (cfg.OIDC_ALLOWED_REDIRECT_HOSTS) {
    return cfg.OIDC_ALLOWED_REDIRECT_HOSTS.split(",").map(s => s.trim());
  }
  try {
    return [new URL(cfg.APP_ORIGIN).host];
  } catch {
    return [];
  }
}
