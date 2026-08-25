import { describe, expect, it } from "vitest";
import { computeCompanyRagProfileDigest, type CompanyRagProfile } from "./companyRagProfile";

function profile(retrievalProfiles: CompanyRagProfile["retrievalProfiles"]): CompanyRagProfile {
  return {
    profileVersion: 7,
    companyId: "acme",
    corpora: ["handbook"],
    connectors: ["drive"],
    chunking: { maxTokens: 400, overlapTokens: 40 },
    embeddingAdapterRef: "embedding:v1",
    groundingPolicyRef: "policy:v1",
    tools: ["search"],
    retentionDays: 30,
    eligibleModelPatterns: ["model-*"],
    retrievalProfiles,
  };
}

describe("computeCompanyRagProfileDigest", () => {
  it("is key-order independent and covers every profile field", () => {
    const first = profile({ default: { corpusRef: "handbook", mode: "hybrid" }, hr: { corpusRef: "hr", mode: "semantic" } });
    const reordered = profile({ hr: { mode: "semantic", corpusRef: "hr" }, default: { mode: "hybrid", corpusRef: "handbook" } });

    expect(computeCompanyRagProfileDigest(first)).toBe(computeCompanyRagProfileDigest(reordered));
    expect(computeCompanyRagProfileDigest({ ...first, retentionDays: 31 })).not.toBe(computeCompanyRagProfileDigest(first));
    expect(computeCompanyRagProfileDigest(profile({ ...first.retrievalProfiles, hr: { corpusRef: "hr-v2", mode: "semantic" } }))).not.toBe(computeCompanyRagProfileDigest(first));
  });
});
