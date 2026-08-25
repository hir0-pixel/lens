import { createHash } from "node:crypto";
import type { RetrievalMode } from "../../libs/rag-contracts";
import { canonicalJson } from "../security/canonicalJson";

export interface RetrievalProfileMapping {
  corpusRef: string;
  mode: RetrievalMode;
}

export interface CompanyRagProfile {
  profileVersion: number;
  companyId: string;
  corpora: readonly string[];
  connectors: readonly string[];
  chunking: { maxTokens: number; overlapTokens: number };
  embeddingAdapterRef: string;
  rerankerRef?: string;
  groundingPolicyRef: string;
  tools: readonly string[];
  retentionDays: number;
  eligibleModelPatterns: readonly string[];
  /**
   * Maps each router-selected `profile_selector` (see groundingPolicy.ts's
   * `allowedProfileSelectors`, which governs which selectors a request may
   * use) to the retrieval corpus/mode it actually resolves to. The route
   * policy owns permission to use a selector; this profile owns what the
   * selector means. A selector missing here fails closed even if the route
   * policy allowed it -- the two authorities must agree.
   */
  retrievalProfiles: Readonly<Record<string, RetrievalProfileMapping>>;
}

export function assertCompanyRagProfile(value: unknown): CompanyRagProfile {
  if (!value || typeof value !== "object") throw new Error("Company RAG profile is required.");
  const record = value as Record<string, unknown>;
  if (!Number.isSafeInteger(record.profileVersion) || Number(record.profileVersion) < 1) throw new Error("profileVersion is required.");
  if (typeof record.companyId !== "string" || !record.companyId) throw new Error("companyId is required.");
  if (!Array.isArray(record.corpora) || !Array.isArray(record.connectors)) throw new Error("corpora and connectors are required.");
  const chunking = record.chunking as { maxTokens?: number; overlapTokens?: number } | undefined;
  if (!chunking || !Number.isSafeInteger(chunking.maxTokens)) throw new Error("chunking is required.");
  if (typeof record.embeddingAdapterRef !== "string" || typeof record.groundingPolicyRef !== "string") {
    throw new Error("embeddingAdapterRef and groundingPolicyRef are required.");
  }
  if (!Array.isArray(record.tools) || !Array.isArray(record.eligibleModelPatterns)) throw new Error("tools and eligibleModelPatterns are required.");
  if (!Number.isSafeInteger(record.retentionDays) || Number(record.retentionDays) < 1) throw new Error("retentionDays is required.");
  const retrievalProfiles = record.retrievalProfiles as Record<string, { corpusRef?: unknown; mode?: unknown }> | undefined;
  if (!retrievalProfiles || typeof retrievalProfiles !== "object" || Object.keys(retrievalProfiles).length === 0) {
    throw new Error("retrievalProfiles is required.");
  }
  for (const [selector, mapping] of Object.entries(retrievalProfiles)) {
    if (!mapping || typeof mapping.corpusRef !== "string" || !mapping.corpusRef || typeof mapping.mode !== "string") {
      throw new Error(`retrievalProfiles["${selector}"] requires corpusRef and mode.`);
    }
  }
  return value as CompanyRagProfile;
}

/** Deterministic full-profile identity used to bind retrieval lineage to its resolver. */
export function computeCompanyRagProfileDigest(profile: CompanyRagProfile): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(profile)).digest("hex")}`;
}

export function employeeModelDoesNotAffectRag(profile: CompanyRagProfile, selectedModel: string): boolean {
  return profile.eligibleModelPatterns.some((pattern) => pattern === selectedModel || (pattern.endsWith("*") && selectedModel.startsWith(pattern.slice(0, -1))));
}
