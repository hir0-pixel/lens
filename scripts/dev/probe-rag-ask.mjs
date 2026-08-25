/**
 * Probe live Ask path via OrchestratorClient (same as BFF /api/rag/ask).
 * Run: server/node_modules/.bin/tsx scripts/dev/probe-rag-ask.mjs
 */
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DelegatedSessionAssertionIssuer } from "../../services/security/delegatedSessionAssertion.ts";
import { ConversationReferenceCodec } from "../../server/src/security/conversationReference.ts";
import { ProviderOnboardingService } from "../../services/provider-registry/onboard.ts";
import { SqliteProviderRegistry } from "../../services/provider-registry/ProviderRegistry.ts";
import { MemorySecretStore } from "../../services/secrets/SecretStore.ts";

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

const orchestratorUrl = process.env.ORCHESTRATOR_URL;
const orchestratorToken = process.env.ORCHESTRATOR_TOKEN;
const bffKey = process.env.BFF_ASSERTION_PRIVATE_KEY;
const memoryKey = process.env.MEMORY_ASSERTION_PRIVATE_KEY;
const conversationSecret = process.env.CONVERSATION_REFERENCE_SECRET;

if (!orchestratorUrl || !orchestratorToken || !bffKey || !memoryKey || !conversationSecret) {
  console.error("Missing RAG env in server/.env — merge bff-rag.env and restart BFF");
  process.exit(1);
}

const query = process.argv[2] ?? "What does the quarterly budget policy say?";
const requestId = randomUUID();
const digest = `sha256:${createHash("sha256").update(query).digest("hex")}`;
const conversationCodec = new ConversationReferenceCodec(conversationSecret);
const conversationRef = conversationCodec.issue("dev-user-1");
const sessionIssuer = new DelegatedSessionAssertionIssuer(bffKey);
const memoryIssuer = new DelegatedSessionAssertionIssuer(memoryKey);
const bindings = {
  requestId,
  subjectRef: "dev-user-1",
  sessionRef: "probe-session",
  deviceRef: "probe-device",
  conversationRef,
  queryDigest: digest,
  workspaceRef: "default-workspace",
  requestClass: "enterprise-grounded",
  purposeRef: "assistant",
};

const onboarding = new ProviderOnboardingService(
  new SqliteProviderRegistry(process.env.PROVIDER_REGISTRY_PATH ?? resolve(root, ".local/rag-stack/data/providers.sqlite")),
  new MemorySecretStore(),
  fetch,
);
const catalog = await onboarding.employeeCatalog();
console.log("employee catalog:", catalog);
const preferred = process.env.PROBE_MODEL;
const modelRef = preferred === "none"
  ? undefined
  : preferred
    ? catalog.find((m) => m.modelRef === preferred && m.available)?.modelRef
    : catalog.find((m) => m.modelRef === "gemini-3.6-flash" && m.available)?.modelRef
      ?? catalog.find((m) => m.modelRef === "gemini-3.7-flash" && m.available)?.modelRef
      ?? catalog.find((m) => m.available)?.modelRef;
console.log("using modelRef:", modelRef ?? "(none)");

try {
  const ready = await fetch(new URL("/readyz", orchestratorUrl)).then((r) => r.json());
  console.log("orchestrator /readyz:", ready);

  const url = new URL("/v1/chat", orchestratorUrl);
  const rawBody = {
    request_id: requestId,
    turn_id: `turn-${requestId}`,
    subject_ref: bindings.subjectRef,
    session_ref: bindings.sessionRef,
    device_ref: bindings.deviceRef,
    conversation_ref: conversationRef,
    session_assertion: sessionIssuer.issue({ issuer: "bff", audience: "orchestrator", ...bindings }),
    memory_session_assertion: memoryIssuer.issue({ issuer: "bff", audience: "memory", ...bindings }),
    application_id: "lens-employee-client",
    purpose_ref: "assistant",
    retrieval_class: "enterprise-grounded",
    input_text: query,
    query_digest: digest,
    deadline_at: Date.now() + 60_000,
    cancellation: false,
    retry_budget: 0,
    bulkhead: "interactive",
    capability: "grounded-assistant",
    ...(modelRef ? { model_ref: modelRef } : {}),
  };
  const raw = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-lens-orchestrator-token": orchestratorToken,
      "x-lens-request-id": requestId,
    },
    body: JSON.stringify(rawBody),
  });
  const rawText = await raw.text();
  console.log("orchestrator raw:", raw.status, rawText.slice(0, 2000));
  if (!raw.ok) process.exit(1);
  console.log("SUCCESS", JSON.parse(rawText));
} catch (error) {
  console.error("FAILED", error);
  process.exit(1);
}
