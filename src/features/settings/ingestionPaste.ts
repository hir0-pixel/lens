/** Browser-side helpers for admin paste → Task 5 ingestion jobs (digests + simple chunking). */

export async function sha256Digest(text: string): Promise<`sha256:${string}`> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

/** Approximate tokens as words; split on blank lines then soft-wrap by maxTokens. */
export function chunkDocumentText(
  text: string,
  options: { maxTokens: number; overlapTokens: number; documentRef?: string },
): { chunkRef: string; text: string; citationAnchor: string }[] {
  const maxTokens = Math.max(32, options.maxTokens);
  const overlapTokens = Math.max(0, Math.min(options.overlapTokens, Math.floor(maxTokens / 2)));
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const units = paragraphs.length > 0 ? paragraphs : [text.trim()].filter(Boolean);
  const prefix = options.documentRef?.trim() ? `${options.documentRef.trim()}-` : "";
  const chunks: { chunkRef: string; text: string; citationAnchor: string }[] = [];
  let buffer: string[] = [];
  let bufferTokens = 0;
  let index = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    const body = buffer.join("\n\n").trim();
    if (!body) {
      buffer = [];
      bufferTokens = 0;
      return;
    }
    index += 1;
    chunks.push({
      chunkRef: `${prefix}chunk-${index}`,
      text: body,
      citationAnchor: `chunk:${index}`,
    });
    if (overlapTokens > 0) {
      const words = body.split(/\s+/).filter(Boolean);
      const keep = words.slice(-overlapTokens);
      buffer = keep.length > 0 ? [keep.join(" ")] : [];
      bufferTokens = keep.length;
    } else {
      buffer = [];
      bufferTokens = 0;
    }
  };

  for (const unit of units) {
    const words = unit.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    if (bufferTokens + words.length > maxTokens && buffer.length > 0) flush();
    if (words.length > maxTokens) {
      for (let offset = 0; offset < words.length; offset += maxTokens - overlapTokens) {
        const slice = words.slice(offset, offset + maxTokens);
        buffer = [slice.join(" ")];
        bufferTokens = slice.length;
        flush();
      }
      continue;
    }
    buffer.push(unit);
    bufferTokens += words.length;
    if (bufferTokens >= maxTokens) flush();
  }
  flush();
  return chunks;
}

export function slugDocumentRef(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || `doc-${Date.now()}`;
}
