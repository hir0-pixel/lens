import Provider from "oidc-provider";

const ISSUER = process.env.LENS_DEV_IDP_ISSUER ?? "http://localhost:3005";
const PORT = Number(process.env.LENS_DEV_IDP_PORT ?? 3005);
const APP_ORIGIN = process.env.LENS_APP_ORIGIN ?? "http://localhost:1420";

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
    redirect_uris: ["http://localhost:3001/auth/callback"],
    post_logout_redirect_uris: ["http://localhost:1420"],
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
  async findAccount(_ctx, sub) {
    // The dev interaction form accepts any login, so the submitted accountId is
    // the sub. Map it back to the seeded dev identity for stable claims.
    return {
      accountId: sub,
      async claims(use, scope, claims, rejected) {
        return { ...devAccount, sub };
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
  justify-content: center; padding: 24px; background: hsl(240, 10%, 7%);
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  background-image:
    radial-gradient(ellipse 70% 50% at 50% 0%, hsl(262 70% 45% / 0.12), transparent 60%);
}
.card {
  width: 100%; max-width: 400px; background: hsl(240, 9%, 12%);
  border: 1px solid hsl(240, 8%, 17%); border-radius: 14px;
  padding: 32px 28px; box-shadow: 0 18px 50px -20px rgba(0,0,0,0.6);
}
.logo {
  display: flex; align-items: center; gap: 10px; margin-bottom: 26px;
  font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: hsl(240, 10%, 96%);
}
.logo .dot {
  width: 16px; height: 16px; border-radius: 50%;
  background: linear-gradient(135deg, hsl(266,85%,65%) 0%, hsl(291,80%,62%) 50%, hsl(330,80%,62%) 100%);
}
.icon {
  display: flex; align-items: center; justify-content: center; font-weight: 700;
  width: 48px; height: 48px; border-radius: 12px; margin-bottom: 20px;
  background: hsl(255, 55%, 20%); color: hsl(266, 85%, 65%); font-size: 22px;
}
h1 { margin: 0 0 8px; font-size: 20px; font-weight: 600; color: hsl(240, 10%, 96%); }
.sub { margin: 0 0 20px; font-size: 13px; line-height: 1.5; color: hsl(240, 6%, 70%); }
label { display: block; font-size: 12px; margin: 14px 0 6px; color: hsl(240, 6%, 70%); }
input {
  width: 100%; height: 44px; padding: 0 12px; font-size: 14px; color: hsl(240, 10%, 96%);
  background: hsl(240, 8%, 13%); border: 1px solid hsl(240, 8%, 23%); border-radius: 10px; outline: none;
}
input:focus { border-color: hsl(255, 85%, 65%); box-shadow: 0 0 0 3px hsl(255 85% 65% / 0.15); }
button {
  width: 100%; height: 44px; margin-top: 22px; font-size: 14px; font-weight: 600;
  border: 0; border-radius: 10px; cursor: pointer;
  background: linear-gradient(135deg, hsl(266,85%,65%) 0%, hsl(291,80%,62%) 50%, hsl(330,80%,62%) 100%);
  color: hsl(240, 10%, 8%);
}
button:hover { filter: brightness(1.08); }
.scopes { display: flex; flex-wrap: wrap; gap: 8px; margin: 2px 0 20px; }
.scope {
  font-size: 12px; padding: 5px 10px; border-radius: 999px; color: hsl(240, 10%, 96%);
  border: 1px solid hsl(240, 8%, 23%); background: hsl(240, 8%, 13%);
}
.hint { margin-top: 16px; font-size: 11px; color: hsl(240, 6%, 50%); }
a.cancel {
  display: block; margin-top: 12px; text-align: center; font-size: 12px;
  color: hsl(240, 6%, 50%); text-decoration: none;
}
a.cancel:hover { color: hsl(240, 6%, 70%); }
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
  body: `<form method="post" action="${action}">
    <div class="scopes">${scopes.map(s => `<span class="scope">${s}</span>`).join("")}</div>
    <button type="submit">Continue</button>
  </form>
  <a class="cancel" href="${action}?cancel=1">Cancel</a>`,
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
        await provider.interactionFinished(ctx.req, ctx.res, { login: { accountId: login } }, { mergeWithLastSubmission: false });
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

provider.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Lens dev IdP listening on ${ISSUER}`);
});
