export interface AuthSessionInfo {
  authenticated: boolean;
  subject?: string;
  name?: string;
  email?: string;
  picture?: string;
  preferredUsername?: string;
  expiresAt?: number;
}

export type AuthClientErrorCode =
  | "AUTH_REQUIRED"
  | "LOGIN_UNAVAILABLE"
  | "LOGOUT_UNAVAILABLE"
  | "SESSION_UNAVAILABLE"
  | "SESSION_INVALID"
  | "GENERATION_UNAVAILABLE"
  | "RAG_UNAVAILABLE"
  | "OVERLOADED"
  | "CAPACITY_UNAVAILABLE"
  | "DEPENDENCY_UNAVAILABLE"
  | "RATE_LIMITED";

export class AuthClientError extends Error {
  readonly code: AuthClientErrorCode;
  readonly status?: number;

  constructor(code: AuthClientErrorCode, status?: number) {
    super(code);
    this.name = "AuthClientError";
    this.code = code;
    this.status = status;
  }
}

export interface RagAnswer {
  output: string;
  citations: readonly { source: string; section: string }[];
}

export interface AuthClientOptions {
  baseUrl: string;
  sessionEndpoint?: string;
  generateEndpoint?: string;
  ragEndpoint?: string;
  loginPath?: string;
  logoutPath?: string;
  csrfCookieName?: string;
  csrfHeaderName?: string;
  fetcher?: typeof fetch;
  /** When true, login is opened in the system browser (Tauri desktop). */
  openExternal?: (url: string) => void;
}

function sameOriginBase(baseUrl: string): string {
  if (baseUrl === "") return "";
  return baseUrl.replace(/\/$/, "");
}

function readErrorCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const error = (payload as { error?: unknown }).error;
  return typeof error === "string" ? error : undefined;
}

function classifyEndpointError(
  response: Response,
  payload: unknown,
  fallback: AuthClientErrorCode,
): AuthClientError {
  const errorCode = readErrorCode(payload);
  if (response.status === 401 || errorCode === "UNAUTHENTICATED") {
    return new AuthClientError("AUTH_REQUIRED", response.status);
  }
  if (response.status === 429 || errorCode === "OVERLOADED") {
    return new AuthClientError("OVERLOADED", response.status);
  }
  if (errorCode === "RATE_LIMITED") {
    return new AuthClientError("RATE_LIMITED", response.status);
  }
  if (
    errorCode === "DRAINING" ||
    errorCode === "ADMISSION_UNAVAILABLE" ||
    errorCode === "CAPACITY_UNAVAILABLE" ||
    errorCode === "CAPACITY_EXHAUSTED"
  ) {
    return new AuthClientError("CAPACITY_UNAVAILABLE", response.status);
  }
  if (errorCode === "DEPENDENCY_UNAVAILABLE") {
    return new AuthClientError("DEPENDENCY_UNAVAILABLE", response.status);
  }
  return new AuthClientError(fallback, response.status);
}

