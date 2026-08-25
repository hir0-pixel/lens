/**
 * Track 3: pinned per-generation index profile. Every index generation must
 * record exactly which embedding model, tokenizer, vector geometry, chunking
 * profile, and schema it was built with. A generation whose profile differs
 * from the expected production profile is invalid and cannot be published.
 */

export type DistanceMetric = "cosine" | "dot" | "euclidean";

export interface IndexProfile {
  embeddingModelDigest: `sha256:${string}`;
  tokenizerDigest: `sha256:${string}`;
  vectorDimensions: number;
  distanceMetric: DistanceMetric;
  chunkingProfile: string;
  schemaVersion: string;
}

export interface IndexGenerationManifest {
  generationId: string;
  corpusRef: string;
  profile: IndexProfile;
  /** Immutable CompanyRagProfile lineage under which this generation was built. */
  ragProfileVersion: number;
  ragProfileDigest: `sha256:${string}`;
  /** Immutable candidate references only: no protected chunk text, no embeddings. */
  candidateRefs: readonly {
    versionRef: string;
    chunkRef: string;
    contentHash: `sha256:${string}`;
    classificationRef: "public" | "internal" | "confidential" | "restricted";
  }[];
  /** Deterministic integrity digest over the ordered candidate refs and profile. */
  integrityDigest: `sha256:${string}`;
  state: "building" | "finalized" | "active" | "retired";
  activatedAt?: number;
}

export function assertRagProfileLineage(version: number, digest: `sha256:${string}`): void {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("Invalid RAG profile version.");
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error("Invalid RAG profile digest.");
}

export function assertIndexProfile(value: IndexProfile): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(value.embeddingModelDigest)) throw new Error("Invalid embedding model digest.");
  if (!/^sha256:[a-f0-9]{64}$/.test(value.tokenizerDigest)) throw new Error("Invalid tokenizer digest.");
  if (!Number.isInteger(value.vectorDimensions) || value.vectorDimensions < 1) throw new Error("Invalid vector dimensions.");
  if (!["cosine", "dot", "euclidean"].includes(value.distanceMetric)) throw new Error("Invalid distance metric.");
  if (!value.chunkingProfile) throw new Error("A chunking profile is required.");
  if (!value.schemaVersion) throw new Error("A schema version is required.");
}

export function computeCandidateRefsDigest(candidateRefs: readonly IndexGenerationManifest["candidateRefs"][number][]): `sha256:${string}` {
  const canonical = candidateRefs
    .map((ref) => `${ref.versionRef}|${ref.chunkRef}|${ref.contentHash}|${ref.classificationRef}`)
    .sort()
    .join("\n");
  return `sha256:${simpleHash(canonical)}`;
}

/** Cryptographic deterministic digest for publication/content integrity. */
export function simpleHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
import { createHash } from "node:crypto";
