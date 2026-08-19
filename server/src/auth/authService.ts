import { z } from "zod";
import { getConfig } from "../config";
import { discoverProviderConfig } from "./oidcClient";
import { createSessionManager, type SessionManager } from "./sessionManager";
import { timingSafeCompare, type SealedSession, randomBase64Url } from "../utils/crypto";

export interface ExchangeTokenResult {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresIn: number;
  subject: string;
  profile: {
    name?: string;
    email?: string;
    picture?: string;
    preferredUsername?: string;
  };
}

export interface UserInfo {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
  preferredUsername?: string;
}

export interface SessionInfo {
  authenticated: boolean;
  subject?: string;
  name?: string;
  email?: string;
  picture?: string;
  preferredUsername?: string;
  expiresAt?: number;
}

export class AuthServiceError extends Error {}

export function createAuthService(options: {
  sessionManager?: SessionManager;
  fetchImpl?: typeof fetch;
}) {
  const cfg = getConfig();
  const sessionManager = options.sessionManager ?? createSessionManager();
  const fetcher = options.fetchImpl ?? fetch;

  async function exchangeCodeForTokens(code: string, verifier: string): Promise<ExchangeTokenResult> {
    const provider = await discoverProviderConfig(fetcher);
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.OIDC_REDIRECT_URI ?? "",
      client_id: cfg.OIDC_CLIENT_ID ?? "",
      code_verifier: verifier,
    });
    const headers: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    };
    if (cfg.OIDC_CLIENT_SECRET) {
      headers.authorization = `Basic ${Buffer.from(`${cfg.OIDC_CLIENT_ID}:${cfg.OIDC_CLIENT_SECRET}`).toString("base64")}`;
    }
    let response: Response;
    try {
      response = await fetcher(provider.tokenEndpoint, {
        method: "POST",
        headers,
        body,
      });
    } catch {
      throw new AuthServiceError("Token exchange failed");
    }
    if (!response.ok) {
      throw new AuthServiceError("Token exchange rejected by identity provider");
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AuthServiceError("Token exchange returned invalid JSON");
    }
    const parsed = tokenResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AuthServiceError("Token response is invalid");
    }
    const accessToken = parsed.data.access_token;
    const refreshToken = parsed.data.refresh_token;
    const idToken = parsed.data.id_token;
    const expiresIn = parsed.data.expires_in;

    let subject = "";
    let profile: ExchangeTokenResult["profile"] = {};
    if (idToken) {
      const claims = decodeIdToken(idToken);
      if (claims?.sub) subject = claims.sub;
      profile = {
        name: claims?.name,
        email: claims?.email,
        picture: claims?.picture,
        preferredUsername: claims?.preferred_username ?? claims?.nickname,
      };
    }
    if (!subject) {
      try {
        const userinfo = await fetchUserInfo(accessToken);
        subject = userinfo.sub;
        profile = {
          name: userinfo.name ?? profile.name,
          email: userinfo.email ?? profile.email,
          picture: userinfo.picture ?? profile.picture,
          preferredUsername: userinfo.preferredUsername ?? profile.preferredUsername,
        };
      } catch {
        throw new AuthServiceError("Unable to resolve user identity");
      }
    }

    return {
      accessToken,
      refreshToken,
      idToken,
      expiresIn,
      subject,
      profile,
    };
  }

  async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
    const provider = await discoverProviderConfig(fetcher);
    if (!provider.userinfoEndpoint) throw new AuthServiceError("Userinfo endpoint not configured");
    let response: Response;
    try {
      response = await fetcher(provider.userinfoEndpoint, {
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      });
    } catch {
      throw new AuthServiceError("Userinfo request failed");
    }
    if (!response.ok) throw new AuthServiceError("Userinfo request rejected");
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AuthServiceError("Userinfo returned invalid JSON");
    }
    const parsed = userInfoSchema.safeParse(payload);
    if (!parsed.success) throw new AuthServiceError("Userinfo payload is invalid");
    return parsed.data;
  }

  async function validateToken(token: string, expectedSubject?: string): Promise<boolean> {
    const provider = await discoverProviderConfig(fetcher);
    const endpoint =
      provider.introspectionEndpoint ??
      cfg.OIDC_TOKEN_INTROSPECTION_ENDPOINT;
    if (!endpoint) {
      return true;
    }
    try {
      const body = new URLSearchParams({ token, token_type_hint: "access_token" });
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${cfg.OIDC_CLIENT_ID}:${cfg.OIDC_CLIENT_SECRET}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body,
      });
      if (!response.ok) return false;
      const payload = (await response.json()) as { active?: boolean; sub?: string };
      if (payload?.active !== true) return false;
      if (expectedSubject && payload?.sub !== expectedSubject) return false;
      return true;
    } catch {
      return false;
    }
  }

  function createSealedSession(input: {
    tokens: ExchangeTokenResult;
    subject: string;
    csrfToken: string;
    profile: ExchangeTokenResult["profile"];
  }): SealedSession {
    const expiresAt = Date.now() + cfg.SESSION_TTL_MS;
    return {
      version: 1,
      sid: randomBase64Url(16),
      subjectRef: input.subject,
      csrfToken: input.csrfToken,
      accessToken: input.tokens.accessToken,
      refreshToken: input.tokens.refreshToken ?? "",
      idToken: input.tokens.idToken ?? "",
      tokenExpiresAt: Date.now() + input.tokens.expiresIn * 1000,
      expiresAt,
      profile: input.profile,
    };
  }

  async function completeLogin(
    state: string | undefined,
    code: string | undefined,
    pendingFlow: { verifier: string; nonce: string; state: string } | undefined,
  ): Promise<{ sessionCookie: string; csrfToken: string; subject: string; expiresAt: number }> {
    if (!pendingFlow || !timingSafeCompare(state ?? "", pendingFlow.state)) {
      throw new AuthServiceError("OIDC state mismatch");
    }
    const tokens = await exchangeCodeForTokens(code ?? "", pendingFlow.verifier);
    const csrfToken = randomBase64Url(32);
    const session = createSealedSession({
      tokens,
      subject: tokens.subject,
      csrfToken,
      profile: tokens.profile,
    });
    const sessionCookie = sessionManager.createSession(session);
    return {
      sessionCookie,
      csrfToken,
      subject: tokens.subject,
      expiresAt: session.expiresAt,
    };
  }

  async function getSessionInfo(cookieValue: string | undefined): Promise<SessionInfo> {
    const session = sessionManager.readSession(cookieValue);
    if (!session) return { authenticated: false };
    const valid = await validateToken(session.accessToken, session.subjectRef);
    if (!valid) return { authenticated: false };
    return {
      authenticated: true,
      subject: session.subjectRef,
      name: session.profile.name,
      email: session.profile.email,
      picture: session.profile.picture,
      preferredUsername: session.profile.preferredUsername,
      expiresAt: session.expiresAt,
    };
  }

  async function refreshSession(cookieValue: string | undefined): Promise<string | undefined> {
    const session = sessionManager.readSession(cookieValue);
    if (!session) return undefined;
    if (!sessionManager.isTokenExpired(session)) {
      return sessionManager.rotateSession(cookieValue, () => {});
    }
    const provider = await discoverProviderConfig(fetcher);
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
      client_id: cfg.OIDC_CLIENT_ID ?? "",
    });
    const headers: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    };
    if (cfg.OIDC_CLIENT_SECRET) {
      headers.authorization = `Basic ${Buffer.from(`${cfg.OIDC_CLIENT_ID}:${cfg.OIDC_CLIENT_SECRET}`).toString("base64")}`;
    }
    let response: Response;
    try {
      response = await fetcher(provider.tokenEndpoint, {
        method: "POST",
        headers,
        body,
      });
    } catch {
      return undefined;
    }
    if (!response.ok) return undefined;
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return undefined;
    }
    const parsed = refreshTokenSchema.safeParse(payload);
    if (!parsed.success) return undefined;
    return sessionManager.rotateSession(cookieValue, (s) => {
      s.accessToken = parsed.data.access_token;
      if (parsed.data.refresh_token) s.refreshToken = parsed.data.refresh_token;
      if (parsed.data.id_token) s.idToken = parsed.data.id_token;
      s.tokenExpiresAt = Date.now() + parsed.data.expires_in * 1000;
    });
  }

  async function logout(cookieValue: string | undefined): Promise<string | undefined> {
    // Read the session before revoking locally so we can still reach the
    // provider revocation endpoint with its tokens.
    const session = sessionManager.readSession(cookieValue);
    const idTokenHint = session?.idToken || undefined;
    // Always invalidate the local application session first so the sealed
    // cookie can no longer authenticate, even if provider revocation fails.
    sessionManager.revoke(cookieValue);
    if (!session) return idTokenHint;
    const provider = await discoverProviderConfig(fetcher).catch(() => undefined);
    if (provider?.revocationEndpoint) {
      for (const [token, hint] of [
        [session.refreshToken, "refresh_token"],
        [session.accessToken, "access_token"],
      ] as const) {
        if (!token) continue;
        try {
          await fetcher(provider.revocationEndpoint, {
            method: "POST",
            headers: {
              authorization: `Basic ${Buffer.from(`${cfg.OIDC_CLIENT_ID}:${cfg.OIDC_CLIENT_SECRET}`).toString("base64")}`,
              "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ token, token_type_hint: hint }),
          });
        } catch {
          // Local cookie clearing still terminates the session.
        }
      }
    }
    return idTokenHint;
  }

  return {
    completeLogin,
    getSessionInfo,
    refreshSession,
    logout,
    createSealedSession,
    exchangeCodeForTokens,
    validateToken,
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  expires_in: z.number(),
});

const refreshTokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  expires_in: z.number(),
});

const userInfoSchema = z.object({
  sub: z.string(),
  name: z.string().optional(),
  email: z.string().optional(),
  picture: z.string().optional(),
  preferred_username: z.string().optional(),
  nickname: z.string().optional(),
});

function decodeIdToken(idToken: string): { sub?: string; name?: string; email?: string; picture?: string; preferred_username?: string; nickname?: string } | undefined {
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload && typeof payload === "object" ? payload : undefined;
  } catch {
    return undefined;
  }
}
