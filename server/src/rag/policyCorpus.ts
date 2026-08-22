import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";

export interface PolicyCitation {
  resource: string;
  version: string;
  chunk: string;
  digest: string;
}

export interface PolicyChunk {
  id: string;
  title: string;
  text: string;
  citation: PolicyCitation;
  tokens: Map<string, number>;
  titleTokens: Map<string, number>;
  length: number;
}

export interface PolicyCorpusSnapshot {
  generation: string;
  chunks: readonly PolicyChunk[];
  byToken: ReadonlyMap<string, readonly number[]>;
  averageLength: number;
}

export interface PolicyCorpusOptions {
  root: string;
  refreshTtlMs?: number;
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  chunkBytes?: number;
  now?: () => number;
}

const EXTENSIONS = new Set([".md", ".txt"]);

export function normalizeTokens(value: string): string[] {
  return (value.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

function frequency(tokens: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const token of tokens) result.set(token, (result.get(token) ?? 0) + 1);
  return result;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function splitIntoChunks(text: string, maxBytes: number): string[] {
  const paragraphs = text.replace(/\r\n?/g, "\n").split(/\n{2,}/g).map((part) => part.trim()).filter(Boolean);
  const output: string[] = [];
  let current = "";
  const append = (part: string) => {
    const candidate = current ? `${current}\n\n${part}` : part;
    if (Buffer.byteLength(candidate, "utf8") <= maxBytes) current = candidate;
    else if (current) { output.push(current); current = part; }
    else {
      // A single oversized paragraph is split by Unicode code points rather
      // than silently exceeding the context bound.
      let piece = "";
      for (const character of part) {
        if (Buffer.byteLength(`${piece}${character}`, "utf8") > maxBytes && piece) {
          output.push(piece); piece = character;
        } else piece += character;
      }
      current = piece;
    }
  };
  for (const paragraph of paragraphs) append(paragraph);
  if (current) output.push(current);
  return output;
}

async function filesUnder(root: string, maxFiles: number, deadline: number, clock: () => number, signal?: AbortSignal): Promise<string[]> {
  const result: string[] = [];
  const queue = [root];
  const rootReal = await fs.realpath(root);
  const visitedDirectories = new Set<string>([rootReal]);
  while (queue.length && result.length < maxFiles) {
    if (signal?.aborted || clock() > deadline) throw new Error("RAG corpus scan deadline exceeded");
    const directory = queue.shift()!;
    const entries = (await fs.readdir(directory, { withFileTypes: true }))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (result.length >= maxFiles) break;
      const candidate = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        // Symlinks are accepted only when their resolved target remains inside
        // the configured corpus root.
        const target = await fs.realpath(candidate).catch(() => "");
        if (!target || (target !== rootReal && !target.startsWith(`${rootReal}${sep}`))) continue;
        const stat = await fs.stat(candidate).catch(() => undefined);
        if (stat?.isDirectory() && !visitedDirectories.has(target)) { visitedDirectories.add(target); queue.push(target); }
        else if (stat?.isFile() && EXTENSIONS.has(extname(candidate).toLowerCase())) result.push(target);
      } else if (entry.isDirectory()) {
        const target = await fs.realpath(candidate).catch(() => "");
        if (target && !visitedDirectories.has(target)) { visitedDirectories.add(target); queue.push(target); }
      }
      else if (entry.isFile() && EXTENSIONS.has(extname(entry.name).toLowerCase())) result.push(candidate);
    }
  }
  return result.sort((a, b) => relative(rootReal, a).localeCompare(relative(rootReal, b)));
}

export function createPolicyCorpus(options: PolicyCorpusOptions) {
  const root = resolve(options.root);
  const refreshTtlMs = Math.max(1_000, options.refreshTtlMs ?? 60_000);
  const maxFiles = Math.max(1, options.maxFiles ?? 500);
  const maxFileBytes = Math.max(256, options.maxFileBytes ?? 2 * 1024 * 1024);
  const maxTotalBytes = Math.max(maxFileBytes, options.maxTotalBytes ?? 20 * 1024 * 1024);
  const chunkBytes = Math.max(256, options.chunkBytes ?? 2_400);
  const now = options.now ?? Date.now;
  let snapshot: PolicyCorpusSnapshot | undefined;
  let loadedAt = 0;
  let fingerprint = "";
  let inflight: Promise<PolicyCorpusSnapshot> | undefined;

  async function rootFingerprint(): Promise<string> {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) throw new Error("RAG corpus root is not a directory");
    return `${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.size}`;
  }

  async function load(request?: { deadline?: number; signal?: AbortSignal }): Promise<PolicyCorpusSnapshot> {
    const deadline = Math.min(now() + refreshTtlMs, request?.deadline ?? Number.POSITIVE_INFINITY);
    const realRoot = await fs.realpath(root);
    const paths = await filesUnder(realRoot, maxFiles, deadline, now, request?.signal);
    const chunks: PolicyChunk[] = [];
    let totalBytes = 0;
    for (const path of paths) {
      if (request?.signal?.aborted || now() > deadline) throw new Error("RAG corpus scan deadline exceeded");
      const stat = await fs.stat(path);
      if (stat.size > maxFileBytes || totalBytes + stat.size > maxTotalBytes) continue;
      const raw = await fs.readFile(path);
      totalBytes += raw.byteLength;
      const content = raw.toString("utf8");
      const version = digest(content);
      const resource = relative(realRoot, path).replaceAll("\\", "/");
      const title = basename(resource, extname(resource));
      const parts = splitIntoChunks(content, chunkBytes);
      parts.forEach((part, ordinal) => {
        const chunkDigest = digest(part);
        const id = digest(`${resource}\0${version}\0${ordinal}\0${chunkDigest}`).slice(0, 32);
        const tokens = normalizeTokens(part);
        const titleTokens = normalizeTokens(title);
        const citation = Object.freeze({ resource, version, chunk: id, digest: chunkDigest });
        chunks.push(Object.freeze({
          id, title, text: part,
          citation,
          tokens: frequency(tokens), titleTokens: frequency(titleTokens), length: tokens.length,
        }));
      });
    }
    chunks.sort((a, b) => a.citation.resource.localeCompare(b.citation.resource) || a.id.localeCompare(b.id));
    const byToken = new Map<string, number[]>();
    chunks.forEach((chunk, index) => {
      for (const token of new Set([...chunk.tokens.keys(), ...chunk.titleTokens.keys()])) {
        const postings = byToken.get(token) ?? [];
        postings.push(index); byToken.set(token, postings);
      }
    });
    const averageLength = chunks.length ? chunks.reduce((sum, chunk) => sum + chunk.length, 0) / chunks.length : 1;
    const generation = digest(chunks.map((chunk) => `${chunk.citation.resource}\0${chunk.citation.version}`).join("\n"));
    return Object.freeze({ generation, chunks: Object.freeze(chunks), byToken, averageLength });
  }

  async function getSnapshot(force = false, request?: { deadline?: number; signal?: AbortSignal }): Promise<PolicyCorpusSnapshot> {
    const currentFingerprint = await rootFingerprint();
    if (!force && snapshot && now() - loadedAt < refreshTtlMs && currentFingerprint === fingerprint) return snapshot;
    if (!inflight) {
      inflight = load(request).then((next) => { snapshot = next; loadedAt = now(); fingerprint = currentFingerprint; return next; })
        .finally(() => { inflight = undefined; });
    }
    return inflight;
  }

  return { getSnapshot };
}

export type PolicyCorpus = ReturnType<typeof createPolicyCorpus>;
