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
    const fixedBinding = cfg.OIDC_FIXED_BROWSER_BINDING;
    if (pendingFlowStore) {
      pendingFlowStore.put(created);
    } else {
      const existingBinding = req.cookies?.[cfg.OIDC_BROWSER_BINDING_COOKIE_NAME];
      const browserBinding = fixedBinding
        ?? (typeof existingBinding === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(existingBinding)
          ? existingBinding
          : randomBase64Url(32));
      flow = statelessFlow.seal(created, browserBinding);
      if (!fixedBinding) {
        res.cookie(cfg.OIDC_BROWSER_BINDING_COOKIE_NAME, browserBinding, {
          httpOnly: true,
          secure: cfg.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: cfg.OIDC_PENDING_TTL_MS,
          path: "/",
        });
      }
    }
    const url = buildAuthorizationUrl({
      codeChallenge: buildCodeChallenge(flow.verifier),
      codeChallengeMethod: "S256",
      state: flow.state,
      nonce: flow.nonce,
    });
    if (String(req.headers["x-lens-login"] ?? "") === "1") {
      res.status(200).json({ authorizationUrl: url });
      return;
    }
    res.redirect(302, url);
  });

  router.get("/callback", rateLimiter, async (req, res) => {
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const binding = cfg.OIDC_FIXED_BROWSER_BINDING
      ?? req.cookies?.[cfg.OIDC_BROWSER_BINDING_COOKIE_NAME];
    const flow = pendingFlowStore
      ? pendingFlowStore.take(state)
      : statelessFlow.open(state, binding);
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
      const targetOrigin = (() => {
        if (cfg.NODE_ENV !== "production") {
          const host = (req.headers["x-forwarded-host"] ?? req.headers.host) as string | undefined;
          const proto = (req.headers["x-forwarded-proto"] ?? req.protocol ?? "http") as string;
          if (typeof host === "string" && host.trim()) {
            const candidate = `${proto}://${host.trim()}`.replace(/\/$/, "");
            if (
              candidate === "http://127.0.0.1:1420" ||
              candidate === "http://localhost:1420"
            ) {
              return candidate;
            }
          }
        }
        return cfg.APP_ORIGIN.replace(/\/$/, "");
      })();
      res.redirect(302, `${targetOrigin}/`);
    } catch (error) {
      const hasBinding = Boolean(binding);
      console.error(
        "[auth/callback] login completion failed:",
        error instanceof Error ? error.message : error,
        { hasBinding, hasState: Boolean(state), hasCode: Boolean(code), hasFlow: Boolean(flow), fixedBinding: Boolean(cfg.OIDC_FIXED_BROWSER_BINDING) },
      );
      const targetOrigin = (() => {
        if (cfg.NODE_ENV !== "production") {
          const host = (req.headers["x-forwarded-host"] ?? req.headers.host) as string | undefined;
          const proto = (req.headers["x-forwarded-proto"] ?? req.protocol ?? "http") as string;
          if (typeof host === "string" && host.trim()) {
            const candidate = `${proto}://${host.trim()}`.replace(/\/$/, "");
            if (
              candidate === "http://127.0.0.1:1420" ||
              candidate === "http://localhost:1420"
            ) {
              return candidate;
            }
          }
        }
        return cfg.APP_ORIGIN.replace(/\/$/, "");
      })();
      if (error instanceof OIDCProviderError) {
        res.status(302).redirect(`${targetOrigin}/?auth=error`);
        return;
      }
      res.status(302).redirect(`${targetOrigin}/?auth=error`);
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