async function readJsonPayload(response: Response): Promise<unknown | undefined> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export function createAuthClient(options: AuthClientOptions) {
  const baseUrl = sameOriginBase(options.baseUrl);
  const sessionEndpoint = options.sessionEndpoint ?? "/api/session";
  const generateEndpoint = options.generateEndpoint ?? "/api/generate";
  const ragEndpoint = options.ragEndpoint ?? "/api/rag/ask";
  const loginPath = options.loginPath ?? "/auth/login";
  const logoutPath = options.logoutPath ?? "/auth/logout";
  const csrfCookieName = options.csrfCookieName ?? "lens_csrf";
  const csrfHeaderName = options.csrfHeaderName ?? "x-lens-csrf";
  const fetcher = options.fetcher ?? fetch;

  function csrfHeaders(): Record<string, string> {
    if (typeof document === "undefined") return {};
    const prefix = `${encodeURIComponent(csrfCookieName)}=`;
    const cookie = document.cookie
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith(prefix));
    if (!cookie) return {};
    try {
      return { [csrfHeaderName]: decodeURIComponent(cookie.slice(prefix.length)) };
    } catch {
      return {};
    }
  }

  async function getSession(signal?: AbortSignal): Promise<AuthSessionInfo> {
    const response = await fetcher(`${baseUrl}${sessionEndpoint}`, {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      throw new AuthClientError("SESSION_UNAVAILABLE", response.status);
    }
    const payload = await readJsonPayload(response);
    if (!payload || typeof payload !== "object") {
      throw new AuthClientError("SESSION_INVALID", response.status);
    }
    return payload as AuthSessionInfo;
  }

  async function beginLogin(): Promise<void> {
    const url = `${baseUrl}${loginPath}`;
    if (options.openExternal) {
      options.openExternal(url);
      return;
    }
    // Probe the login endpoint without following the redirect. A healthy BFF
    // replies 302 to the IdP; a misconfigured/unreachable one replies an
    // error, and we surface it instead of hard-navigating to an error page.
    try {
      const response = await fetcher(url, {
        method: "GET",
        credentials: "include",
        redirect: "manual",
        headers: { accept: "application/json" },
      });
      if (response.type === "opaqueredirect" || response.status >= 300 && response.status < 400) {
        window.location.assign(url);
        return;
      }
      throw new AuthClientError("LOGIN_UNAVAILABLE", response.status);
    } catch (error) {
      if (error instanceof AuthClientError) throw error;
      throw new AuthClientError("LOGIN_UNAVAILABLE");
    }
  }

  async function logout(signal?: AbortSignal): Promise<void> {
    const response = await fetcher(`${baseUrl}${logoutPath}`, {
      method: "POST",
      credentials: "include",
      headers: { accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      throw new AuthClientError("LOGOUT_UNAVAILABLE", response.status);
    }
    let payload: unknown = {};
    try {
      payload = await response.json();
    } catch {
      // Non-JSON success is fine; we just won't redirect to the IdP.
    }
    // If the BFF offers an IdP end-session URL, navigate there so the IdP
    // session also ends (full single logout). localStorage isn't used; this is
    // a navigation, not a credential.
    const logoutUrl = (payload as { logoutUrl?: unknown })?.logoutUrl;
    if (typeof logoutUrl === "string" && logoutUrl) {
      if (options.openExternal) {
        options.openExternal(logoutUrl);
      } else {
        window.location.assign(logoutUrl);
      }
    }
  }

  async function generate(prompt: string, signal?: AbortSignal): Promise<string> {
    const session = await getSession(signal);
    if (!session.authenticated) {
      throw new AuthClientError("AUTH_REQUIRED");
    }
    const response = await fetcher(`${baseUrl}${generateEndpoint}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json", ...csrfHeaders() },
      body: JSON.stringify({ prompt }),
      signal,
    });
    const payload = await readJsonPayload(response);
    if (!response.ok) {
      throw classifyEndpointError(response, payload, "GENERATION_UNAVAILABLE");
    }
    if (!payload || typeof payload !== "object" || typeof (payload as { output?: unknown }).output !== "string") {
      throw new AuthClientError("GENERATION_UNAVAILABLE", response.status);
    }
    return (payload as { output: string }).output;
  }

  async function askRag(query: string, signal?: AbortSignal): Promise<RagAnswer> {
    const session = await getSession(signal);
    if (!session.authenticated) throw new AuthClientError("AUTH_REQUIRED");
    const response = await fetcher(`${baseUrl}${ragEndpoint}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json", ...csrfHeaders() },
      body: JSON.stringify({ query }),
      signal,
    });
    const payload = await readJsonPayload(response);
    if (!response.ok) {
      throw classifyEndpointError(response, payload, "RAG_UNAVAILABLE");
    }
    if (!payload || typeof payload !== "object" || typeof (payload as { output?: unknown }).output !== "string" || !Array.isArray((payload as { citations?: unknown }).citations)) {
      throw new AuthClientError("RAG_UNAVAILABLE", response.status);
    }
    const result = payload as { output: string; citations: unknown[] };
    if (result.citations.some((citation) => !citation || typeof citation !== "object" || typeof (citation as { source?: unknown }).source !== "string" || typeof (citation as { section?: unknown }).section !== "string")) {
      throw new AuthClientError("RAG_UNAVAILABLE", response.status);
    }
    return {
      output: result.output,
      citations: result.citations.map((citation) => ({
        source: (citation as { source: string }).source,
        section: (citation as { section: string }).section,
      })),
    };
  }

  return {
    getSession,
    beginLogin,
    logout,
    generate,
    askRag,
  };
}

export type AuthClient = ReturnType<typeof createAuthClient>;
