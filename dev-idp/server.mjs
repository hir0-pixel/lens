import Provider from "oidc-provider";

const ISSUER = process.env.LENS_DEV_IDP_ISSUER ?? "http://127.0.0.1:3005";
const PORT = Number(process.env.LENS_DEV_IDP_PORT ?? 3005);
const APP_ORIGIN = process.env.LENS_APP_ORIGIN ?? "http://127.0.0.1:1420";

const devAccount = {
  sub: "dev-user-1",
  email: "dev@lens.local",
  email_verified: true,
  name: "Lens Dev User",
  preferred_username: "devuser",
};

const clients = [
  {
    client_id: "lens-bff",
    client_secret: "dev-client-secret",
    // App origin hosts /auth/* via the Vite proxy in desktop/dev.
    redirect_uris: [`${APP_ORIGIN.replace(/\/$/, "")}/auth/callback`],
    post_logout_redirect_uris: [APP_ORIGIN.replace(/\/$/, "")],
    token_endpoint_auth_method: "client_secret_basic",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    id_token_signed_response_alg: "RS256",
  },
];

const configuration = {
  clients,
  pkce: { required: () => true },
  ttl: { AccessToken: 3600, RefreshToken: 14 * 24 * 3600, IdToken: 3600 },
  cookies: { keys: ["lens-dev-idp-cookie-secret-only-for-localhost"] },
  claims: {
    openid: ["sub"],
    email: ["email", "email_verified"],
    profile: ["name", "preferred_username"],
  },
  // Skip the Authorize consent screen in local dev — after login, issue a
  // grant for the requested scopes so Continue cannot loop forever.
  async loadExistingGrant(ctx) {
    const clientId = ctx.oidc.client.clientId;
    const accountId = ctx.oidc.session?.accountId;
    if (!accountId) return undefined;
    const existingId = ctx.oidc.session.grantIdFor(clientId);
    if (existingId) {
      const existing = await provider.Grant.find(existingId);
      if (existing && !existing.isExpired) return existing;
    }
    const grant = new provider.Grant({ clientId, accountId });
    if (ctx.oidc.params?.scope) grant.addOIDCScope(String(ctx.oidc.params.scope));
    await grant.save();
    return grant;
  },
  features: {
    devInteractions: { enabled: false },
    rpInitiatedLogout: {
      enabled: true,
      // Auto-submit the logout confirmation so single logout is one step
      // (no manual "are you sure?" click) — dev convenience only.
      logoutSource: async (_ctx, formHtml) => {
        _ctx.body = `<!DOCTYPE html><html><body><script>document.addEventListener('DOMContentLoaded', function () { document.getElementById('op.logoutForm').submit(); });</script>${formHtml}</body></html>`;
      },
    },
    introspection: { enabled: true },
    revocation: { enabled: true },
    userinfo: { enabled: true },
  },
  async findAccount(_ctx, _sub) {
    return {
      accountId: devAccount.sub,
      async claims() {
        return { ...devAccount };
      },
    };
  },
};

const provider = new Provider(ISSUER, configuration);
provider.on("server_error", (_ctx, err) => {
  // eslint-disable-next-line no-console
  console.error("oidc-provider error:", err?.message ?? err);
});

// ---------------------------------------------------------------------------
// Custom Lens-styled interaction pages (replaces devInteractions).
// Dev-only. Accepts any login/password; grants consent with one click.
// ---------------------------------------------------------------------------

