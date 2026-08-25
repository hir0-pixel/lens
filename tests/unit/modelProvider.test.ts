import { describe, expect, it } from "vitest";
import { createModelProviderAdapter } from "../../services/model-provider/createModelProviderAdapter";
import { OpenAICompatibleAdapter } from "../../services/model-provider/OpenAICompatibleAdapter";
import { assertInternalProviderUrl, resolveSecretRef } from "../../services/model-provider/providerEndpointPolicy";
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
