/**
 * Track 3: sovereign document content store. Immutable chunk content lives
 * only here, keyed by exact content hash, and is returned only when the
 * caller proves the exact reference. Indexes never store protected text.
 */

export class ContentIntegrityError extends Error {
  constructor(readonly code: "NOT_FOUND" | "DIGEST_MISMATCH" | "QUARANTINED", message: string) {
    super(message);
  }
}

export interface ContentChunk {
  versionRef: string;
  chunkRef: string;
  contentHash: `sha256:${string}`;
  text: string;
  citationAnchor: string;
}

export interface ContentStoreFetchInput {
  fence: string;
  resources: readonly { versionRef: string; chunkRef: string; contentHash: `sha256:${string}` }[];
}

export interface ContentStore {
  fetch(input: ContentStoreFetchInput): readonly ContentChunk[];
  verify(chunkRef: string, expectedHash: `sha256:${string}`): boolean;
}

function textDigest(text: string): `sha256:${string}` {
  return `sha256:${simpleHash(text)}`;
}

export class SovereignContentStore implements ContentStore {
  private readonly chunks = new Map<string, ContentChunk>();
  private readonly quarantine = new Set<string>();

  constructor(
    private readonly verifyFence: (fence: string, resources: ContentStoreFetchInput["resources"]) => boolean =
      (fence) => fence.startsWith("signed:"),
  ) {}

  write(chunk: ContentChunk): void {
    if (!chunk.text) throw new ContentIntegrityError("QUARANTINED", "Empty chunk text is not admissible.");
    const computed = textDigest(chunk.text);
    if (computed !== chunk.contentHash) {
      throw new ContentIntegrityError("DIGEST_MISMATCH", "The chunk text does not match its content hash.");
    }
    const key = this.key(chunk.versionRef, chunk.chunkRef);
    const existing = this.chunks.get(key);
    if (existing && existing.contentHash !== chunk.contentHash) {
      throw new ContentIntegrityError("QUARANTINED", "The immutable chunk reference was reused with different content.");
    }
    this.chunks.set(key, chunk);
    this.quarantine.delete(key);
  }

  fetch(input: ContentStoreFetchInput): readonly ContentChunk[] {
    if (!input.fence || !this.verifyFence(input.fence, input.resources)) {
      throw new ContentIntegrityError("QUARANTINED", "A valid content fence is required.");
    }
    const out: ContentChunk[] = [];
    for (const resource of input.resources) {
      const key = this.key(resource.versionRef, resource.chunkRef);
      if (this.quarantine.has(key)) throw new ContentIntegrityError("QUARANTINED", "A chunk under quarantine is not served.");
      const chunk = this.chunks.get(key);
      if (!chunk || chunk.contentHash !== resource.contentHash) {
        throw new ContentIntegrityError("NOT_FOUND", "The exact chunk reference is not available.");
      }
      out.push(chunk);
    }
    return out;
  }

  verify(chunkRef: string, expectedHash: `sha256:${string}`): boolean {
    for (const chunk of this.chunks.values()) {
      if (chunk.chunkRef === chunkRef) return chunk.contentHash === expectedHash && !this.quarantine.has(this.key(chunk.versionRef, chunk.chunkRef));
    }
    return false;
  }

  /** Digest-mismatched or administratively quarantined chunks stop being served. */
  quarantineChunk(versionRef: string, chunkRef: string): void {
    this.quarantine.add(this.key(versionRef, chunkRef));
  }

  /** Removes a version's chunks; removed documents must not remain retrievable. */
  removeVersion(versionRef: string): void {
    for (const key of this.chunks.keys()) {
      if (key.startsWith(`${versionRef}@`)) {
        this.chunks.delete(key);
        this.quarantine.add(key);
      }
    }
  }

  private key(versionRef: string, chunkRef: string): string {
    return `${versionRef}@${chunkRef}`;
  }
}
import { simpleHash } from "./indexGenerationManifest";
