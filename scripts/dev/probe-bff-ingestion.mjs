/**
 * Ingest a sample doc into the *running* BFF corpus (in-memory indexes + publication).
 * Run: server/node_modules/.bin/tsx scripts/dev/probe-bff-ingestion.mjs
 */
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { computeCompanyRagProfileDigest } from "../../services/rag-profile/companyRagProfile.ts";
import { createSealedSessionCodec } from "../../server/src/utils/crypto.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function loadEnvFile(path) {
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    let value = trimmed.slice(eq + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\n/g, "\n");
    }
    process.env[trimmed.slice(0, eq)] = value;
  }
}

loadEnvFile(resolve(root, "server/.env"));

const bffUrl = process.env.BFF_URL ?? "http://127.0.0.1:3001";
const sessionSecret = process.env.SESSION_SECRET;
const sessionCookieName = process.env.SESSION_COOKIE_NAME ?? "lens_session";
const csrfCookieName = process.env.CSRF_COOKIE_NAME ?? "lens_csrf";
const adminSubject = (process.env.ADMIN_SUBJECTS ?? "dev-user-1").split(",")[0].trim();

if (!sessionSecret || sessionSecret.length < 32) {
  console.error("SESSION_SECRET missing or too short in server/.env");
  process.exit(1);
}

const profile = JSON.parse(process.env.COMPANY_RAG_PROFILE_JSON ?? "{}");
const ragProfileDigest = computeCompanyRagProfileDigest(profile);
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const text = process.argv[2] ?? "The quarterly budget must be approved by directors before spending.";
const version = `v${Date.now()}`;
const versionRef = `probe-doc@${version}`;
const csrfToken = randomBytes(24).toString("base64url");
const codec = createSealedSessionCodec(sessionSecret);
const sessionValue = codec.seal({
  version: 1,
  sid: randomBytes(16).toString("hex"),
  subjectRef: adminSubject,
  csrfToken,
  accessToken: "probe",
  refreshToken: "probe",
  idToken: "probe",
  tokenExpiresAt: Date.now() + 3600_000,
  expiresAt: Date.now() + 3600_000,
  profile: { name: "Probe Admin", email: "probe@lens.local" },
});
const sessionCookie = `${sessionCookieName}=${encodeURIComponent(sessionValue)}`;
const csrfCookie = `${csrfCookieName}=${encodeURIComponent(csrfToken)}`;

const body = {
  sourceId: "admin-paste",
  documentRef: "probe-doc",
  version,
  versionRef,
  contentDigest: digest(text),
  aclDigest: digest("acl:probe-doc"),
  classificationRef: "internal",
  parse: {
    status: "accepted",
    renditionDigest: digest(`rendition:${versionRef}`),
    chunks: [{ chunkRef: "chunk-1", contentDigest: digest(text), text, citationAnchor: "chunk:1" }],
  },
  ragProfileVersion: profile.profileVersion,
  ragProfileDigest,
};

const response = await fetch(`${bffUrl}/api/admin/ingestion/corpora/enterprise-docs/jobs`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json",
    cookie: `${sessionCookie}; ${csrfCookie}`,
    "x-lens-csrf": csrfToken,
  },
  body: JSON.stringify(body),
});
const payload = await response.text();
console.log("status:", response.status);
console.log(payload.slice(0, 2000));
if (!response.ok) process.exit(1);
