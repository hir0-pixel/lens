import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_TTL_MS = 30 * 60 * 1000;
const PENDING_TTL_MS = 5 * 60 * 1000;
const MAX_PROMPT_LENGTH = 12_000;

function base64url(bytes) { return Buffer.from(bytes).toString("base64url"); }

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
  if (options.mode !== "internal-test-only" || !options.clientId || !options.clientSecret || options.clientSecret.length < 32 || !options.edgeToken || options.edgeToken.length < 32 || !options.modelBridgeToken || options.modelBridgeToken.length < 32) throw new Error("Invalid identity session gateway configuration.");
  const now = options.now ?? (() => Date.now());
  const fetcher = options.fetcher ?? fetch;
  const random = options.random ?? ((size) => randomBytes(size));
  const pending = new Map();
  const sessions = new Map();
  const newValue = (size = 32) => base64url(random(size));
  const cleanup = () => {
    const current = now();
    for (const [state, entry] of pending) if (entry.expiresAt <= current) pending.delete(state);
    for (const [id, entry] of sessions) if (entry.expiresAt <= current) sessions.delete(id);
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
      const token = await fetcher(`${issuer}/protocol/openid-connect/token`, { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body });
      if (!token.ok) throw new Error("LOGIN_INVALID");
      const tokenPayload = await token.json();
      if (!tokenPayload?.access_token || typeof tokenPayload.access_token !== "string") throw new Error("LOGIN_INVALID");
      const profile = await fetcher(`${issuer}/protocol/openid-connect/userinfo`, { headers: { authorization: `Bearer ${tokenPayload.access_token}`, accept: "application/json" } });
      if (!profile.ok) throw new Error("LOGIN_INVALID");
      const identity = await profile.json();
      if (!identity?.sub || typeof identity.sub !== "string") throw new Error("LOGIN_INVALID");
      const sessionId = newValue();
      const csrfToken = newValue();
      const expiresAt = now() + SESSION_TTL_MS;
      sessions.set(sessionId, { subjectRef: identity.sub, csrfToken, expiresAt });
      return { sessionId, csrfToken, subjectRef: identity.sub, expiresAt };
    },
    session(cookieValue, csrfToken) {
      cleanup();
      const value = sessions.get(cookieValue ?? "");
      if (!value || !csrfToken) return undefined;
      const actual = Buffer.from(csrfToken);
      const expected = Buffer.from(value.csrfToken);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
      return { subjectRef: value.subjectRef, expiresAt: value.expiresAt };
    },
    bootstrapSession(cookieValue) {
      cleanup();
      const value = sessions.get(cookieValue ?? "");
      return value ? { subjectRef: value.subjectRef, csrfToken: value.csrfToken, expiresAt: value.expiresAt } : undefined;
    },
    async generate(cookieValue, csrfToken, input, signal) {
      cleanup();
      const value = sessions.get(cookieValue ?? "");
      const actual = Buffer.from(csrfToken ?? "");
      const expected = Buffer.from(value?.csrfToken ?? "");
      if (!value || actual.length === 0 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { status: 401, body: { error: "UNAUTHENTICATED" } };
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
        return { status: 200, body: { output: payload.output } };
      } catch {
        return { status: 503, body: { error: "DEPENDENCY_UNAVAILABLE" } };
      }
    },
    revoke(cookieValue) { if (cookieValue) sessions.delete(cookieValue); },
  };
}