const STYLE = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: flex; align-items: center;
  justify-content: center; padding: 24px; background: #f7f7f4;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  background-image:
    radial-gradient(ellipse 70% 50% at 50% 0%, color-mix(in srgb, #f54e00 12%, transparent), transparent 60%);
}
.card {
  width: 100%; max-width: 400px; background: #ffffff;
  border: 1px solid #e6e5e0; border-radius: 14px;
  padding: 32px 28px; box-shadow: none;
}
.logo {
  display: flex; align-items: center; gap: 10px; margin-bottom: 26px;
  font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: #26251e;
}
.logo .dot {
  width: 16px; height: 16px; border-radius: 50%;
  background: #f54e00;
}
.icon {
  display: flex; align-items: center; justify-content: center; font-weight: 700;
  width: 48px; height: 48px; border-radius: 12px; margin-bottom: 20px;
  background: #e6e5e0; color: #f54e00; font-size: 22px;
}
h1 { margin: 0 0 8px; font-size: 20px; font-weight: 600; color: #26251e; }
.sub { margin: 0 0 20px; font-size: 13px; line-height: 1.5; color: #5a5852; }
label { display: block; font-size: 12px; margin: 14px 0 6px; color: #5a5852; }
input {
  width: 100%; height: 44px; padding: 0 12px; font-size: 14px; color: #26251e;
  background: #ffffff; border: 1px solid #e6e5e0; border-radius: 10px; outline: none;
}
input:focus { border-color: #f54e00; box-shadow: none; }
button {
  width: 100%; height: 44px; margin-top: 22px; font-size: 14px; font-weight: 600;
  border: 0; border-radius: 10px; cursor: pointer;
  background: #f54e00;
  color: #ffffff;
}
button:hover { filter: brightness(1.08); }
.scopes { display: flex; flex-wrap: wrap; gap: 8px; margin: 2px 0 20px; }
.scope {
  font-size: 12px; padding: 5px 10px; border-radius: 999px; color: #26251e;
  border: 1px solid #e6e5e0; background: #fafaf7;
}
.hint { margin-top: 16px; font-size: 11px; color: #807d72; }
a.cancel {
  display: block; margin-top: 12px; text-align: center; font-size: 12px;
  color: #807d72; text-decoration: none;
}
a.cancel:hover { color: #5a5852; }
`;

function page({ title, sub, icon, body }) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lens · ${title}</title><style>${STYLE}</style>
</head><body>
<div class="card">
  <div class="logo"><span class="dot"></span>Lens</div>
  <div class="icon">${icon}</div>
  <h1>${title}</h1>
  <p class="sub">${sub}</p>
  ${body}
</div>
</body></html>`;
}

const loginPage = (action, loginHint) => page({
  icon: "&lt;/&gt;",
  title: "Sign in to Lens",
  sub: "Enter any login and password — this is a local dev identity provider.",
  body: `<form method="post" action="${action}">
    <label for="login">Username</label>
    <input id="login" name="login" autocomplete="username"
           ${loginHint ? `value="${loginHint}"` : "autofocus"} required>
    <label for="password">Password</label>
    <input id="password" name="password" type="password"
           ${loginHint ? "autofocus" : ""} autocomplete="current-password" required>
    <button type="submit">Sign in</button>
  </form>
  <p class="hint">Dev-only provider in dev-idp/. Not part of Lens; never ship it.</p>`,
});

const consentPage = (action, scopes) => page({
  icon: "&#10003;",
  title: "Authorize Lens",
  sub: "Lens wants to access the following from your account.",
  body: `<form id="consent" method="post" action="${action}">
    <div class="scopes">${scopes.map(s => `<span class="scope">${s}</span>`).join("")}</div>
    <button type="submit">Continue</button>
  </form>
  <a class="cancel" href="${action}?cancel=1">Cancel</a>
  <script>document.getElementById('consent').submit();</script>`,
});

function readBody(ctx) {
  return new Promise((resolve, reject) => {
    let data = "";
    ctx.req.setEncoding("utf8");
    ctx.req.on("data", (c) => { data += c; });
    ctx.req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(data))));
    ctx.req.on("error", reject);
  });
}

// Handle /interaction/:uid ourselves; everything else via oidc-provider.
provider.use(async (ctx, next) => {
  const match = ctx.path.match(/^\/interaction\/([A-Za-z0-9_-]+)/);
  if (!match) return next();
  const act = ctx.path;
  try {
    const details = await provider.interactionDetails(ctx.req, ctx.res);
    const { prompt, params, grantId, session } = details;

    if (ctx.method === "GET") {
      ctx.type = "html";
      if (prompt.name === "login") {
        ctx.body = loginPage(act, params?.login_hint);
      } else if (prompt.name === "consent") {
        const scopes = String(params?.scope ?? "").split(" ").filter(s => s && s !== "openid");
        ctx.body = consentPage(act, scopes);
      }
      return;
    }

    if (ctx.method === "POST") {
      if (prompt.name === "login") {
        const body = await readBody(ctx);
        const login = String(body.login ?? "").trim();
        if (!login) { ctx.status = 422; return; }
        await provider.interactionFinished(ctx.req, ctx.res, { login: { accountId: devAccount.sub } }, { mergeWithLastSubmission: false });
        return;
      }
      if (prompt.name === "consent") {
        if (ctx.query.cancel) {
          await provider.interactionFinished(ctx.req, ctx.res, { error: "access_denied" }, { mergeWithLastSubmission: false });
          return;
        }
        let grant;
        if (grantId) grant = await provider.Grant.find(grantId);
        else grant = new provider.Grant({ accountId: session.accountId, clientId: params.client_id });
        const missing = details.prompt?.details?.missingOIDCScope;
        if (missing?.length) grant.addOIDCScope(missing.join(" "));
        else if (params?.scope) grant.addOIDCScope(String(params.scope));
        const savedId = await grant.save();
        await provider.interactionFinished(ctx.req, ctx.res, { consent: { grantId: savedId } }, { mergeWithLastSubmission: false });
        return;
      }
    }
  } catch (err) {
    console.error("dev-idp interaction error:", err?.message ?? err);
    // Interaction UIDs are one-use, in-memory records. If the dev provider is
    // restarted while Lens is on an interaction URL, return to the app so the
    // user can begin a fresh flow instead of trapping the webview on a 500.
    ctx.status = 302;
    ctx.redirect(`${APP_ORIGIN}/?auth=restart`);
    return;
  }
  return next();
});

const listenHost = process.env.LENS_DEV_IDP_HOST ?? "127.0.0.1";
provider.listen(PORT, listenHost, () => {
  // eslint-disable-next-line no-console
  console.log(`Lens dev IdP listening on ${ISSUER}`);
});
