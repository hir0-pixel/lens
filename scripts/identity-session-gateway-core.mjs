import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_TTL_MS = 30 * 60 * 1000;
const PENDING_TTL_MS = 5 * 60 * 1000;
const MAX_PROMPT_LENGTH = 12_000;
const MAX_SESSION_COOKIE_LENGTH = 3_800;

function base64url(bytes) { return Buffer.from(bytes).toString("base64url"); }

export function createSealedSessionCodec(secret, random = randomBytes) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Invalid session cookie secret.");
  const key = createHash("sha256").update(secret).digest();
  return {
    seal(value) {
      const nonce = random(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      const sealed = base64url(Buffer.concat([nonce, cipher.getAuthTag(), encrypted]));
      if (sealed.length > MAX_SESSION_COOKIE_LENGTH) throw new Error("Session payload exceeds the cookie limit.");
      return sealed;
    },
    open(value) {
      try {
        if (typeof value !== "string" || value.length === 0 || value.length > 4096) return undefined;
        const payload = Buffer.from(value, "base64url");
        if (payload.length < 29) return undefined;
        const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(0, 12));
        decipher.setAuthTag(payload.subarray(12, 28));
        const decoded = JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8"));
        return decoded && typeof decoded === "object" ? decoded : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

export function validEdgeCredential(value, expected) {
  if (typeof value !== "string" || typeof expected !== "string" || expected.length < 32) return false;
  const actual = Buffer.from(value);
  const trusted = Buffer.from(expected);
  return actual.length === trusted.length && timingSafeEqual(actual, trusted);
}

export function requireInternalIssuer(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "identity.platform.internal" || !url.pathname.startsWith("/realms/") || url.search || url.hash) throw new Error("The identity issuer must be the internal HTTPS realm URL.");
  return url.toString().replace(/\/$/, "");
}

export function requireInternalModelBridge(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "edge" || url.port !== "8082" || url.pathname !== "/v1/lab/generate" || url.search || url.hash || url.username || url.password) {
    throw new Error("The model bridge must use the approved internal edge relay URL.");
  }
  return url.toString();
}

function requireLocalTestOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "localhost" || url.port !== "1420" || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash || url.username || url.password) {
    throw new Error("The allowed origin must be the local test application.");
  }
  return url.origin;
}

function requireInternalRedirect(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "lens-gateway.platform.internal" || url.port !== "8444" || url.pathname !== "/auth/callback" || url.search || url.hash || url.username || url.password) {
    throw new Error("The redirect URI must use the internal session gateway callback.");
  }
  return url.toString();
}

