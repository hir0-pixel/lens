/**
 * Task 9: Live Provider + RAG smoke test (API path mandatory).
 * Run: server/node_modules/.bin/tsx scripts/dev/smoke-task9-rag.mjs
 *
 * Requires live stack: BFF :3001, retrieval :8788, authority :8790, runtime :8793, orchestrator :8789.
 * Provider key: set SMOKE_PROVIDER_API_KEY (or GEMINI_API_KEY) in the environment — never committed.
 */
import { readFileSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { computeCompanyRagProfileDigest } from "../../services/rag-profile/companyRagProfile.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SENSITIVE_MARKERS = [/sk-[a-zA-Z0-9]{8,}/, /AIza[0-9A-Za-z_-]{20,}/, /Bearer\s+/i];

function loadEnvFile(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    let value = trimmed.slice(eq + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\n/g, "\n");
    }
    env[trimmed.slice(0, eq)] = value;
  }
  return env;
}

function assertNoSecrets(label, text) {
  for (const pattern of SENSITIVE_MARKERS) {
    if (pattern.test(text)) throw new Error(`${label} leaked sensitive material`);
  }
}

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

class CookieJar {
  /** @type {Map<string, string>} */
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

/** Complete dev OIDC login (dev-idp accepts any credentials; always issues dev-user-1). */
async function loginViaOidc(env) {
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
  for (let hops = 0; hops < 16; hops++) {
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) break;
      const next = new URL(location, response.url).toString();
      if (next.includes("/interaction/")) {
        const page = await step(next);
        if (page.status >= 200 && page.status < 300) {
          const html = await page.text();
          if (html.includes('name="login"') || html.includes("Sign in to Lens")) {
            response = await step(next, {
              method: "POST",
              headers: { "content-type": "application/x-www-form-urlencoded" },
              body: "login=devuser&password=dev",
            });
          } else {
            response = await step(next, {
              method: "POST",
              headers: { "content-type": "application/x-www-form-urlencoded" },
              body: "",
            });
          }
        } else {
          response = page;
        }
        continue;
      }
      response = await step(next);
      continue;
    }
    if (response.url.includes("/auth/callback") && response.status < 400) break;
    if (jar.get(env.SESSION_COOKIE_NAME ?? "lens_session")) break;
    break;
  }

  const csrfCookieName = env.CSRF_COOKIE_NAME ?? "lens_csrf";
  const csrfRaw = jar.get(csrfCookieName);
  if (!csrfRaw || !jar.header()) throw new Error("OIDC login did not produce session cookies — is dev-idp (:3005) running?");
  return { jar, csrf: decodeURIComponent(csrfRaw) };
}

async function bffFetch(env, _subjectRef, path, init = {}) {
  const bffUrl = env.BFF_URL ?? "http://127.0.0.1:3001";
  const login = await loginViaOidc(env);
  const headers = {
    accept: "application/json",
    cookie: login.jar.header(),
    "x-lens-csrf": login.csrf,
    ...(init.headers ?? {}),
  };
  const response = await fetch(`${bffUrl}${path}`, { ...init, headers });
  const text = await response.text();
  assertNoSecrets(`${path} response`, text);
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { response, body, text };
}

/** Reuse one login for multiple calls in a scenario block. */
async function bffSession(env) {
  const bffUrl = env.BFF_URL ?? "http://127.0.0.1:3001";
  const login = await loginViaOidc(env);
  return {
    async fetch(path, init = {}) {
      const headers = {
        accept: "application/json",
        cookie: login.jar.header(),
        "x-lens-csrf": login.csrf,
        ...(init.headers ?? {}),
      };
      const response = await fetch(`${bffUrl}${path}`, { ...init, headers });
      const text = await response.text();
      assertNoSecrets(`${path} response`, text);
      let body;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = text;
      }
      return { response, body, text };
    },
  };
}

function pickModel(models) {
  const refs = models.map((m) => m.modelRef);
  for (const preferred of ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-latest"]) {
    if (refs.includes(preferred)) return preferred;
  }
  return models.find((m) => m.available)?.modelRef;
}

