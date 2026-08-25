import { describe, expect, it } from "vitest";
import {
  assertCompanyRagProfile,
  computeCompanyRagProfileDigest,
  employeeModelDoesNotAffectRag,
  type CompanyRagProfile,
} from "./companyRagProfile";

function profile(overrides: Partial<CompanyRagProfile> = {}): CompanyRagProfile {
  return assertCompanyRagProfile({
    profileVersion: 7,
    companyId: "acme",
    corpora: ["handbook", "hr"],
    connectors: ["drive"],
    chunking: { maxTokens: 400, overlapTokens: 40 },
    embeddingAdapterRef: "embedding:v1",
    groundingPolicyRef: "policy:v1",
    tools: ["search"],
    retentionDays: 30,
    eligibleModelPatterns: ["model-*"],
    retrievalProfiles: {
      default: { corpusRef: "handbook", mode: "hybrid" },
      hr: { corpusRef: "hr", mode: "semantic" },
      footer: { corpusRef: "handbook", mode: "lexical" },
    },
    ...overrides,
  });
}

describe("assertCompanyRagProfile", () => {
  it("accepts lexical, semantic, and hybrid retrieval mappings", () => {
    const configured = profile();
    expect(configured.retrievalProfiles.default.mode).toBe("hybrid");
    expect(configured.retrievalProfiles.hr.mode).toBe("semantic");
    expect(configured.retrievalProfiles.footer.mode).toBe("lexical");
    expect(configured.groundingPolicyRef).toBe("policy:v1");
    expect(configured.chunking).toEqual({ maxTokens: 400, overlapTokens: 40 });
    expect(configured.eligibleModelPatterns).toEqual(["model-*"]);
    expect(configured.profileVersion).toBe(7);
  });

  it("fails closed on missing retrievalProfiles, invalid mode, or missing overlap", () => {
    const { retrievalProfiles: _ignored, ...withoutProfiles } = profile();
    expect(() => assertCompanyRagProfile(withoutProfiles)).toThrow(/retrievalProfiles/);
    expect(() => assertCompanyRagProfile(profile({
      retrievalProfiles: { default: { corpusRef: "handbook", mode: "graph" as never } },
    }))).toThrow(/lexical, semantic, or hybrid/);
    expect(() => assertCompanyRagProfile({
      ...profile(),
      chunking: { maxTokens: 400, overlapTokens: Number.NaN },
    })).toThrow(/overlapTokens/);
  });
});

describe("employeeModelDoesNotAffectRag", () => {
  it("enforces eligibleModelPatterns without changing retrieval config", () => {
    const configured = profile({ eligibleModelPatterns: ["acme-*", "lens-default"] });
    expect(employeeModelDoesNotAffectRag(configured, "acme-chat")).toBe(true);
    expect(employeeModelDoesNotAffectRag(configured, "lens-default")).toBe(true);
    expect(employeeModelDoesNotAffectRag(configured, "other")).toBe(false);
    expect(configured.retrievalProfiles.default).toEqual({ corpusRef: "handbook", mode: "hybrid" });
  });
});

describe("computeCompanyRagProfileDigest", () => {
  it("is key-order independent and covers every profile field", () => {
    const first = profile();
    const reordered = profile({
      retrievalProfiles: {
        hr: { mode: "semantic", corpusRef: "hr" },
        footer: { mode: "lexical", corpusRef: "handbook" },
        default: { mode: "hybrid", corpusRef: "handbook" },
      },
    });

    expect(computeCompanyRagProfileDigest(first)).toBe(computeCompanyRagProfileDigest(reordered));
    expect(computeCompanyRagProfileDigest({ ...first, retentionDays: 31 })).not.toBe(computeCompanyRagProfileDigest(first));
    expect(computeCompanyRagProfileDigest(profile({
      retrievalProfiles: { ...first.retrievalProfiles, hr: { corpusRef: "hr-v2", mode: "semantic" } },
    }))).not.toBe(computeCompanyRagProfileDigest(first));
    expect(computeCompanyRagProfileDigest(profile({
      retrievalProfiles: { ...first.retrievalProfiles, default: { corpusRef: "handbook", mode: "lexical" } },
    }))).not.toBe(computeCompanyRagProfileDigest(first));
    expect(computeCompanyRagProfileDigest(profile({ profileVersion: 8 }))).not.toBe(computeCompanyRagProfileDigest(first));
    expect(computeCompanyRagProfileDigest(profile({ groundingPolicyRef: "policy:v2" }))).not.toBe(computeCompanyRagProfileDigest(first));
  });

  it("is identical for BFF COMPANY_RAG_PROFILE_JSON and orchestrator LENS_COMPANY_RAG_PROFILE_JSON", () => {
    const json = JSON.stringify(profile());
    const fromBff = assertCompanyRagProfile(JSON.parse(json));
    const fromOrchestrator = assertCompanyRagProfile(JSON.parse(json));
    expect(computeCompanyRagProfileDigest(fromBff)).toBe(computeCompanyRagProfileDigest(fromOrchestrator));
  });
});