export function createIdentitySessionGateway(options) {
  const issuer = requireInternalIssuer(options.issuer);
  const modelBridgeUrl = requireInternalModelBridge(options.modelBridgeUrl);
  const allowedOrigin = requireLocalTestOrigin(options.allowedOrigin);
  const redirectUri = requireInternalRedirect(options.redirectUri);
  if (options.mode !== "internal-test-only" || !options.clientId || !options.clientSecret || options.clientSecret.length < 32 || !options.cookieSecret || options.cookieSecret.length < 32 || !options.edgeToken || options.edgeToken.length < 32 || !options.modelBridgeToken || options.modelBridgeToken.length < 32) throw new Error("Invalid identity session gateway configuration.");
  const now = options.now ?? (() => Date.now());
  const fetcher = options.fetcher ?? fetch;
  const random = options.random ?? ((size) => randomBytes(size));
  const codec = createSealedSessionCodec(options.cookieSecret, random);
  const pending = new Map();
  const newValue = (size = 32) => base64url(random(size));
  const cleanup = () => {
    const current = now();
    for (const [state, entry] of pending) if (entry.expiresAt <= current) pending.delete(state);
  };
  const clientAuthorization = `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`;
  const introspect = async (accessToken, subjectRef) => {
    try {
      const body = new URLSearchParams({ token: accessToken, token_type_hint: "access_token" });
      const response = await fetcher(`${issuer}/protocol/openid-connect/token/introspect`, { method: "POST", headers: { authorization: clientAuthorization, "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body });
      if (!response.ok) return false;
      const payload = await response.json();
      return payload?.active === true && payload?.sub === subjectRef;
    } catch {
      return false;
    }
  };
  const resolveSession = async (cookieValue) => {
    const value = codec.open(cookieValue);
    if (!value || value.version !== 1 || typeof value.subjectRef !== "string" || typeof value.csrfToken !== "string" || typeof value.accessToken !== "string" || typeof value.refreshToken !== "string" || typeof value.tokenExpiresAt !== "number" || typeof value.expiresAt !== "number" || value.expiresAt <= now()) return undefined;
    if (value.tokenExpiresAt > now() + 5_000 && await introspect(value.accessToken, value.subjectRef)) return { value, cookieValue };
    try {
      const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: value.refreshToken, client_id: options.clientId });
      const response = await fetcher(`${issuer}/protocol/openid-connect/token`, { method: "POST", headers: { authorization: clientAuthorization, "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body });
      if (!response.ok) return undefined;
      const payload = await response.json();
      if (typeof payload?.access_token !== "string" || typeof payload?.refresh_token !== "string" || typeof payload?.expires_in !== "number") return undefined;
      const refreshed = { ...value, accessToken: payload.access_token, refreshToken: payload.refresh_token, tokenExpiresAt: now() + payload.expires_in * 1000 };
      if (!await introspect(refreshed.accessToken, refreshed.subjectRef)) return undefined;
      return { value: refreshed, cookieValue: codec.seal(refreshed) };
    } catch {
      return undefined;
    }
  };
  const csrfMatches = (value, csrfToken) => {
    const actual = Buffer.from(csrfToken ?? "");
    const expected = Buffer.from(value?.csrfToken ?? "");
    return actual.length > 0 && actual.length === expected.length && timingSafeEqual(actual, expected);
  };

  return {
    beginLogin() {
      cleanup();
      const state = newValue();
      const verifier = newValue(48);
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const nonce = newValue();
      pending.set(state, { verifier, nonce, expiresAt: now() + PENDING_TTL_MS });
      const url = new URL(`${issuer}/protocol/openid-connect/auth`);
      url.search = new URLSearchParams({ client_id: options.clientId, response_type: "code", redirect_uri: redirectUri, scope: "openid", state, nonce, code_challenge: challenge, code_challenge_method: "S256" }).toString();
      return url.toString();
    },
    async finishLogin(input) {
      cleanup();
      const flow = pending.get(input.state);
      pending.delete(input.state);
      if (!flow || !input.code || input.code.length > 4096) throw new Error("LOGIN_INVALID");
      const body = new URLSearchParams({ grant_type: "authorization_code", code: input.code, redirect_uri: redirectUri, client_id: options.clientId, code_verifier: flow.verifier });
      const token = await fetcher(`${issuer}/protocol/openid-connect/token`, { method: "POST", headers: { authorization: clientAuthorization, "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body });
      if (!token.ok) throw new Error("LOGIN_INVALID");
      const tokenPayload = await token.json();
      if (typeof tokenPayload?.access_token !== "string" || typeof tokenPayload?.refresh_token !== "string" || typeof tokenPayload?.expires_in !== "number") throw new Error("LOGIN_INVALID");
      const profile = await fetcher(`${issuer}/protocol/openid-connect/userinfo`, { headers: { authorization: `Bearer ${tokenPayload.access_token}`, accept: "application/json" } });
      if (!profile.ok) throw new Error("LOGIN_INVALID");
      const identity = await profile.json();
      if (!identity?.sub || typeof identity.sub !== "string") throw new Error("LOGIN_INVALID");
      const csrfToken = newValue();
      const expiresAt = now() + SESSION_TTL_MS;
      const sessionId = codec.seal({ version: 1, subjectRef: identity.sub, csrfToken, accessToken: tokenPayload.access_token, refreshToken: tokenPayload.refresh_token, tokenExpiresAt: now() + tokenPayload.expires_in * 1000, expiresAt });
      return { sessionId, csrfToken, subjectRef: identity.sub, expiresAt };
    },
    async session(cookieValue, csrfToken) {
      const resolved = await resolveSession(cookieValue);
      if (!resolved || !csrfMatches(resolved.value, csrfToken)) return undefined;
      return { subjectRef: resolved.value.subjectRef, expiresAt: resolved.value.expiresAt, cookieValue: resolved.cookieValue };
    },
    async bootstrapSession(cookieValue) {
      const resolved = await resolveSession(cookieValue);
      return resolved ? { subjectRef: resolved.value.subjectRef, csrfToken: resolved.value.csrfToken, expiresAt: resolved.value.expiresAt, cookieValue: resolved.cookieValue } : undefined;
    },
    async generate(cookieValue, csrfToken, input, signal) {
      const resolved = await resolveSession(cookieValue);
      const value = resolved?.value;
      if (!value || !csrfMatches(value, csrfToken)) return { status: 401, body: { error: "UNAUTHENTICATED" } };
      if (!input || input.publicTest !== true || typeof input.prompt !== "string" || input.prompt.trim().length === 0 || input.prompt.length > MAX_PROMPT_LENGTH) {
        return { status: 400, body: { error: "INVALID_REQUEST" } };
      }
      try {
        const upstream = await fetcher(modelBridgeUrl, {
          method: "POST",
          headers: { authorization: `Bearer ${options.modelBridgeToken}`, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ publicTest: true, prompt: input.prompt }),
          signal,
        });
        if (!upstream.ok) return { status: 503, body: { error: "DEPENDENCY_UNAVAILABLE" } };
        const payload = await upstream.json();
        if (!payload || typeof payload.output !== "string" || payload.output.length > 1_000_000) return { status: 503, body: { error: "DEPENDENCY_UNAVAILABLE" } };
        return { status: 200, body: { output: payload.output }, cookieValue: resolved.cookieValue };
      } catch {
        return { status: 503, body: { error: "DEPENDENCY_UNAVAILABLE" } };
      }
    },
    async revoke(cookieValue) {
      const value = codec.open(cookieValue);
      if (!value) return;
      for (const [token, tokenType] of [[value.refreshToken, "refresh_token"], [value.accessToken, "access_token"]]) {
        if (typeof token !== "string") continue;
        try {
          const body = new URLSearchParams({ token, token_type_hint: tokenType });
          await fetcher(`${issuer}/protocol/openid-connect/revoke`, { method: "POST", headers: { authorization: clientAuthorization, "content-type": "application/x-www-form-urlencoded" }, body });
        } catch {
          // Clearing the browser cookie still terminates the local session.
        }
      }
    },
  };
}
