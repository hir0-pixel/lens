import { describe, expect, it, afterEach } from "vitest";
import { __resetConfig, validateProductionConfig } from "../../server/src/config";

const originalEnv = { ...process.env };
const durableProductionEnv = {
  NODE_ENV: "production",
  APP_ORIGIN: "https://app.internal",
  SESSION_SECRET: "s".repeat(32),
  OIDC_ISSUER: "https://issuer.internal",
  OIDC_CLIENT_ID: "client",
  OIDC_CLIENT_SECRET: "secret",
  OIDC_REDIRECT_URI: "https://app.internal/callback",
  ADMISSION_API_ORIGIN: "https://admission.internal",
  ADMISSION_WORKLOAD_TOKEN: "w".repeat(32),
  RATE_LIMIT_KEY_SECRET: "r".repeat(32),
  BFF_ASSERTION_PRIVATE_KEY: "bff-key",
  MEMORY_ASSERTION_PRIVATE_KEY: "memory-key",
  CONVERSATION_REFERENCE_SECRET: "c".repeat(32),
  PROVIDER_REGISTRY_PATH: "./providers.sqlite",
  PUBLICATION_STORE_PATH: "./publication.sqlite",
  INGESTION_STORE_PATH_PREFIX: "./ingestion",
  AUDIT_LEDGER_STORE_PATH: "./audit.sqlite",
};

function setEnvironment(values: Record<string, string>): void {
  process.env = { ...originalEnv, ...values };
  __resetConfig();
}

afterEach(() => {
  process.env = { ...originalEnv };
  __resetConfig();
});

describe("production persistence configuration", () => {
  it("accepts durable paths for provider, publication, and ingestion state", () => {
    setEnvironment(durableProductionEnv);
    expect(() => validateProductionConfig()).not.toThrow();
  });

  it("requires every durable persistence path", () => {
    const { PROVIDER_REGISTRY_PATH: _provider, PUBLICATION_STORE_PATH: _publication, INGESTION_STORE_PATH_PREFIX: _ingestion, AUDIT_LEDGER_STORE_PATH: _audit, ...missing } = durableProductionEnv;
    setEnvironment({ ...missing, PROVIDER_REGISTRY_PATH: "", PUBLICATION_STORE_PATH: "", INGESTION_STORE_PATH_PREFIX: "", AUDIT_LEDGER_STORE_PATH: "" });
    expect(() => validateProductionConfig()).toThrow(/PROVIDER_REGISTRY_PATH, PUBLICATION_STORE_PATH, INGESTION_STORE_PATH_PREFIX, AUDIT_LEDGER_STORE_PATH/);
  });

  it.each(["PROVIDER_REGISTRY_PATH", "PUBLICATION_STORE_PATH", "INGESTION_STORE_PATH_PREFIX", "AUDIT_LEDGER_STORE_PATH"])("rejects :memory: for %s", (key) => {
    setEnvironment({ ...durableProductionEnv, [key]: ":memory:" });
    expect(() => validateProductionConfig()).toThrow(/must use a durable path in production/);
  });
});
