import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteProviderRegistry } from "../../services/provider-registry/ProviderRegistry";
import { EncryptedSqliteSecretStore, MemorySecretStore } from "../../services/secrets/SecretStore";

const ENV_KEY = "LENS_SECRET_leak-probe";

describe("SecretStore plaintext containment", () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("MemorySecretStore never mirrors plaintext into process.env on put or get", async () => {
    const store = new MemorySecretStore();
    await store.put("leak-probe", "sk-super-secret-value");
    expect(process.env[ENV_KEY]).toBeUndefined();
    const value = await store.get("leak-probe");
    expect(value).toBe("sk-super-secret-value");
    expect(process.env[ENV_KEY]).toBeUndefined();
  });

  it("EncryptedSqliteSecretStore never mirrors plaintext into process.env on put or get", async () => {
    const store = new EncryptedSqliteSecretStore(":memory:", "x".repeat(32));
    await store.put("leak-probe", "sk-super-secret-value");
    expect(process.env[ENV_KEY]).toBeUndefined();
    const value = await store.get("leak-probe");
    expect(value).toBe("sk-super-secret-value");
    expect(process.env[ENV_KEY]).toBeUndefined();
  });

  it("sealed sqlite bytes do not contain the provider key plaintext", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "secret-store-")), "secrets.sqlite");
    const store = new EncryptedSqliteSecretStore(path, "x".repeat(32));
    await store.put("gateway-key", "sk-super-secret-value");
    expect(readFileSync(path).includes("sk-super-secret-value")).toBe(false);
    expect(await store.get("gateway-key")).toBe("sk-super-secret-value");
  });

  it("provider registry persists secret_ref and never the API key", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "provider-registry-")), "providers.sqlite");
    const registry = new SqliteProviderRegistry(path);
    const created = await registry.create({
      adapterType: "openai-compatible",
      baseUrl: "http://127.0.0.1:8080",
      secretRef: "gateway-key",
      tlsWorkloadRef: "tls-workload",
      allowedModels: ["chat"],
      capabilities: ["generate"],
      timeoutMs: 1_000,
      maxConcurrency: 1,
      profile: "sovereign",
      state: "active",
      catalogVersion: 1,
      catalogModelIds: ["chat"],
      idempotencyKey: "idem-1",
      inputDigest: "digest-1",
    });
    expect(created.secretRef).toBe("gateway-key");
    const raw = readFileSync(path);
    expect(raw.includes("gateway-key")).toBe(true);
    expect(raw.includes("sk-super-secret-value")).toBe(false);
  });
});
