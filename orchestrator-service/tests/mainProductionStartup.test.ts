import { createServer } from "node:net";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { main, type OrchestratorServiceEnv } from "../src/main";
import { signRoutePolicyManifest, type RoutePolicyManifest } from "../src/groundingPolicy";

const keyPair = generateKeyPairSync("ed25519");
const publicKeyPem = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
const routePolicyOpsKey = randomBytes(32).toString("hex");

function validManifest(): RoutePolicyManifest {
  return {
    manifestRevision: 1,
    entries: [{
      applicationRef: "lens-employee-client",
      workspaceRef: "default-workspace",
      purposeRef: "assistant",
      requestClass: "enterprise-grounded",
      routePolicyRevision: 3,
      groundingRequired: true,
      routerModelRef: "default",
      allowedProfileSelectors: ["default"],
      defaultProfileSelector: "default",
      noDefaultSelectorBehavior: "CLARIFY",
      clarificationText: "Please clarify your request.",
      expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
    }],
  };
}

const manifest = validManifest();
const validManifestJson = JSON.stringify(manifest);
const validManifestSignature = signRoutePolicyManifest(routePolicyOpsKey, manifest);

const validCompanyRagProfile = JSON.stringify({
  profileVersion: 1,
  companyId: "acme",
  corpora: ["hr-handbook"],
  connectors: [],
  chunking: { maxTokens: 400, overlapTokens: 40 },
  embeddingAdapterRef: "embed",
  groundingPolicyRef: "signed",
  tools: [],
  retentionDays: 30,
  eligibleModelPatterns: ["*"],
  retrievalProfiles: { default: { corpusRef: "hr-handbook", mode: "semantic" } },
});

function baseValidProductionEnv(port = "8789"): OrchestratorServiceEnv {
  return {
    PORT: port,
    HOST: "127.0.0.1",
    ORCHESTRATOR_AUTHORITY_PROFILE: "production",
    CONVERSATION_HISTORY_PROFILE: "production",
    ORCHESTRATOR_WORKLOAD_TOKEN: "o".repeat(40),
    RETRIEVAL_URL: "http://127.0.0.1:1/",
    RETRIEVAL_WORKLOAD_TOKEN: "r".repeat(40),
    MODEL_RUNTIME_URL: "http://127.0.0.1:1/",
    MODEL_RUNTIME_WORKLOAD_TOKEN: "m".repeat(40),
    MODEL_ARTIFACT_DIGEST: `sha256:${"a".repeat(64)}`,
    AUTHORITY_URL: "http://127.0.0.1:1/",
    AUTHORITY_WORKLOAD_TOKEN: "a".repeat(40),
    ASSERTION_VERIFY_KEY: publicKeyPem,
    MEMORY_ASSERTION_VERIFY_KEY: publicKeyPem,
    MEMORY_URL: "http://127.0.0.1:1/",
    MEMORY_WORKLOAD_TOKEN: "h".repeat(40),
    ROUTE_POLICY_MANIFEST_JSON: validManifestJson,
    ROUTE_POLICY_MANIFEST_SIGNATURE: validManifestSignature,
    ROUTE_POLICY_OPS_KEY: routePolicyOpsKey,
    COST_AUTHORITY_URL: "http://127.0.0.1:1/",
    COST_AUTHORITY_WORKLOAD_TOKEN: "c".repeat(40),
    AGENT_RUN_AUTHORITY_URL: "http://127.0.0.1:1/",
    AGENT_RUN_AUTHORITY_WORKLOAD_TOKEN: "g".repeat(40),
    MODEL_USE_RECEIPT_PUBLIC_KEY: publicKeyPem,
    COST_RECEIPT_PUBLIC_KEY: publicKeyPem,
    AGENT_RUN_RECEIPT_PUBLIC_KEY: publicKeyPem,
    SCHEDULER_LEASE_PUBLIC_KEY: publicKeyPem,
    USAGE_RECEIPT_PUBLIC_KEY: publicKeyPem,
    COMPANY_RAG_PROFILE_JSON: validCompanyRagProfile,
  };
}

const openServers: Array<{ close: () => Promise<void> }> = [];

