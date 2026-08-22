# Lens Authentication

Lens uses corporate credentials through the company Identity Gateway. The UI
owns every screen but never collects, stores, or decides credentials or
permissions. All identity handling lives in the same-origin **Backend-for-
Frontend (BFF)** provided in `server/`.

## Architecture

```
Browser / Tauri webview            Lens BFF (server/)                 Corporate IdP
─────────────                      ─────────────────                 ────────────
User clicks "Sign in"
   └─ GET /auth/login ─────────────▶ builds OIDC authorize URL (PKCE S256)
                                   └───────────────────────────────▶ IdP login page
IdP redirects back
   └─ GET /auth/callback?code&state─▶ exchanges code + verifier for tokens
                                     sets Secure+HttpOnly session cookie
                                     sets non-HttpOnly CSRF cookie
GET /api/session (cookie) ─────────▶ decrypts session, introspects token
   ◀──────────────────────────────── { authenticated, profile… }  (no tokens)
POST /api/generate (cookie + CSRF) ▶ validates session + CSRF, calls model
   ◀──────────────────────────────── { output }
POST /auth/logout ────────────────▶ revokes provider tokens, clears cookies
```

### Security properties

- **No browser-visible credentials.** Access/refresh tokens, the PKCE
  verifier, CSRF tokens, and permission decisions live only inside the sealed
  `HttpOnly` session cookie and server memory. The browser never sees them.
- **Same-origin routing.** The BFF and app share an origin; the session
  cookie is scoped to that origin and never crosses origins. CORS is
  restricted to the approved Lens origin(s).
- **OIDC Authorization Code + PKCE (S256)** with `state`, `nonce`, PKCE
  `code_verifier`, redirect URI, issuer, and userinfo validation.
- **CSRF defense** on every state-changing `/api` request (double-submit of a
  per-session CSRF token bound to the sealed session).
- **Live authorization.** The backend resolves identity and introspects the
  access token on every protected request (`/api/session`, `/api/generate`).
  The frontend never authorizes.
- **Fail closed.** Missing identity configuration or a forbidden value makes
  production refuse to start.

## Directory layout

| Path | Purpose |
| --- | --- |
| `server/` | The BFF (Express + TypeScript). Start it, then run the app. |
| `server/src/config` | Env parsing + production fail-closed validation. |
| `server/src/auth` | OIDC client, session manager, pending-flow store. |
| `server/src/routes` | `/auth/*` and `/api/*` Express routers. |
| `server/src/middleware` | CORS narrowing, CSRF, rate limiting. |
| `server/tests` | Vitest coverage for the auth flows. |
| `src/shared/bff-auth/` | Frontend client, store, gate, sign-in + account UI. |
| `.env.example` | Documented, secret-free env template. |

---

## Local development (web)

> **Quick start.** The BFF and the Vite app are two processes. The 500 at
> `http://localhost:1420/auth/login` happens when the BFF is not running — the
> Vite proxy then has nothing to forward to.

1. **Create the BFF env** (first time)

   ```bash
   cp server/.env.example server/.env
   ```

2. **Start the BFF**

   ```bash
   cd server
   npm install
   npm run dev        # BFF on http://localhost:3001
   ```

   It loads `server/.env`. Verify it is up: `http://localhost:3001/health`
   returns `{"ok":true}`.

3. **Start the app** (from repo root, in another terminal)

   ```bash
   npm run dev        # Vite on http://localhost:1420
   ```

   Vite proxies `/auth` and `/api` to the BFF on port 3001, so the app and BFF
   look same-origin to the browser.

4. Sign in from the Lens sign-in screen.

> **No IdP configured?** `/auth/login` returns `503 DEPENDENCY_UNAVAILABLE`
> (graceful, not a crash) until the BFF has a reachable `OIDC_ISSUER`. Point
> the BFF at a local OIDC provider (e.g. a local Keycloak realm) or at your
> test gateway to complete a sign-in — see below.

> **Why both processes?** The BFF is the security boundary; it must run
> separately so the app code never holds the OIDC client secret.

---

## Local dev IdP (no corporate credentials needed)

