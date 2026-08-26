import { createHash } from "node:crypto";
import { canonicalJson } from "../security/canonicalJson";

/** Company RAG retrieval modes. Other contract modes (graph, structured, …) are not configurable here. */
export const COMPANY_RETRIEVAL_MODES = ["lexical", "semantic", "hybrid"] as const;
export type CompanyRetrievalMode = (typeof COMPANY_RETRIEVAL_MODES)[number];

export interface RetrievalProfileMapping {
  corpusRef: string;
  mode: CompanyRetrievalMode;
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
  if (!chunking || !Number.isSafeInteger(chunking.maxTokens) || Number(chunking.maxTokens) < 1) throw new Error("chunking is required.");
  if (!Number.isSafeInteger(chunking.overlapTokens) || Number(chunking.overlapTokens) < 0) throw new Error("chunking.overlapTokens is required.");
  if (typeof record.embeddingAdapterRef !== "string" || !record.embeddingAdapterRef || typeof record.groundingPolicyRef !== "string" || !record.groundingPolicyRef) {
    throw new Error("embeddingAdapterRef and groundingPolicyRef are required.");
  }
  if (!Array.isArray(record.tools) || !Array.isArray(record.eligibleModelPatterns)) throw new Error("tools and eligibleModelPatterns are required.");
  if (record.eligibleModelPatterns.some((pattern) => typeof pattern !== "string" || !pattern)) {
    throw new Error("eligibleModelPatterns is required.");
  }
  if (!Number.isSafeInteger(record.retentionDays) || Number(record.retentionDays) < 1) throw new Error("retentionDays is required.");
  const retrievalProfiles = record.retrievalProfiles as Record<string, { corpusRef?: unknown; mode?: unknown }> | undefined;
  if (!retrievalProfiles || typeof retrievalProfiles !== "object" || Object.keys(retrievalProfiles).length === 0) {
    throw new Error("retrievalProfiles is required.");
  }
  for (const [selector, mapping] of Object.entries(retrievalProfiles)) {
    if (!mapping || typeof mapping.corpusRef !== "string" || !mapping.corpusRef || typeof mapping.mode !== "string") {
      throw new Error(`retrievalProfiles["${selector}"] requires corpusRef and mode.`);
    }
    if (!(COMPANY_RETRIEVAL_MODES as readonly string[]).includes(mapping.mode)) {
      throw new Error(`retrievalProfiles["${selector}"] mode must be lexical, semantic, or hybrid.`);
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