async function getFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Could not determine free test port.");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

afterEach(async () => {
  while (openServers.length > 0) {
    await openServers.pop()!.close();
  }
});

describe("main production startup", () => {
  it("rejects missing COMPANY_RAG_PROFILE_JSON", async () => {
    const env = { ...baseValidProductionEnv(), COMPANY_RAG_PROFILE_JSON: undefined };
    await expect(main(env)).rejects.toThrow(/COMPANY_RAG_PROFILE_JSON/);
  });

  it("rejects malformed COMPANY_RAG_PROFILE_JSON", async () => {
    const env = { ...baseValidProductionEnv(), COMPANY_RAG_PROFILE_JSON: "{not json" };
    await expect(main(env)).rejects.toThrow(/Unexpected token|JSON/);
  });

  it("rejects a company RAG profile missing retrievalProfiles", async () => {
    const profile = JSON.parse(validCompanyRagProfile) as Record<string, unknown>;
    delete profile.retrievalProfiles;
    const env = { ...baseValidProductionEnv(), COMPANY_RAG_PROFILE_JSON: JSON.stringify(profile) };
    await expect(main(env)).rejects.toThrow(/retrievalProfiles/);
  });

  it("rejects missing USAGE_RECEIPT_PUBLIC_KEY", async () => {
    const env = { ...baseValidProductionEnv(), USAGE_RECEIPT_PUBLIC_KEY: undefined };
    await expect(main(env)).rejects.toThrow(/USAGE_RECEIPT_PUBLIC_KEY/);
  });

  it.each([
    "MODEL_USE_RECEIPT_PUBLIC_KEY",
    "COST_RECEIPT_PUBLIC_KEY",
    "AGENT_RUN_RECEIPT_PUBLIC_KEY",
    "SCHEDULER_LEASE_PUBLIC_KEY",
  ] as const)("rejects missing %s", async (field) => {
    const env = { ...baseValidProductionEnv(), [field]: undefined };
    await expect(main(env)).rejects.toThrow(/receipt verification public keys/);
  });

  it.each([
    ["COST_AUTHORITY_URL", "COST_AUTHORITY_WORKLOAD_TOKEN"],
    ["AGENT_RUN_AUTHORITY_URL", "AGENT_RUN_AUTHORITY_WORKLOAD_TOKEN"],
  ] as const)("rejects missing %s or %s", async (urlField, tokenField) => {
    const env = { ...baseValidProductionEnv(), [urlField]: undefined, [tokenField]: undefined };
    await expect(main(env)).rejects.toThrow(/COST_AUTHORITY_URL.*AGENT_RUN_AUTHORITY_URL/);
  });

  it("rejects ALLOW_IN_MEMORY_AUTHORITIES=true in production", async () => {
    const env = { ...baseValidProductionEnv(), ALLOW_IN_MEMORY_AUTHORITIES: "true" };
    await expect(main(env)).rejects.toThrow(/in-memory shared authorities/);
  });

  it("rejects missing route-policy manifest JSON or signature", async () => {
    const env = { ...baseValidProductionEnv(), ROUTE_POLICY_MANIFEST_JSON: undefined };
    await expect(main(env)).rejects.toThrow(/ROUTE_POLICY_MANIFEST_JSON/);
  });

  it("rejects ALLOW_IN_MEMORY_HISTORY=true in production", async () => {
    const env = { ...baseValidProductionEnv(), ALLOW_IN_MEMORY_HISTORY: "true" };
    await expect(main(env)).rejects.toThrow(/in-memory conversation history/);
  });

  it("rejects missing production Memory URL or workload token", async () => {
    const env = { ...baseValidProductionEnv(), MEMORY_URL: undefined, MEMORY_WORKLOAD_TOKEN: undefined };
    await expect(main(env)).rejects.toThrow(/MEMORY_URL.*MEMORY_WORKLOAD_TOKEN/);
  });

  it("starts successfully with a fully valid production environment and closes cleanly", async () => {
    const port = await getFreePort();
    const server = await main(baseValidProductionEnv(String(port)));
    openServers.push(server);
    await server.close();
    openServers.splice(openServers.indexOf(server), 1);
  });
});
