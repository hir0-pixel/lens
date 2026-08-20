export interface AuthSessionInfo {
  authenticated: boolean;
  subject?: string;
  name?: string;
  email?: string;
  picture?: string;
  preferredUsername?: string;
  expiresAt?: number;
}

export class AuthClientError extends Error {}

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
      throw new AuthClientError("Session endpoint unavailable");
    }
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") {
      throw new AuthClientError("Session endpoint returned invalid data");
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
      throw new AuthClientError("LOGIN_UNAVAILABLE");
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
      throw new AuthClientError("Logout failed");
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
    if (response.status === 401) {
      throw new AuthClientError("AUTH_REQUIRED");
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AuthClientError("Generation endpoint returned invalid data");
    }
    if (!response.ok || !payload || typeof payload !== "object" || typeof (payload as { output?: unknown }).output !== "string") {
      throw new AuthClientError("Generation endpoint unavailable");
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
    if (response.status === 401) throw new AuthClientError("AUTH_REQUIRED");
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AuthClientError("RAG_UNAVAILABLE");
    }
    if (!response.ok || !payload || typeof payload !== "object" || typeof (payload as { output?: unknown }).output !== "string" || !Array.isArray((payload as { citations?: unknown }).citations)) {
      throw new AuthClientError("RAG_UNAVAILABLE");
    }
    const result = payload as { output: string; citations: unknown[] };
    if (result.citations.some((citation) => !citation || typeof citation !== "object" || typeof (citation as { source?: unknown }).source !== "string" || typeof (citation as { section?: unknown }).section !== "string")) {
      throw new AuthClientError("RAG_UNAVAILABLE");
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
