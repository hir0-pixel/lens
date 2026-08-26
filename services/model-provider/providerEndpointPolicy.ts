export class SecretReferenceError extends Error {
  constructor(message: string) { super(message); }
}

/** Server-side secret material. Never accepts browser/localStorage values. */
export function resolveSecretRef(secretRef: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!secretRef || secretRef.includes("/") || secretRef.includes("\\") || secretRef.includes(" ")) {
    throw new SecretReferenceError("secret_ref must be a token name.");
  }
  const value = env[`LENS_SECRET_${secretRef}`];
  if (!value || value.length < 8) throw new SecretReferenceError(`Secret ${secretRef} is missing or too short.`);
  return value;
}

export function assertInternalProviderUrl(raw: string, profile: "sovereign" | "development"): URL {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash) throw new Error("Provider base_url must be a plain origin or path.");
  const host = url.hostname.toLowerCase();
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  const internal = loopback || host.endsWith(".internal");
  if (profile === "sovereign") {
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      throw new Error("Sovereign providers require HTTPS or loopback HTTP.");
    }
    if (!internal) throw new Error("Sovereign providers must use an internal DNS/IP allowlist host.");
  } else if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Provider URL protocol is not allowed.");
  }
  if (host === "169.254.169.254" || host.endsWith(".nip.io")) throw new Error("Provider host is not allowed.");
  return url;
}

/** Resolve OpenAI-style resources against the configured base URL without swapping adapters. */
export function openAiCompatibleResourceUrl(origin: URL, resource: "models" | "chat/completions" | "embeddings"): URL {
  const path = origin.pathname.replace(/\/$/, "");
  if (path.endsWith("/v1") || path.endsWith("/openai")) {
    return new URL(`${path}/${resource}`, origin);
  }
  return new URL(`/v1/${resource}`, origin);
}

export function modelAllowed(model: string, patterns: readonly string[]): boolean {
  const needle = normalizeDiscoveredModelId(model);
  return patterns.some((pattern) => {
    const allow = normalizeDiscoveredModelId(pattern);
    return allow === needle || (allow.endsWith("*") && needle.startsWith(allow.slice(0, -1)));
  });
}

/** Gemini native list uses `models/{id}`; OpenAI-compat may put that string in `id`. */
export function normalizeDiscoveredModelId(id: string): string {
  const trimmed = id.trim().toLowerCase();
  return trimmed.startsWith("models/") ? trimmed.slice("models/".length) : trimmed;
}

export function parseOpenAiCompatibleModelCatalog(body: unknown): string[] {
  const ids: string[] = [];
  if (!body || typeof body !== "object") return ids;
  const record = body as { data?: unknown; models?: unknown };
  const rows = [
    ...(Array.isArray(record.data) ? record.data : []),
    ...(Array.isArray(record.models) ? record.models : []),
  ];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as { id?: unknown; name?: unknown };
    if (typeof item.id === "string") ids.push(normalizeDiscoveredModelId(item.id));
    else if (typeof item.name === "string") ids.push(normalizeDiscoveredModelId(item.name));
  }
  return [...new Set(ids.filter(Boolean))];
}