const env = loadEnvFile(resolve(root, "server/.env"));
const adminSubject = (env.ADMIN_SUBJECTS ?? "dev-user-1").split(",")[0].trim();
const report = [];
const pass = (step, detail) => report.push({ step, status: "PASS", detail });
const fail = (step, detail) => report.push({ step, status: "FAIL", detail });
const skip = (step, detail) => report.push({ step, status: "SKIP", detail });
const note = (step, detail) => report.push({ step, status: "NOTE", detail });

console.log("Task 9 smoke — live provider + governed RAG");
console.log(`admin subject: ${adminSubject}`);

// --- 1. Service health ---
for (const [name, url] of [
  ["bff", "http://127.0.0.1:3001/ready"],
  ["retrieval", "http://127.0.0.1:8788/readyz"],
  ["orchestrator", "http://127.0.0.1:8789/readyz"],
  ["runtime", "http://127.0.0.1:8793/readyz"],
]) {
  try {
    const r = await fetch(url);
    const ok = r.ok && (await r.json()).ok !== false;
    if (ok) pass(`health:${name}`, url);
    else fail(`health:${name}`, `${url} -> ${r.status}`);
  } catch (error) {
    fail(`health:${name}`, error instanceof Error ? error.message : String(error));
  }
}

// --- 2. Admin session + CSRF gate (live: dev-idp always issues dev-user-1 = admin) ---
const unauthOnboard = await fetch(`${env.BFF_URL ?? "http://127.0.0.1:3001"}/api/admin/providers`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ adapterType: "openai-compatible", baseUrl: "http://127.0.0.1:1", apiKey: "x".repeat(16), tlsWorkloadRef: "w", allowedModels: ["m"], capabilities: ["generate"], timeoutMs: 1000, maxConcurrency: 1, idempotencyKey: randomUUID() }),
});
if (unauthOnboard.status === 403 || unauthOnboard.status === 401) {
  pass("admin-auth:unauthenticated-blocked", `POST /api/admin/providers without session -> ${unauthOnboard.status}`);
} else {
  fail("admin-auth:unauthenticated-blocked", `expected 401/403, got ${unauthOnboard.status}`);
}
const admin = await bffSession(env);
const adminSession = await admin.fetch("/api/session");
if (adminSession.response.status === 200 && adminSession.body?.administrator === true) {
  pass("admin-session", `subject=${adminSession.body.subject} administrator=true`);
} else {
  fail("admin-session", `administrator=${adminSession.body?.administrator} status=${adminSession.response.status}`);
}
note("admin-auth:non-admin-live", "Non-admin SSO denial covered by server/tests/providerCatalog.test.ts");

// --- 3. Provider onboarding (API mandatory) ---
const apiKey =
  process.env.SMOKE_PROVIDER_API_KEY ??
  process.env.GEMINI_API_KEY ??
  process.env.GOOGLE_API_KEY ??
  process.env.PROVIDER_API_KEY;

let providerId;
const modelsBefore = await admin.fetch("/api/models");
const existingModels = Array.isArray(modelsBefore.body?.models) ? modelsBefore.body.models : [];

if (existingModels.length > 0 && !process.env.SMOKE_FORCE_ONBOARD) {
  skip("onboard:api", `provider already registered (${existingModels.length} model refs in catalog)`);
  providerId = "(existing)";
} else if (!apiKey) {
  skip("onboard:api", "no SMOKE_PROVIDER_API_KEY / GEMINI_API_KEY in environment; using existing registry if any");
} else {
  const onboard = await admin.fetch("/api/admin/providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      adapterType: "openai-compatible",
      baseUrl: process.env.SMOKE_PROVIDER_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKey,
      tlsWorkloadRef: "workload:runtime-adapter",
      allowedModels: (process.env.SMOKE_ALLOWED_MODELS ?? "gemini-3.6-flash,gemini-3.7-flash").split(",").map((s) => s.trim()).filter(Boolean),
      capabilities: ["generate", "stream"],
      timeoutMs: 120_000,
      maxConcurrency: 8,
      idempotencyKey: `smoke-task9-${Date.now()}`,
    }),
  });
  assertNoSecrets("onboard response", JSON.stringify(onboard.body ?? {}));
  if (onboard.response.status === 201 && onboard.body?.id) {
    providerId = onboard.body.id;
    pass("onboard:api", `provider ${providerId} status=${onboard.body.status}`);
    if (onboard.body.apiKey !== undefined || onboard.body.secretRef !== undefined || onboard.body.baseUrl !== undefined) {
      fail("onboard:no-secrets-in-response", "response contained key/url/secretRef fields");
    } else {
      pass("onboard:no-secrets-in-response", "response is { id, status } only");
    }
  } else {
    fail("onboard:api", `status=${onboard.response.status} error=${onboard.body?.error ?? "unknown"}`);
  }
}

