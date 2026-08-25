import { describe, expect, it } from "vitest";
import { createModelProviderAdapter } from "../../services/model-provider/createModelProviderAdapter";
import { OpenAICompatibleAdapter } from "../../services/model-provider/OpenAICompatibleAdapter";
import { assertInternalProviderUrl, openAiCompatibleResourceUrl, resolveSecretRef } from "../../services/model-provider/providerEndpointPolicy";
import { assertCompanyRagProfile, employeeModelDoesNotAffectRag } from "../../services/rag-profile/companyRagProfile";
import type { ProviderEndpointConfig } from "../../services/model-provider/ProviderAdapter";

const secret = "abcdefghijkl";

function openaiConfig(overrides: Partial<ProviderEndpointConfig> = {}): ProviderEndpointConfig {
  return {
    adapterType: "openai-compatible",
    baseUrl: "http://127.0.0.1:8080",
    secretRef: "GATEWAY",
    tlsWorkloadRef: "workload:model-gateway",
    allowedModels: ["acme-chat", "acme-embed"],
    expectedCapabilities: ["generate", "stream", "embed"],
    timeoutMs: 5_000,
    maxConcurrency: 4,
    profile: "sovereign",
    ...overrides,
  };
}

describe("provider-neutral adapters", () => {
  it("requires adapter type, internal URL, secret reference, and allowlist", () => {
    process.env.LENS_SECRET_GATEWAY = secret;
    expect(() => createModelProviderAdapter(openaiConfig({ secretRef: "" }))).toThrow(/secret_ref|adapter_type|Provider configuration/);
    expect(() => assertInternalProviderUrl("https://api.openai.com/v1", "sovereign")).toThrow(/internal/);
    expect(() => assertInternalProviderUrl("http://169.254.169.254/", "development")).toThrow(/not allowed/);
    expect(() => assertInternalProviderUrl("https://generativelanguage.googleapis.com/v1beta/openai/", "development")).not.toThrow();
    expect(() => assertInternalProviderUrl("https://generativelanguage.googleapis.com/v1beta/openai/", "sovereign")).toThrow(/internal/);
    expect(resolveSecretRef("GATEWAY")).toBe(secret);
  });

  it("filters discovery through the allowlist and meters locally", async () => {
    process.env.LENS_SECRET_GATEWAY = secret;
    const adapter = new OpenAICompatibleAdapter(openaiConfig(), async () => new Response(JSON.stringify({
      data: [{ id: "acme-chat" }, { id: "unlisted" }],
    }), { status: 200 }));
    const models = await adapter.discoverModels();
    expect(models.map((row) => row.id)).toEqual(["acme-chat"]);
    expect(adapter.meterUsage("hello world")).toBeGreaterThan(0);
  });

  it("keeps one openai-compatible adapter and only changes the URL path for prefixed bases", async () => {
    process.env.LENS_SECRET_GATEWAY = secret;
    const seen: string[] = [];
    const adapter = new OpenAICompatibleAdapter(
      openaiConfig({ profile: "development", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/" }),
      async (input) => {
        seen.push(String(input));
        return new Response(JSON.stringify({ data: [{ id: "acme-chat" }] }), { status: 200 });
      },
    );
    await adapter.discoverModels();
    expect(seen[0]).toBe("https://generativelanguage.googleapis.com/v1beta/openai/models");
    expect(openAiCompatibleResourceUrl(new URL("http://127.0.0.1:8080"), "models").href).toBe("http://127.0.0.1:8080/v1/models");
  });

  it("normalizes Gemini native catalog ids and models/ prefixes against the allowlist", async () => {
    process.env.LENS_SECRET_GATEWAY = secret;
    const adapter = new OpenAICompatibleAdapter(
      openaiConfig({ profile: "development", allowedModels: ["gemini-2.5-flash"] }),
      async () => new Response(JSON.stringify({
        models: [{ name: "models/gemini-2.5-flash" }, { name: "models/gemini-2.5-pro" }],
      }), { status: 200 }),
    );
    const models = await adapter.discoverModels();
    expect(models.map((row) => row.id)).toEqual(["gemini-2.5-flash"]);
  });

  it("forbids Gemini in sovereign production and keeps RAG profile independent of selected answer model", () => {
    process.env.LENS_SECRET_GEMINI = secret;
    expect(() => createModelProviderAdapter({
      ...openaiConfig({ adapterType: "gemini-dev", secretRef: "GEMINI", profile: "sovereign" }),
    })).toThrow(/openai-compatible/);
    const profile = assertCompanyRagProfile({
      profileVersion: 1,
      companyId: "acme",
      corpora: ["policies"],
      connectors: ["sharepoint"],
      chunking: { maxTokens: 400, overlapTokens: 40 },
      embeddingAdapterRef: "openai-compatible:embed",
      groundingPolicyRef: "signed-route-policy",
      tools: ["ticket.read"],
      retentionDays: 90,
      eligibleModelPatterns: ["acme-*"],
      retrievalProfiles: { default: { corpusRef: "policies", mode: "hybrid" } },
    });
    expect(employeeModelDoesNotAffectRag(profile, "acme-chat")).toBe(true);
    expect(employeeModelDoesNotAffectRag(profile, "other")).toBe(false);
  });

  it("rejects a company RAG profile with missing, empty, or malformed retrievalProfiles", () => {
    const base = {
      profileVersion: 1,
      companyId: "acme",
      corpora: ["policies"],
      connectors: ["sharepoint"],
      chunking: { maxTokens: 400, overlapTokens: 40 },
      embeddingAdapterRef: "openai-compatible:embed",
      groundingPolicyRef: "signed-route-policy",
      tools: ["ticket.read"],
      retentionDays: 90,
      eligibleModelPatterns: ["acme-*"],
    };
    expect(() => assertCompanyRagProfile({ ...base })).toThrow(/retrievalProfiles/);
    expect(() => assertCompanyRagProfile({ ...base, retrievalProfiles: {} })).toThrow(/retrievalProfiles/);
    expect(() => assertCompanyRagProfile({ ...base, retrievalProfiles: { default: { mode: "hybrid" } } })).toThrow(/retrievalProfiles\["default"\]/);
    expect(() => assertCompanyRagProfile({ ...base, retrievalProfiles: { default: { corpusRef: "", mode: "hybrid" } } })).toThrow(/retrievalProfiles\["default"\]/);
  });
});
