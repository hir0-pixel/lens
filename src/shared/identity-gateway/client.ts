export interface IdentityGatewayConfig {
  baseUrl: string;
}

export interface IdentitySession {
  subjectRef: string;
  csrfToken: string;
  expiresAt: number;
}

export class IdentityGatewayError extends Error {}
export class IdentityLoginRequiredError extends IdentityGatewayError {}

type Environment = Record<string, string | boolean | undefined>;
type Fetcher = typeof fetch;

function normalizeBaseUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "lens-gateway.platform.internal" ||
      url.port !== "8444" ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

/** Internal test configuration. Production builds deliberately reject this value. */
export function getIdentityGatewayConfig(environment: Environment = import.meta.env): IdentityGatewayConfig | undefined {
  if (environment.PROD === true) return undefined;
  const value = environment.VITE_LENS_SESSION_GATEWAY_URL;
  const baseUrl = typeof value === "string" ? normalizeBaseUrl(value) : undefined;
  return baseUrl ? { baseUrl } : undefined;
}

export function beginIdentityLogin(config: IdentityGatewayConfig): void {
  window.location.assign(`${config.baseUrl}/auth/login`);
}

export async function getIdentitySession(config: IdentityGatewayConfig, fetcher: Fetcher = fetch): Promise<IdentitySession | undefined> {
  const response = await fetcher(`${config.baseUrl}/v1/session`, {
    method: "GET",
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (response.status === 401) return undefined;
  if (!response.ok) throw new IdentityGatewayError("The identity gateway is unavailable.");
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") throw new IdentityGatewayError("The identity gateway returned an invalid session.");
  const session = payload as Partial<IdentitySession>;
  if (typeof session.subjectRef !== "string" || typeof session.csrfToken !== "string" || typeof session.expiresAt !== "number") {
    throw new IdentityGatewayError("The identity gateway returned an invalid session.");
  }
  return session as IdentitySession;
}

export async function generateIdentityGatewayResponse(prompt: string, config: IdentityGatewayConfig, signal?: AbortSignal, fetcher: Fetcher = fetch): Promise<string> {
  const session = await getIdentitySession(config, fetcher);
  if (!session) throw new IdentityLoginRequiredError("Sign in is required.");
  const response = await fetcher(`${config.baseUrl}/v1/generate`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", "x-lens-csrf": session.csrfToken, accept: "application/json" },
    body: JSON.stringify({ publicTest: true, prompt }),
    signal,
  });
  if (response.status === 401) throw new IdentityLoginRequiredError("Sign in is required.");
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new IdentityGatewayError("The identity gateway returned an invalid response."); }
  if (!response.ok || !payload || typeof payload !== "object" || typeof (payload as { output?: unknown }).output !== "string") {
    throw new IdentityGatewayError("The identity gateway is unavailable.");
  }
  return (payload as { output: string }).output;
}
