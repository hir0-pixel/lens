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
async function step(label, url, init = {}) {
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    headers: { ...(init.headers ?? {}), ...(jar.header() ? { cookie: jar.header() } : {}) },
  });
  jar.ingest(response);
  console.log(label, response.status, response.headers.get("location") ?? response.url);
  return response;
}

let r = await step("login", `${bffUrl}/auth/login`);
for (let i = 0; i < 16; i++) {
  if (r.status < 300 || r.status >= 400) break;
  const loc = r.headers.get("location");
  if (!loc) break;
  const next = new URL(loc, r.url || bffUrl).toString();
  if (next.includes("/interaction/")) {
    const page = await step("interaction-get", next);
    const html = page.status < 400 ? await page.text() : "";
    if (html.includes("Sign in to Lens")) {
      r = await step("interaction-login", next, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "login=devuser&password=dev",
      });
    } else {
      r = await step("interaction-consent", next, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "",
      });
    }
    continue;
  }
  r = await step(`redirect-${i}`, next);
}
console.log("cookies", [...jar.header().split("; ").map((c) => c.split("=")[0])]);
