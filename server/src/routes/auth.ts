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
import { createPendingFlowStore, type PendingFlowStore } from "../auth/pendingFlowStore";
import type { AuthService } from "../auth/authService";
import { createAuthRateLimiter } from "../middleware/rateLimit";

export function createAuthRouter(options: {
  auth: AuthService;
  pendingFlowStore?: PendingFlowStore;
}): Router {
  const router = Router();
  const cfg = getConfig();
  const rateLimiter = createAuthRateLimiter();
  const pendingFlowStore = options.pendingFlowStore ?? createPendingFlowStore();

  router.get("/login", rateLimiter, async (_req, res) => {
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
    const flow = createPendingFlow();
    pendingFlowStore.put(flow);
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
    const flow = pendingFlowStore.take(state);
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
