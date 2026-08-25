import { describe, expect, it, afterEach } from "vitest";
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
});
