/**
 * Debug: OIDC login + /api/session (no secrets printed).
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const env = {};
for (const line of readFileSync(resolve(root, "server/.env"), "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  env[t.slice(0, eq)] = t.slice(eq + 1);
}

class CookieJar {
  #cookies = new Map();
  ingest(response) {
    const raw = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
    for (const line of raw) {
      const part = String(line).split(";")[0];
      const eq = part.indexOf("=");
      if (eq > 0) this.#cookies.set(part.slice(0, eq), part.slice(eq + 1));
    }
  }
  header() {
    return [...this.#cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  get(name) {
    return this.#cookies.get(name);
  }
}

const bffUrl = env.BFF_URL ?? "http://127.0.0.1:3001";
const jar = new CookieJar();

async function step(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    headers: { ...(init.headers ?? {}), ...(jar.header() ? { cookie: jar.header() } : {}) },
  });
  jar.ingest(response);
  return response;
}

let response = await step(`${bffUrl}/auth/login`);
for (let hops = 0; hops < 12; hops++) {
  if (response.status < 300 || response.status >= 400) break;
  const location = response.headers.get("location");
  if (!location) break;
  const next = new URL(location, response.url).toString();
  if (next.includes("/interaction/")) {
    response = await step(next, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "login=devuser&password=dev",
    });
    continue;
  }
  response = await step(next);
}

const sessionRes = await fetch(`${bffUrl}/api/session`, {
  headers: { accept: "application/json", cookie: jar.header() },
});
const session = await sessionRes.json();
console.log("session:", JSON.stringify(session, null, 2));
console.log("ADMIN_SUBJECTS in file:", (env.ADMIN_SUBJECTS ?? "").split(",").map((s) => s.trim()));

// Decode access token sub via IdP userinfo (dev only diagnostic).
const sessionCookieName = env.SESSION_COOKIE_NAME ?? "lens_session";
const sessionRaw = jar.get(sessionCookieName);
if (sessionRaw) {
  try {
    const { createSealedSessionCodec } = await import("../../server/src/utils/crypto.ts");
    const codec = createSealedSessionCodec(env.SESSION_SECRET);
    const sealed = codec.open(decodeURIComponent(sessionRaw));
    const intro = await fetch(`${env.OIDC_ISSUER ?? "http://localhost:3005"}/token/introspection`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${env.OIDC_CLIENT_ID}:${env.OIDC_CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({ token: sealed.accessToken, token_type_hint: "access_token" }),
    });
    console.log("introspect:", intro.status, await intro.text());
    const userinfo = await fetch(`${env.OIDC_ISSUER ?? "http://localhost:3005"}/me`, {
      headers: { authorization: `Bearer ${sealed.accessToken}` },
    });
    console.log("userinfo:", userinfo.status, await userinfo.text());
  } catch (error) {
    console.log("token debug failed:", error instanceof Error ? error.message : error);
  }
}

const csrf = decodeURIComponent(jar.get(env.CSRF_COOKIE_NAME ?? "lens_csrf") ?? "");
const meta = await fetch(`${bffUrl}/api/admin/ingestion/meta`, {
  headers: { accept: "application/json", cookie: jar.header(), "x-lens-csrf": csrf },
});
console.log("ingestion/meta:", meta.status, await meta.text());