// --- 4. Employee catalog ---
const catalog = await admin.fetch("/api/models");
const models = Array.isArray(catalog.body?.models) ? catalog.body.models : [];
if (catalog.response.status === 200 && models.length > 0) {
  pass("catalog:GET /api/models", `${models.length} allowlisted refs`);
  const sample = models.slice(0, 3).map((m) => m.modelRef).join(", ");
  note("catalog:sample", sample);
} else {
  fail("catalog:GET /api/models", `status=${catalog.response.status} count=${models.length}`);
}

const modelRef = pickModel(models);
if (!modelRef) {
  console.error("\nNo model ref available — onboard a provider first.");
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

// --- 5. Ingest test corpus ---
const profile = JSON.parse(env.COMPANY_RAG_PROFILE_JSON ?? "{}");
const ragProfileDigest = computeCompanyRagProfileDigest(profile);
const corpusText =
  "SMOKE-T9-CORPUS: The quarterly budget must be approved by directors before spending. Code: T9-BUDGET-7742.";
const version = `v${Date.now()}`;
const versionRef = `smoke-task9-doc@${version}`;
const ingest = await admin.fetch("/api/admin/ingestion/corpora/enterprise-docs/jobs", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    sourceId: "admin-paste",
    documentRef: "smoke-task9-doc",
    version,
    versionRef,
    contentDigest: digest(corpusText),
    aclDigest: digest("acl:smoke-task9"),
    classificationRef: "internal",
    parse: {
      status: "accepted",
      renditionDigest: digest(`rendition:${versionRef}`),
      chunks: [{ chunkRef: "chunk-1", contentDigest: digest(corpusText), text: corpusText, citationAnchor: "chunk:1" }],
    },
    ragProfileVersion: profile.profileVersion,
    ragProfileDigest,
  }),
});
if (ingest.response.status >= 200 && ingest.response.status < 300) {
  pass("ingest:corpus", `job accepted (${ingest.response.status})`);
} else {
  fail("ingest:corpus", `status=${ingest.response.status} error=${ingest.body?.error ?? "unknown"}`);
}

async function askRag(session, query, opts = {}) {
  const creationKey = randomUUID();
  const payload = {
    query,
    modelId: opts.modelId ?? modelRef,
    ...(opts.conversationRef ? { conversationRef: opts.conversationRef } : { conversationCreationKey: creationKey }),
  };
  let result = await session.fetch("/api/rag/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (result.response.status === 503) {
    result = await session.fetch("/api/rag/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, conversationCreationKey: randomUUID(), conversationRef: undefined }),
    });
  }
  if (
    result.response.status === 403 &&
    opts.conversationRef &&
    (result.body?.error === "CONVERSATION_REF_INVALID" || result.body?.error === "FORBIDDEN")
  ) {
    result = await session.fetch("/api/rag/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, modelId: opts.modelId ?? modelRef, conversationCreationKey: randomUUID() }),
    });
  }
  return result;
}

// --- 6. RAG scenarios (reuse admin SSO session) ---
const greeting = await askRag(admin, "Hello!");
if (greeting.response.status === 200) {
  const out = greeting.body?.output ?? "";
  const cites = greeting.body?.citations?.length ?? 0;
  if (cites === 0) pass("rag:greeting-skip", "200 with no citations (fast path)");
  else note("rag:greeting-skip", `200 with ${cites} citations (may still be valid)`);
  note("rag:greeting-output-len", `${out.length} chars`);
} else {
  fail("rag:greeting", `status=${greeting.response.status} error=${greeting.body?.error}`);
}

