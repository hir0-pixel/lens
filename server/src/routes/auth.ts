import { Router } from "express";
import { getConfig } from "../config";
import {
  createPendingFlow,
  buildCodeChallenge,
  buildAuthorizationUrl,
  buildLogoutUrl,
  discoverProviderConfig,
  OIDCProviderError,
} from "../auth/oidcClient";
import type { PendingFlowStore } from "../auth/pendingFlowStore";
import { createStatelessPendingFlowCodec } from "../auth/statelessPendingFlow";
import type { AuthService } from "../auth/authService";
import { createAuthRateLimiter } from "../middleware/rateLimit";
import { randomBase64Url } from "../utils/crypto";

export function createAuthRouter(options: {
  auth: AuthService;
  pendingFlowStore?: PendingFlowStore;
}): Router {
  const router = Router();
  const cfg = getConfig();
  const rateLimiter = createAuthRateLimiter();
  const pendingFlowStore = options.pendingFlowStore;
  const statelessFlow = createStatelessPendingFlowCodec(cfg.SESSION_SECRET);

  router.get("/login", rateLimiter, async (req, res) => {
    try {
      await discoverProviderConfig();
    } catch (error) {
      if (error instanceof OIDCProviderError) {
        res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
        return;
      }
      res.status(500).json({ error: "INTERNAL_ERROR" });
      return;
    }
    const created = createPendingFlow();
    let flow = created;
    if (pendingFlowStore) {
      pendingFlowStore.put(created);
    } else {
      const existingBinding = req.cookies?.[cfg.OIDC_BROWSER_BINDING_COOKIE_NAME];
      const browserBinding = typeof existingBinding === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(existingBinding)
        ? existingBinding
        : randomBase64Url(32);
      flow = statelessFlow.seal(created, browserBinding);
      res.cookie(cfg.OIDC_BROWSER_BINDING_COOKIE_NAME, browserBinding, {
        httpOnly: true,
        secure: cfg.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: cfg.OIDC_PENDING_TTL_MS,
        path: "/auth",
      });
    }
    const url = buildAuthorizationUrl({
      codeChallenge: buildCodeChallenge(flow.verifier),
      codeChallengeMethod: "S256",
      state: flow.state,
      nonce: flow.nonce,
    });
    res.redirect(302, url);
  });

  router.get("/callback", rateLimiter, async (req, res) => {
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const flow = pendingFlowStore
      ? pendingFlowStore.take(state)
      : statelessFlow.open(state, req.cookies?.[cfg.OIDC_BROWSER_BINDING_COOKIE_NAME]);
    try {
      await discoverProviderConfig();
      const result = await options.auth.completeLogin(state, code, flow);
      res.cookie(cfg.SESSION_COOKIE_NAME, result.sessionCookie, {
        httpOnly: true,
        secure: cfg.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: cfg.SESSION_TTL_MS,
        path: "/",
      });
      res.cookie(cfg.CSRF_COOKIE_NAME, result.csrfToken, {
        httpOnly: false,
        secure: cfg.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: cfg.SESSION_TTL_MS,
        path: "/",
      });
      res.redirect(302, `${cfg.APP_ORIGIN}/`);
    } catch (error) {
      if (error instanceof OIDCProviderError) {
        res.status(302).redirect(`${cfg.APP_ORIGIN}/?auth=error`);
        return;
      }
      res.status(302).redirect(`${cfg.APP_ORIGIN}/?auth=error`);
    }
  });

  router.post("/logout", rateLimiter, async (req, res) => {
    const cookieValue = req.cookies?.[cfg.SESSION_COOKIE_NAME];
    const idTokenHint = await options.auth.logout(cookieValue);
    res.clearCookie(cfg.SESSION_COOKIE_NAME, {
      path: "/",
      httpOnly: true,
      secure: cfg.NODE_ENV === "production",
      sameSite: "lax",
    });
    res.clearCookie(cfg.CSRF_COOKIE_NAME, {
      path: "/",
      httpOnly: false,
      secure: cfg.NODE_ENV === "production",
      sameSite: "lax",
    });
    // If the IdP advertises RP-Initiated Logout, return the end-session URL so
    // the client can navigate the browser there and end the IdP session (full
    // single logout). Without it we fall back to local-only logout.
    let logoutUrl: string | undefined;
    try {
      await discoverProviderConfig();
      logoutUrl = buildLogoutUrl({
        idTokenHint,
        postRedirect: cfg.APP_ORIGIN,
      });
    } catch {
      logoutUrl = undefined;
    }
    res.status(200).json({ ok: true, logoutUrl: logoutUrl ?? null });
  });

  return router;
}
