import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";

// Load the server's own .env (and fall back to the monorepo root .env) before
// any configuration is read. dotenv ignores files it cannot find.
import { config as loadEnv } from "dotenv";
const here = fileURLToPath(import.meta.url);
const serverEnv = resolve(dirname(here), "../../.env");
const rootEnv = resolve(dirname(here), "../../../.env");
if (existsSync(serverEnv)) loadEnv({ path: serverEnv });
else if (existsSync(rootEnv)) loadEnv({ path: rootEnv });

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
  // Development-only bridge to the separately deployed Enterprise-RAG service.
  // The client validates this as loopback before making any request.
  RAG_PROVIDER_MODE: z.enum(["disabled", "gemini-test", "internal"]).default("disabled"),
  RAG_SERVICE_URL: z.string().url().optional(),
  RAG_SERVICE_TOKEN: z.string().min(32).optional(),
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_REDIRECT_URI: z.string().url().optional(),
  OIDC_SCOPES: z.string().default("openid profile email"),
  OIDC_PKCE_VERIFIER_LENGTH: z.coerce.number().default(48),
  OIDC_STATE_LENGTH: z.coerce.number().default(32),
  OIDC_NONCE_LENGTH: z.coerce.number().default(32),
  OIDC_PENDING_TTL_MS: z.coerce.number().default(5 * 60 * 1000),
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
    config = parsed.data;
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
    if (cfg.RAG_PROVIDER_MODE === "gemini-test") {
      throw new Error("The Gemini test RAG bridge cannot be enabled in production");
    }
  }
  const configured = Boolean(cfg.RAG_SERVICE_URL) && Boolean(cfg.RAG_SERVICE_TOKEN);
  if (cfg.RAG_PROVIDER_MODE === "disabled" && (cfg.RAG_SERVICE_URL || cfg.RAG_SERVICE_TOKEN)) {
    throw new Error("RAG service configuration requires an explicit provider mode");
  }
  if (cfg.RAG_PROVIDER_MODE !== "disabled" && !configured) {
    throw new Error("An enabled RAG provider requires RAG_SERVICE_URL and RAG_SERVICE_TOKEN");
  }
  if (Boolean(cfg.RAG_SERVICE_URL) !== Boolean(cfg.RAG_SERVICE_TOKEN)) {
    throw new Error("RAG_SERVICE_URL and RAG_SERVICE_TOKEN must be configured together");
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
