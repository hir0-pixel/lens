import { z } from "zod";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from "jose";
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

export interface TrustedSessionInfo {
  authenticated: boolean;
  subject?: string;
  sessionRef?: string;
  deviceRef?: string;
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
  let jwks: ReturnType<typeof createLocalJWKSet> | undefined;
  let jwksFetchedAt = 0;

  async function verifiedIdToken(idToken: string, expectedNonce: string): Promise<JWTPayload> {
    const provider = await discoverProviderConfig(fetcher);
    if (!idToken || !expectedNonce || !cfg.OIDC_CLIENT_ID) throw new AuthServiceError("ID token verification inputs are missing");
    if (!jwks || Date.now() - jwksFetchedAt >= 15 * 60 * 1000) {
      let response: Response;
      try {
        response = await fetcher(provider.jwksEndpoint, { headers: { accept: "application/json" } });
      } catch {
        throw new AuthServiceError("Unable to reach the identity signing-key endpoint");
      }
      if (!response.ok) throw new AuthServiceError("Identity signing-key request was rejected");
      const contentLength = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(contentLength) && contentLength > 256 * 1024) throw new AuthServiceError("Identity signing-key response is too large");
      let keySet: unknown;
      try {
        keySet = await response.json();
      } catch {
        throw new AuthServiceError("Identity signing-key response is invalid");
      }
      const parsed = jwksSchema.safeParse(keySet);
      if (!parsed.success) throw new AuthServiceError("Identity signing-key response is invalid");
      jwks = createLocalJWKSet(parsed.data as JSONWebKeySet);
      jwksFetchedAt = Date.now();
    }
    try {
      const verified = await jwtVerify(idToken, jwks, {
        issuer: provider.issuer,
        audience: cfg.OIDC_CLIENT_ID,
        algorithms: ["RS256", "PS256", "ES256"],
      });
      if (verified.payload.nonce !== expectedNonce || typeof verified.payload.sub !== "string" || !verified.payload.sub) {
        throw new AuthServiceError("ID token nonce or subject is invalid");
      }
      return verified.payload;
    } catch (error) {
      if (error instanceof AuthServiceError) throw error;
      throw new AuthServiceError("ID token verification failed");
    }
  }

  async function exchangeCodeForTokens(code: string, verifier: string, expectedNonce: string): Promise<ExchangeTokenResult> {
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

    if (!idToken) throw new AuthServiceError("OIDC token response is missing an ID token");
    const claims = await verifiedIdToken(idToken, expectedNonce);
    const subject = claims.sub as string;
    const profile: ExchangeTokenResult["profile"] = {
      name: typeof claims.name === "string" ? claims.name : undefined,
      email: typeof claims.email === "string" ? claims.email : undefined,
      picture: typeof claims.picture === "string" ? claims.picture : undefined,
      preferredUsername: typeof claims.preferred_username === "string"
        ? claims.preferred_username
        : typeof claims.nickname === "string" ? claims.nickname : undefined,
    };

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
      try {
        const user = await fetchUserInfo(token);
        return !expectedSubject || user.sub === expectedSubject;
      } catch {
        return false;
      }
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
    const tokens = await exchangeCodeForTokens(code ?? "", pendingFlow.verifier, pendingFlow.nonce);
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

  async function getTrustedSession(cookieValue: string | undefined): Promise<TrustedSessionInfo> {
    const session = sessionManager.readSession(cookieValue);
    if (!session) return { authenticated: false };
    const valid = await validateToken(session.accessToken, session.subjectRef);
    if (!valid) return { authenticated: false };
    return {
      authenticated: true,
      subject: session.subjectRef,
      sessionRef: `session:${session.sid}`,
      deviceRef: `device:${session.sid}`,
      expiresAt: session.expiresAt,
    };
  }

  function getRateLimitPrincipal(cookieValue: string | undefined): string | undefined {
    const session = sessionManager.readSession(cookieValue);
    return session ? `session:${session.sid}` : undefined;
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
    getTrustedSession,
    getRateLimitPrincipal,
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

const jwksSchema = z.object({
  keys: z.array(z.record(z.unknown())).min(1).max(32),
});
