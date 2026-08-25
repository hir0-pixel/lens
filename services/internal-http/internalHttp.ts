/**
 * Shared internal-only HTTP helpers: origin validation, bounded JSON, workload tokens.
 * Copied conventions from orchestrator-service AuthorityHttpClient / InternalInferenceClient.
 */
export type FetchPort = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const MAX_INTERNAL_JSON_BYTES = 256 * 1024;

export class InternalHttpConfigError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export function isInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".internal")) return true;
  const parts = host.split(".").map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
  }
  return host.startsWith("fc") || host.startsWith("fd");
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function assertInternalOrigin(value: string, name: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new InternalHttpConfigError(`${name} must be a valid internal origin.`);
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") {
    throw new InternalHttpConfigError(`${name} must be a plain internal origin.`);
  }
  if (endpoint.protocol === "https:" && isInternalHost(endpoint.hostname)) return endpoint;
  if (endpoint.protocol === "http:" && isLoopbackHost(endpoint.hostname)) return endpoint;
  throw new InternalHttpConfigError(`${name} must use HTTPS with an internal host or loopback HTTP.`);
}

export function assertWorkloadToken(token: string, name: string): void {
  if (token.length < 32) throw new InternalHttpConfigError(`${name} must contain at least 32 characters.`);
}

export async function readBoundedJson(response: Response, maxBytes = MAX_INTERNAL_JSON_BYTES): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("DEPENDENCY_UNAVAILABLE");
  }
  if (!response.body) throw new Error("DEPENDENCY_UNAVAILABLE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("DEPENDENCY_UNAVAILABLE");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"));
  } catch {
    throw new Error("DEPENDENCY_UNAVAILABLE");
  }
}

export function deadlineSignal(parent: AbortSignal | undefined, deadlineAt: number): AbortSignal {
  const timeout = AbortSignal.timeout(Math.max(1, deadlineAt - Date.now()));
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}
