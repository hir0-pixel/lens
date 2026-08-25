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

export function modelAllowed(model: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => pattern === model || (pattern.endsWith("*") && model.startsWith(pattern.slice(0, -1))));
}