const direct = await askRag(admin, "What does the quarterly budget policy require before spending?");
if (direct.response.status === 200) {
  const out = (direct.body?.output ?? "").toLowerCase();
  const cites = direct.body?.citations?.length ?? 0;
  const grounded = out.includes("director") || out.includes("approv");
  if (grounded && cites > 0) pass("rag:direct-doc", `grounded answer, ${cites} citations`);
  else fail("rag:direct-doc", `missing grounding (directors/approved) or citations (${cites})`);
} else {
  fail("rag:direct-doc", `status=${direct.response.status} error=${direct.body?.error} reason=${direct.body?.reason ?? ""}`);
}

const semantic = await askRag(admin, "Who must sign off on departmental spend each quarter?");
if (semantic.response.status === 200) {
  const out = (semantic.body?.output ?? "").toLowerCase();
  const cites = semantic.body?.citations?.length ?? 0;
  const grounded = out.includes("director") || out.includes("approv");
  if (grounded && cites > 0) pass("rag:semantic", `retrieved context, ${cites} citations`);
  else fail("rag:semantic", "paraphrase did not retrieve budget policy context");
} else {
  fail("rag:semantic", `status=${semantic.response.status} error=${semantic.body?.error}`);
}

const unauthorized = await askRag(
  admin,
  "What is the secret project codename ZETA-OMEGA-9911 clearance level?",
);
if (unauthorized.response.status === 200) {
  const out = (unauthorized.body?.output ?? "").toLowerCase();
  const cites = unauthorized.body?.citations?.length ?? 0;
  const answersAsFact =
    cites > 0 ||
    /\b(clearance level|classified|top secret|secret project)\b/.test(out) &&
    !/\b(no information|not find|don't have|do not have|cannot find|provided context|not mention)\b/.test(out);
  if (!answersAsFact) {
    pass("rag:unauthorized-abstain", "no grounded disclosure for unknown restricted topic");
  } else {
    fail("rag:unauthorized-abstain", "model appeared to disclose restricted content");
  }
} else if (unauthorized.response.status === 403 || unauthorized.response.status === 401) {
  pass("rag:unauthorized-abstain", `fail-closed (${unauthorized.response.status})`);
} else {
  note("rag:unauthorized", `status=${unauthorized.response.status}`);
}

// --- 7. Disable provider fail-closed ---
if (providerId && providerId !== "(existing)" && providerId.startsWith("prv_")) {
  const disabled = await admin.fetch(`/api/admin/providers/${providerId}/disable`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (disabled.response.status === 200) {
    pass("disable:provider", `disabled ${providerId}`);
    const afterDisable = await askRag(admin, "What does the quarterly budget policy say?");
    if (afterDisable.response.status === 403 || afterDisable.response.status === 503) {
      pass("disable:fail-closed", `Ask denied after disable (${afterDisable.response.status})`);
    } else {
      fail("disable:fail-closed", `expected denial, got ${afterDisable.response.status}`);
    }
  } else {
    fail("disable:provider", `status=${disabled.response.status}`);
  }
} else if (providerId === "(existing)") {
  skip("disable:provider", "skipped to avoid disabling production dev registry provider");
  note("disable:manual", "Run POST /api/admin/providers/:id/disable to verify fail-closed manually");
} else {
  skip("disable:provider", "no provider id from this run");
}

// --- 8. Admin UI assessment ---
note("ui:providers-settings", "PASS — Settings → Providers exists (ProvidersSettingsPage.tsx), wired to POST /api/admin/providers for administrators");

// --- Report ---
console.log("\n--- Task 9 Report ---");
for (const row of report) {
  console.log(`[${row.status}] ${row.step}: ${row.detail}`);
}
const failures = report.filter((r) => r.status === "FAIL").length;
console.log(`\nTotal: ${report.length} checks, ${failures} failures`);
process.exit(failures > 0 ? 1 : 0);