For a fully working sign-in without a corporate IdP, the repo includes a
minimal local-only OIDC provider in `dev-idp/` (built on
[`oidc-provider`](https://www.npmjs.com/package/oidc-provider)). It is dev
infrastructure only — it is not part of Lens and must never ship.

1. **Install and start the IdP** (one-time install, then per-session start)

   ```bash
   cd dev-idp
   npm install        # first time
   npm start          # IdP on http://localhost:3005
   ```

   It serves discovery at `http://localhost:3005/.well-known/openid-configuration`.

2. **Point the BFF at it** (already set in `server/.env` for local dev)

   ```env
   OIDC_ISSUER=http://localhost:3005
   OIDC_CLIENT_ID=lens-bff
   OIDC_CLIENT_SECRET=dev-client-secret
   OIDC_REDIRECT_URI=http://localhost:3001/auth/callback
   OIDC_REQUIRE_HTTPS_ISSUER=false
   ```

   `OIDC_REQUIRE_HTTPS_ISSUER=false` is only to allow this plain-HTTP
   localhost IdP. It is **ignored in production**: `validateProductionConfig`
   always requires HTTPS there.

3. **Start the BFF and app** as above, then sign in. The dev IdP renders its
   own **Lens-styled** sign-in and consent pages (matching the app's dark UI,
   replacing oidc-provider's stock form), accepts any login/password, and
   grants consent with one click. The identity it returns is the seeded
   `devuser` account.

The dev client is **confidential** (`client_secret_basic`) so it exercises the
same token-exchange/introspection auth the production client uses.

> **Boolean env parsing.** Booleans in `server/.env` are parsed explicitly
> (`true`/`1` = true, everything else = false). Do not use `z.coerce.boolean()`
> here — it coerces the string `"false"` to `true`, which would silently
> re-enable fail-closed checks.

---

## Test gateway mode (no corporate IdP)

The legacy test/demo gateways remain available but are **explicitly isolated**
behind non-production configuration. `vite.config.ts` refuses to build any of
them into a production bundle, and the BFF refuses `OIDC_TEST_MODE=true` in
production.

- `VITE_LENS_LAB_GATEWAY_URL` + `VITE_LENS_LAB_GATEWAY_TOKEN` — the LAN test
  "lab" gateway (the old `src/shared/lab-gateway`).
- `VITE_LENS_SESSION_GATEWAY_URL` — the LAN test session gateway (the old
  `src/shared/identity-gateway`).
- `OIDC_TEST_MODE=true` on the **BFF** — an explicit opt-in test flag. Never
  set when `NODE_ENV=production`.

There is no local username/password store anywhere; even test mode routes
through a real external gateway.

---

## Production Identity Gateway configuration

The infrastructure team must provide the following **uninventable** values.
None are hard-coded; every one is read from the environment:

| Variable | Required | Notes |
| --- | --- | --- |
| `OIDC_ISSUER` | **yes** | Base issuer URL (Keycloak realm, EntraID tenant, etc.). The BFF appends `/.well-known/openid-configuration`. Must begin `https://`. |
| `OIDC_CLIENT_ID` | **yes** | Confidential (web) OIDC client registered for the Lens BFF. |
| `OIDC_CLIENT_SECRET` | **yes** | Secret for that client. Never expose to the frontend. |
| `OIDC_REDIRECT_URI` | **yes** | Registered redirect URI, same-origin callback. |
| `SESSION_SECRET` | **yes** | ≥32 bytes for the sealed cookie. `openssl rand -base64 48`. |
| `APP_ORIGIN` | **yes** | Approved https origin. Also the CORS allow-list default. |
| `OIDC_ALLOWED_ORIGINS` | optional | Comma-separated extra allowed origins. |
| `OIDC_ALLOWED_REDIRECT_HOSTS` | optional | Comma-separated approved callback hosts. |
| `OIDC_SCOPES` | optional | Default `openid profile email`. |

The IdP must expose OpenID Connect Discovery, token, userinfo,
introspection, and (recommended) revocation endpoints. Registration must:
- mark the client as **confidential** (client secret granted),
- allow the exact `OIDC_REDIRECT_URI`,
- return `sub` in userinfo, and
- permit server-side token introspection/revocation.

### Production checklist

- `NODE_ENV=production`
- All `OIDC_*` values and `SESSION_SECRET` set and HTTPS-only.
- `OIDC_TEST_MODE` absent/`false`, and no `VITE_LENS_LAB_*` /
  `VITE_LENS_SESSION_GATEWAY_URL` present (build fails otherwise).
- BFF served behind the app origin (reverse proxy) with plain HTTP on the
  loopback; the edge terminates TLS.

---

## Tauri desktop

The desktop webview never embeds the corporate login page. Instead:

1. The app points at the BFF via `VITE_LENS_BFF_URL` (usually
   `https://lens.app` or a loopback BFF).
2. Sign-in calls
   navigates the current Lens webview to `/auth/login`; the registered OIDC
   callback returns that same window to `APP_ORIGIN` after authentication.
3. The user authenticates in their OS browser. The BFF sets the session
   cookie for the BFF origin.
4. Returning to the webview, the app calls `/api/session` with
   `credentials: "include"` and resumes the authenticated session.

For a fully self-contained desktop install you can register a custom URL
scheme or loopback redirect (`http://127.0.0.1:PORT/auth/callback`) with the
IdP and handle it in the BFF; nothing embeds corporate login in the webview.

---

## Environment reference

See `.env.example` (repo root) for a secret-free template used by the BFF
(`server`). Copy it to `.env` and fill in real values.
```
```
