import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCompanyRagProfile, computeCompanyRagProfileDigest } from "../../services/rag-profile/companyRagProfile.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function loadEnv(path) {
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

const bff = loadEnv(resolve(root, "server/.env"));
const profile = assertCompanyRagProfile(JSON.parse(bff.COMPANY_RAG_PROFILE_JSON));
const profileDigest = computeCompanyRagProfileDigest(profile);
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const query = process.argv[2] ?? "quarterly budget policy";
const requestId = randomUUID();

const body = {
  request_id: requestId,
  turn_id: `turn-${requestId}`,
  caller_workload_ref: "ai-orchestrator",
  subject_ref: "dev-user-1",
  session_ref: "probe",
  device_ref: "probe",
  application_id: "lens-employee-client",
  query_digest: digest(query),
  query_text: query,
  purpose_ref: "assistant",
  retrieval_class: "enterprise-grounded",
  corpus_ref: "enterprise-docs",
  mode: "hybrid",
  profile_version: profile.profileVersion,
  profile_digest: profileDigest,
  candidate_limit: 10,
  deadline_at: Date.now() + 30_000,
  cancellation: false,
  bulkhead: "interactive",
  visibility_minimum: 0,
};

const response = await fetch("http://127.0.0.1:8788/v1/retrieve", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json",
    "x-lens-caller-workload": "ai-orchestrator",
    "x-lens-orchestrator-token": bff.RETRIEVAL_WORKLOAD_TOKEN,
    "x-lens-request-id": requestId,
  },
  body: JSON.stringify(body),
});
const text = await response.text();
console.log("status:", response.status);
console.log(text.slice(0, 2000));
