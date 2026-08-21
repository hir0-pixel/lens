import { computeCandidateRefsDigest, type IndexGenerationManifest, type IndexProfile, assertIndexProfile } from "./indexGenerationManifest";

export type { IndexProfile };

const ZERO_DIGEST: `sha256:${string}` = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Track 3: independent publication record. One authoritative writer advances
 * a monotonic visibility_sequence. A new generation is built as inactive,
 * validated, then atomically published: the active generation pointer moves
 * in one step and the previous active generation becomes retired. Active
 * generations are never mutated in place. Rollback restores the last retired
 * generation by re-pointing the active pointer and bumping the sequence.
 */

export class PublicationError extends Error {
  constructor(readonly code: "INVALID_ARGUMENT" | "CONFLICT" | "STALE_AUTHORITY" | "NOT_FOUND", message: string) {
    super(message);
  }
}

export interface ActivePublication {
  generationId: string;
  visibilitySequence: number;
  indexGeneration: string;
  sourceRevisionDigest: `sha256:${string}`;
  searchableVersionRefs: readonly string[];
  profile: IndexProfile;
  activatedAt: number;
}

export interface PublicationSnapshot {
  visibilitySequence: number;
  active: ActivePublication | undefined;
  retired: readonly string[];
}

export interface PublicationAuthorityPort {
  activeGeneration(input: { corpusRef: string; deadlineAt: number; signal?: AbortSignal }): {
    indexGeneration: string;
    visibilitySequence: number;
    sourceRevisionDigest: `sha256:${string}`;
  };
}

export class PublicationAuthority implements PublicationAuthorityPort {
  private readonly generations = new Map<string, IndexGenerationManifest>();
  private readonly searchable = new Map<string, string[]>();
  private activeGenerationId: string | undefined;
  private retiredOrder: string[] = [];
  private readonly withdrawnVersions = new Set<string>();
  private sequence = 0;
  private writer = 0;

