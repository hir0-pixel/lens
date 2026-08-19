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

export interface AuthClientOptions {
  baseUrl: string;
  sessionEndpoint?: string;
  generateEndpoint?: string;
  loginPath?: string;
  logoutPath?: string;
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
  const loginPath = options.loginPath ?? "/auth/login";
  const logoutPath = options.logoutPath ?? "/auth/logout";
  const fetcher = options.fetcher ?? fetch;

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
      headers: { "content-type": "application/json", accept: "application/json" },
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

  return {
    getSession,
    beginLogin,
    logout,
    generate,
  };
}

export type AuthClient = ReturnType<typeof createAuthClient>;
