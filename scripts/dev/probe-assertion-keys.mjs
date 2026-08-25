import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { DelegatedSessionAssertionIssuer, DelegatedSessionAssertionVerifier } from "../../services/security/delegatedSessionAssertion.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    let value = trimmed.slice(eq + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\n/g, "\n");
    }
    out[trimmed.slice(0, eq)] = value;
  }
  return out;
}

const bff = loadEnv(resolve(root, "server/.env"));
const orch = loadEnv(resolve(root, ".local/rag-stack/orchestrator.env"));
const derivedPublic = createPublicKey(createPrivateKey(bff.BFF_ASSERTION_PRIVATE_KEY)).export({ type: "spki", format: "pem" }).toString();
const match = derivedPublic === orch.LENS_ORCHESTRATOR_ASSERTION_PUBLIC_KEY;
console.log("assertion keys match:", match);
if (!match) {
  console.log("derived public key prefix:", derivedPublic.slice(0, 80));
  console.log("orchestrator public key prefix:", String(orch.LENS_ORCHESTRATOR_ASSERTION_PUBLIC_KEY).slice(0, 80));
  process.exit(1);
}

const issuer = new DelegatedSessionAssertionIssuer(bff.BFF_ASSERTION_PRIVATE_KEY);
const verifier = new DelegatedSessionAssertionVerifier(orch.LENS_ORCHESTRATOR_ASSERTION_PUBLIC_KEY);
const token = issuer.issue({
  issuer: "bff",
  audience: "orchestrator",
  requestId: "probe",
  subjectRef: "dev-user-1",
  sessionRef: "s",
  deviceRef: "d",
  conversationRef: "c",
  queryDigest: "sha256:" + "0".repeat(64),
  workspaceRef: "default-workspace",
  requestClass: "enterprise-grounded",
  purposeRef: "assistant",
});
verifier.verify(token, {
  audience: "orchestrator",
  requestId: "probe",
  subjectRef: "dev-user-1",
  sessionRef: "s",
  deviceRef: "d",
  conversationRef: "c",
  queryDigest: "sha256:" + "0".repeat(64),
  workspaceRef: "default-workspace",
  requestClass: "enterprise-grounded",
  purposeRef: "assistant",
});
console.log("assertion verify ok");