  constructor(
    private readonly corpusRef: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private readonly assertWriter = (writerToken: number): void => {
    if (this.writer === 0) {
      this.writer = writerToken;
    }
    if (writerToken !== this.writer) throw new PublicationError("STALE_AUTHORITY", "Another writer owns publication.");
  };

  beginGeneration(writerToken: number, generationId: string, profile: IndexProfile): void {
    assertIndexProfile(profile);
    this.assertWriter(writerToken);
    if (!generationId || this.generations.has(generationId)) throw new PublicationError("CONFLICT", "The generation identifier is not available.");
    this.generations.set(generationId, { generationId, corpusRef: this.corpusRef, profile, candidateRefs: [], integrityDigest: ZERO_DIGEST, state: "building" });
  }

  addCandidate(writerToken: number, generationId: string, candidateRef: IndexGenerationManifest["candidateRefs"][number]): void {
    this.assertWriter(writerToken);
    const generation = this.generations.get(generationId);
    if (!generation || generation.state !== "building") throw new PublicationError("STALE_AUTHORITY", "The generation is not accepting candidates.");
    if (this.withdrawnVersions.has(candidateRef.versionRef)) throw new PublicationError("STALE_AUTHORITY", "A withdrawn version cannot be added to a generation.");
    if (generation.candidateRefs.some((ref) => ref.chunkRef === candidateRef.chunkRef)) {
      throw new PublicationError("CONFLICT", "A chunk was already added to this generation.");
    }
    const next = { ...generation, candidateRefs: [...generation.candidateRefs, candidateRef] };
    next.integrityDigest = computeCandidateRefsDigest(next.candidateRefs);
    this.generations.set(generationId, next);
  }

  finalize(writerToken: number, generationId: string): IndexGenerationManifest {
    this.assertWriter(writerToken);
    const generation = this.generations.get(generationId);
    if (!generation || generation.state !== "building") throw new PublicationError("STALE_AUTHORITY", "The generation is not finalizable.");
    if (generation.candidateRefs.length === 0) throw new PublicationError("INVALID_ARGUMENT", "An empty generation cannot be published.");
    const integrity = computeCandidateRefsDigest(generation.candidateRefs);
    if (integrity !== generation.integrityDigest) throw new PublicationError("STALE_AUTHORITY", "The generation integrity digest is inconsistent.");
    const finalized: IndexGenerationManifest = { ...generation, integrityDigest: integrity, state: "finalized" };
    this.generations.set(generationId, finalized);
    return finalized;
  }

  /** Atomic cutover. The active generation pointer moves in one step; the prior active is retired. */
  publish(writerToken: number, generationId: string): ActivePublication {
    this.assertWriter(writerToken);
    const generation = this.generations.get(generationId);
    if (!generation) throw new PublicationError("NOT_FOUND", "The generation does not exist.");
    if (generation.state !== "finalized") {
      // Re-publishing an already-active generation is a no-op with its snapshot.
      if (generation.state === "active" && generation.generationId === this.activeGenerationId) return this.snapshot(generationId);
      throw new PublicationError("CONFLICT", "Only an inactive, finalized generation can be published.");
    }
    const previous = this.activeGenerationId;
    const activated: IndexGenerationManifest = { ...generation, state: "active", activatedAt: this.now() };
    this.generations.set(generationId, activated);
    if (previous && previous !== generationId) {
      const old = this.generations.get(previous);
      if (old && old.state === "active") {
        this.generations.set(previous, { ...old, state: "retired" });
        this.retiredOrder = [...this.retiredOrder, previous];
      }
    }
    this.activeGenerationId = generationId;
    this.sequence += 1;
    const versionRefs = [...new Set(activated.candidateRefs.map((ref) => ref.versionRef))]
      .filter((versionRef) => !this.withdrawnVersions.has(versionRef));
    this.searchable.set(generationId, versionRefs);
    return this.snapshot(generationId);
  }

  /** Restores the last retired generation; removed documents stay unsearchable. */
  rollback(writerToken: number): ActivePublication {
    this.assertWriter(writerToken);
    const target = this.retiredOrder[this.retiredOrder.length - 1];
    if (!target) throw new PublicationError("NOT_FOUND", "No retired generation is available to restore.");
    const current = this.activeGenerationId;
    if (current) {
      const active = this.generations.get(current);
      if (active) this.generations.set(current, { ...active, state: "retired" });
    }
    const restored = this.generations.get(target);
    if (!restored) throw new PublicationError("NOT_FOUND", "The rollback target is unavailable.");
    this.generations.set(target, { ...restored, state: "active", activatedAt: this.now() });
    this.retiredOrder = this.retiredOrder.filter((id) => id !== target);
    this.retiredOrder = [...this.retiredOrder, ...(current ? [current] : [])];
    this.activeGenerationId = target;
    this.sequence += 1;
    return this.snapshot(target);
  }

  snapshot(generationId?: string): ActivePublication {
    const id = generationId ?? this.activeGenerationId;
    if (!id) throw new PublicationError("NOT_FOUND", "No active publication exists.");
    const generation = this.generations.get(id);
    if (!generation || generation.state !== "active") throw new PublicationError("STALE_AUTHORITY", "The active publication is unavailable.");
    const searchableVersionRefs = (this.searchable.get(id) ?? [...new Set(generation.candidateRefs.map((ref) => ref.versionRef))])
      .filter((versionRef) => !this.withdrawnVersions.has(versionRef));
    return {
      generationId: id,
      visibilitySequence: this.sequence,
      indexGeneration: id,
      sourceRevisionDigest: generation.integrityDigest,
      searchableVersionRefs,
      profile: generation.profile,
      activatedAt: generation.activatedAt ?? this.now(),
    };
  }

  state(): PublicationSnapshot {
    return {
      visibilitySequence: this.sequence,
      active: this.activeGenerationId ? this.snapshot(this.activeGenerationId) : undefined,
      retired: [...this.retiredOrder],
    };
  }

  activeGeneration(input: { corpusRef: string; deadlineAt: number; signal?: AbortSignal }): ActivePublication {
    if (input.corpusRef !== this.corpusRef) throw new PublicationError("INVALID_ARGUMENT", "The corpus does not match this publication.");
    return this.snapshot();
  }

  /** A version is searchable only if the active publication lists it. */
  isSearchable(versionRef: string): boolean {
    const active = this.activeGenerationId;
    if (!active) return false;
    return (this.searchable.get(active) ?? []).includes(versionRef);
  }

  removeVersion(writerToken: number, versionRef: string): void {
    if (writerToken !== this.writer) throw new PublicationError("STALE_AUTHORITY", "Another writer owns publication.");
    this.withdrawnVersions.add(versionRef);
    for (const [generationId, current] of this.searchable) {
      this.searchable.set(generationId, current.filter((ref) => ref !== versionRef));
    }
  }
}
