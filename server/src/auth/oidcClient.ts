import { z } from "zod";
import { getConfig } from "../config";
import { randomBase64Url, sha256Base64Url, timingSafeCompare } from "../utils/crypto";

export interface OIDCProviderConfig {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  revocationEndpoint: string;
  jwksEndpoint: string;
  introspectionEndpoint: string;
  endSessionEndpoint: string;
}

const discoverySchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  userinfo_endpoint: z.string().url().optional(),
  revocation_endpoint: z.string().url().optional(),
  jwks_uri: z.string().url(),
  introspection_endpoint: z.string().url().optional(),
  end_session_endpoint: z.string().url().optional(),
});

export class OIDCProviderError extends Error {}

let providerConfigCache: OIDCProviderConfig | null = null;
let providerConfigFetchedAt = 0;
const PROVIDER_CONFIG_TTL_MS = 15 * 60 * 1000;

export async function discoverProviderConfig(fetcher: typeof fetch = fetch): Promise<OIDCProviderConfig> {
  const cfg = getConfig();
  const issuer = cfg.OIDC_ISSUER;
  if (!issuer) throw new OIDCProviderError("OIDC_ISSUER is not configured");
  const now = Date.now();
  if (providerConfigCache && now - providerConfigFetchedAt < PROVIDER_CONFIG_TTL_MS) {
    return providerConfigCache;
  }
  const wellKnown = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  let response: Response;
  try {
    response = await fetcher(wellKnown, {
      headers: { accept: "application/json" },
    });
  } catch {
    throw new OIDCProviderError("Unable to reach the identity provider discovery endpoint");
  }
  if (!response.ok) {
    throw new OIDCProviderError(`Identity provider discovery failed with status ${response.status}`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new OIDCProviderError("Identity provider returned invalid discovery metadata");
  }
  const parsed = discoverySchema.safeParse(payload);
  if (!parsed.success) {
    throw new OIDCProviderError("Identity provider discovery metadata is invalid");
  }
  const discovered = parsed.data;
  const expectedIssuer = issuer.replace(/\/$/, "");
  if (discovered.issuer.replace(/\/$/, "") !== expectedIssuer) {
    throw new OIDCProviderError("Identity provider issuer mismatch");
  }
  if (cfg.OIDC_REQUIRE_HTTPS_ISSUER && !discovered.authorization_endpoint.startsWith("https://")) {
    throw new OIDCProviderError("Authorization endpoint must use HTTPS");
  }
  providerConfigCache = {
    issuer: discovered.issuer,
    authorizationEndpoint: discovered.authorization_endpoint,
    tokenEndpoint: discovered.token_endpoint,
    userinfoEndpoint: discovered.userinfo_endpoint ?? "",
    revocationEndpoint: discovered.revocation_endpoint ?? "",
    jwksEndpoint: discovered.jwks_uri,
    introspectionEndpoint: discovered.introspection_endpoint ?? "",
    endSessionEndpoint: discovered.end_session_endpoint ?? "",
  };
  providerConfigFetchedAt = now;
  return providerConfigCache;
}

export interface PendingFlow {
  verifier: string;
  nonce: string;
  state: string;
  expiresAt: number;
}

export interface LoginParams {
  codeChallenge: string;
  codeChallengeMethod: "S256";
  state: string;
  nonce: string;
}

export function buildAuthorizationUrl(params: LoginParams): string {
  const cfg = getConfig();
  const config = providerConfigCache;
  if (!config) throw new OIDCProviderError("Provider configuration not discovered");
  const url = new URL(config.authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: cfg.OIDC_CLIENT_ID ?? "",
    response_type: "code",
    redirect_uri: cfg.OIDC_REDIRECT_URI ?? "",
    scope: cfg.OIDC_SCOPES,
    state: params.state,
    nonce: params.nonce,
    code_challenge: params.codeChallenge,
    code_challenge_method: params.codeChallengeMethod,
  }).toString();
  return url.toString();
}

/**
 * Build an RP-initiated logout URL (OpenID Connect "Logout" 1.0, RP-Initiated).
 * The provider ends its own session and then redirects back to `postLogoutRedirect`.
 */
export function buildLogoutUrl(options: { postRedirect?: string; idTokenHint?: string }): string | undefined {
  const config = providerConfigCache;
  if (!config?.endSessionEndpoint) return undefined;
  const url = new URL(config.endSessionEndpoint);
  const params = new URLSearchParams();
  if (options.idTokenHint) params.set("id_token_hint", options.idTokenHint);
  if (options.postRedirect) params.set("post_logout_redirect_uri", options.postRedirect);
  const qs = params.toString();
  url.search = qs ? `?${qs}` : "";
  return url.toString();
}

export function createPendingFlow(): PendingFlow {
  const cfg = getConfig();
  const verifier = randomBase64Url(cfg.OIDC_PKCE_VERIFIER_LENGTH);
  const nonce = randomBase64Url(cfg.OIDC_NONCE_LENGTH);
  const state = randomBase64Url(cfg.OIDC_STATE_LENGTH);
  return {
    verifier,
    nonce,
    state,
    expiresAt: Date.now() + cfg.OIDC_PENDING_TTL_MS,
  };
}

export function buildCodeChallenge(verifier: string): string {
  return sha256Base64Url(verifier);
}

export function validateOidcCallbackParams(params: {
  state?: string;
  code?: string;
  error?: string;
  errorDescription?: string;
}, pendingFlow: PendingFlow | undefined): void {
  if (params.error) {
    throw new OIDCProviderError(`Identity provider returned error: ${params.error}`);
  }
  if (!pendingFlow) {
    throw new OIDCProviderError("OIDC state does not match a pending login");
  }
  if (!params.state || !timingSafeCompare(params.state, pendingFlow.state)) {
    throw new OIDCProviderError("OIDC state mismatch");
  }
  if (!params.code || params.code.length > 4096) {
    throw new OIDCProviderError("Missing or invalid authorization code");
  }
}
