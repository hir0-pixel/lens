import { describe, expect, it } from "vitest";
import { MemorySecretStore } from "../../services/secrets/SecretStore";
import { IdempotencyConflictError, SqliteProviderRegistry } from "../../services/provider-registry/ProviderRegistry";
import { ProviderOnboardError, ProviderOnboardingService } from "../../services/provider-registry/onboard";
import { assertInternalProviderUrl } from "../../services/model-provider/providerEndpointPolicy";
import { redactSecrets } from "../../services/provider-registry/catalog";

function onboardInput(overrides: Record<string, unknown> = {}) {
  return {
    adapterType: "openai-compatible" as const,
    baseUrl: "http://127.0.0.1:8080",
    apiKey: "sk-test-provider-key",
    tlsWorkloadRef: "workload:runtime",
    allowedModels: ["acme-chat", "acme-fast"],
    capabilities: ["generate", "stream"] as const,
    timeoutMs: 5_000,
    maxConcurrency: 4,
    profile: "sovereign" as const,
    idempotencyKey: "idem-1",
    ...overrides,
  };
}

describe("provider onboarding and catalog", () => {
  it("stores only a secret reference and never returns the key", async () => {
    const secrets = new MemorySecretStore();
    const registry = new SqliteProviderRegistry(":memory:");
    const fetchImpl = async () => new Response(JSON.stringify({ data: [{ id: "acme-chat" }, { id: "secret-other" }] }), { status: 200 });
    const service = new ProviderOnboardingService(registry, secrets, fetchImpl as typeof fetch);
    const result = await service.onboard(onboardInput());
    expect(result).toEqual({ id: expect.stringMatching(/^prv_/), status: "active" });
    expect(JSON.stringify(result)).not.toContain("sk-test-provider-key");
    const stored = await registry.get(result.id);
    expect(stored?.secretRef).toMatch(/^p_/);
    expect(JSON.stringify(stored)).not.toContain("sk-test-provider-key");
    const catalog = await service.employeeCatalog();
    expect(catalog.map((row) => row.modelRef)).toEqual(["acme-chat"]);
    expect(JSON.stringify(catalog)).not.toContain("8080");
    expect(JSON.stringify(redactSecrets({ apiKey: "sk-test-provider-key", id: result.id }))).not.toContain("sk-test");
  });

  it("filters OpenAI-compatible discovery through the allowlist", async () => {
    const service = new ProviderOnboardingService(
      new SqliteProviderRegistry(":memory:"),
      new MemorySecretStore(),
      (async () => new Response(JSON.stringify({ data: [{ id: "acme-chat" }, { id: "acme-fast" }, { id: "gpt-public" }] }), { status: 200 })) as typeof fetch,
    );
    await service.onboard(onboardInput({ allowedModels: ["acme-*"] }));
    expect((await service.employeeCatalog()).map((row) => row.modelRef).sort()).toEqual(["acme-chat", "acme-fast"]);
  });

  it("conflicts when the same idempotency key is reused with different input", async () => {
    const service = new ProviderOnboardingService(
      new SqliteProviderRegistry(":memory:"),
      new MemorySecretStore(),
      (async () => new Response(JSON.stringify({ data: [{ id: "acme-chat" }] }), { status: 200 })) as typeof fetch,
    );
    await service.onboard(onboardInput());
    await expect(service.onboard(onboardInput({ baseUrl: "http://127.0.0.1:8081" }))).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("rejects external base URLs in sovereign production", () => {
    expect(() => assertInternalProviderUrl("https://api.openai.com/v1", "sovereign")).toThrow(/internal/);
    expect(() => assertInternalProviderUrl("https://generativelanguage.googleapis.com", "sovereign")).toThrow(/internal/);
  });

  it("fails closed on timeout, bad key, TLS, catalog, and upstream errors without leaking the key", async () => {
    const cases: Array<{ fetch: typeof fetch; code: string }> = [
      { fetch: (async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }) as typeof fetch, code: "PROVIDER_UNAVAILABLE" },
      { fetch: (async () => new Response("no", { status: 401 })) as typeof fetch, code: "INVALID_KEY" },
      { fetch: (async () => { throw new Error("unable to verify the first certificate TLS"); }) as typeof fetch, code: "PROVIDER_UNAVAILABLE" },
      { fetch: (async () => new Response("no", { status: 500 })) as typeof fetch, code: "PROVIDER_UNAVAILABLE" },
    ];
    for (const [index, testCase] of cases.entries()) {
      const service = new ProviderOnboardingService(new SqliteProviderRegistry(":memory:"), new MemorySecretStore(), testCase.fetch);
      try {
        await service.onboard(onboardInput({ idempotencyKey: `idem-${index}` }));
        throw new Error("expected failure");
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderOnboardError);
        expect((error as ProviderOnboardError).code).toBe(testCase.code);
        expect(String(error)).not.toContain("sk-test-provider-key");
      }
    }
  });
});
