#!/usr/bin/env node
/**
 * Track 0 production-build security gate.
 *
 * Fails the production build if any of the following are present:
 *  - external model/search endpoints in runtime source, deploy manifests, or built artifacts
 *  - test adapters or legacy bridges in runtime source or built artifacts
 *  - missing workload identity on a production serving service
 *  - any tracked runtime secret (server/.env and backups)
 *  - network egress to public destinations for runtime workloads
 *
 * Lab, test, and reference sources that are not packaged are intentionally
 * excluded from the runtime-source and build-artifact scans.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const nodeRequire = createRequire(import.meta.url);

const root = resolve(join(dirname(import.meta.url), "../.."));

function dirname(url) {
  return resolve(fileURLToPath(url), "..");
}

const EXTERNAL_ENDPOINT_PATTERNS = [
  /generativelanguage\.googleapis\.com/i,
  /generativelanguage\.google/i,
  /openai\.com/i,
  /api\.anthropic\.com/i,
  /openrouter\.ai/i,
  /Azure OpenAI/i,
  /huggingface\.co/i,
  /hf\.co/i,
  /publicmodelhost/i,
  /https?:\/\/[^/]*openai\.com/i,
];

const TEST_PROVIDER_PATTERNS = [
  /RAG_PROVIDER_MODE\s*[:=]\s*["']?gemini-test/i,
  /RAG_PROVIDER\s*[:=]\s*["']?gemini-test/i,
  /OIDC_TEST_MODE\s*[:=]\s*["']?true/i,
  /RAG_TEST_DATA_ONLY\s*[:=]\s*["']?true/i,
  /LocalRagClient/i,
];

const LOOPBACK_DEMO_PATTERNS = [
  /localhost:\d+/i,
  /127\.0\.0\.1:\d+/i,
  /RAG_SERVICE_URL\s*[:=]\s*["']?http:\/\/127\.0\.0\.1/i,
];

const RUNTIME_DEPLOYMENT_DIRS = ["deploy/on-prem/rag"];
const RUNTIME_SOURCE_FILES = [
  "server/src/index.ts",
  "server/src/routes/api.ts",
  "server/src/config/index.ts",
  "src/stores/providerStore.ts",
  "src/features/settings/sections/ProvidersSettingsPage.tsx",
  "platform/operators/indexPublicationClient.mjs",
  "scripts/operators/index-publication.mjs",
];
const READINESS_EVIDENCE_FILES = [
  "scripts/readiness/production-rag-load.mjs",
  "scripts/readiness/production-rag-load-lib.mjs",
];
const BUILD_ARTIFACT_DIRS = [
  "dist",
  "server/dist",
];

function walk(relative, pattern) {
  const absolute = join(root, relative);
  if (!existsSync(absolute)) return [];
  const files = [];
  const stack = [absolute];
  while (stack.length > 0) {
    const current = stack.pop();
    const entry = statSync(current);
    if (entry.isDirectory()) {
      for (const child of readdirSync(current)) stack.push(join(current, child));
    } else if (pattern.test(current)) {
      files.push(current);
    }
  }
  return files;
}

function scanContent(file, content, failures, labels) {
  for (const pattern of labels.external) {
    if (pattern.test(content)) {
      failures.push({ label: "external-endpoint", detail: `${file} matches ${pattern.source}` });
    }
  }
  for (const pattern of labels.testOnly) {
    if (pattern.test(content)) {
      failures.push({ label: "test-provider-in-production", detail: `${file} matches ${pattern.source}` });
    }
  }
}

export function runProductionBuildChecks() {
  const failures = [];

  const trackedList = runGitLsFiles();
  const secretFiles = trackedList.filter((file) =>
    /(^|\/)(\.env)$/.test(file) || /\.(pem|key|pfx|p12|keystore|jks)$/i.test(file),
  );
  for (const file of secretFiles) {
    failures.push({ label: "tracked-secret-file", detail: file });
  }
  if (secretFiles.includes("server/.env")) {
    failures.push({ label: "tracked-secret-file", detail: "server/.env is tracked in Git and must be removed." });
  }

  const serverEnvExample = readFileSync(join(root, "server/.env.example"), "utf8");
  if (!serverEnvExample.includes("SESSION_SECRET")) {
    failures.push({ label: "missing-session-secret", detail: "server/.env.example is missing SESSION_SECRET." });
  }

  const serverIndex = readFileSync(join(root, "server/src/index.ts"), "utf8");
  const serverConfig = readFileSync(join(root, "server/src/config/index.ts"), "utf8");
  const serverRoutes = readFileSync(join(root, "server/src/routes/api.ts"), "utf8");
  if (!/OrchestratorClient/.test(serverIndex)) {
    failures.push({ label: "missing-orchestrator-client", detail: "server/src/index.ts must construct an OrchestratorClient for the internal RAG path." });
  }
  if (/LocalRagClient/.test(serverIndex)) {
    failures.push({ label: "legacy-rag-bridge-wired", detail: "server/src/index.ts must not wire LocalRagClient." });
  }
  if (/\/generate/.test(serverRoutes)) {
    failures.push({ label: "obsolete-generate-route", detail: "server/src/routes/api.ts must not expose /api/generate." });
  }
  if (!/ORCHESTRATOR_URL/.test(serverConfig) || !/ORCHESTRATOR_TOKEN/.test(serverConfig)) {
    failures.push({ label: "missing-orchestrator-config", detail: "server/src/config/index.ts must require ORCHESTRATOR_URL and ORCHESTRATOR_TOKEN for internal mode." });
  }
  if (/gemini-test/.test(serverConfig) || /RAG_SERVICE_URL:\s*z\./.test(serverConfig) || /RAG_SERVICE_TOKEN:\s*z\./.test(serverConfig)) {
    failures.push({ label: "legacy-bridge-config", detail: "server/src/config/index.ts must not accept legacy bridge configuration." });
  }

  for (const relative of RUNTIME_SOURCE_FILES) {
    const file = join(root, relative);
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8");
    scanContent(file, content, failures, {
      external: EXTERNAL_ENDPOINT_PATTERNS,
      testOnly: TEST_PROVIDER_PATTERNS,
    });
  }

  for (const relative of READINESS_EVIDENCE_FILES) {
    const file = join(root, relative);
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8");
    scanContent(file, content, failures, {
      external: EXTERNAL_ENDPOINT_PATTERNS,
      testOnly: TEST_PROVIDER_PATTERNS,
    });
    if (/\/v1\/lab\/generate/.test(content)) {
      failures.push({ label: "legacy-lab-route-in-production-harness", detail: `${relative} must not target the obsolete lab generate route.` });
    }
    if (/--workload-token\s/.test(content)) {
      failures.push({ label: "token-content-cli-flag", detail: `${relative} must accept workload token files, not raw token contents on CLI.` });
    }
  }

  for (const dir of RUNTIME_DEPLOYMENT_DIRS) {
    for (const file of walk(dir, /\.(json|ya?ml|env\.example|tf|mjs|ts)$/i)) {
      const content = readFileSync(file, "utf8");
      scanContent(file, content, failures, {
        external: EXTERNAL_ENDPOINT_PATTERNS,
        testOnly: TEST_PROVIDER_PATTERNS,
      });
      if (dir.endsWith("/rag") || dir.endsWith("/identity")) {
        for (const pattern of LOOPBACK_DEMO_PATTERNS) {
          if (pattern.test(content)) {
            failures.push({ label: "loopback-demo-adapter", detail: `${file} matches ${pattern.source}` });
          }
        }
        if (!content.includes("workloadIdentity") && !content.includes("workload_identity") && !content.includes("WORKLOAD_IDENTITY")) {
          failures.push({ label: "missing-workload-identity", detail: `${file} has no workload identity reference.` });
        }
      }
    }
  }

  const egress = readEgressPolicy();
  if (!egress || egress.defaultDeny !== true || egress.publicDns !== "forbidden" || egress.publicIp !== "forbidden" || egress.proxy !== "forbidden" || egress.webhooks !== "forbidden") {
    failures.push({ label: "egress-not-default-deny", detail: "platform/network/egress-policy.json must deny DNS/IP/proxy/webhooks." });
  }
  if (egress && Array.isArray(egress.runtimeAllowedDestinations) && egress.runtimeAllowedDestinations.length > 0) {
    failures.push({ label: "runtime-egress-allowed", detail: "runtimeAllowedDestinations must be empty; runtime is default-deny." });
  }

  for (const dir of BUILD_ARTIFACT_DIRS) {
    for (const file of walk(dir, /\.(js|mjs|cjs|html|css)$/i)) {
      const content = readFileSync(file, "utf8");
      scanContent(file, content, failures, {
        external: EXTERNAL_ENDPOINT_PATTERNS,
        testOnly: TEST_PROVIDER_PATTERNS,
      });
    }
  }

  return { passed: failures.length === 0, failures };
}

function runGitLsFiles() {
  try {
    const { execSync } = nodeRequire("node:child_process");
    const output = execSync("git -C " + JSON.stringify(root) + " ls-files", { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    return output.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function readEgressPolicy() {
  const file = join(root, "platform/network/egress-policy.json");
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runProductionBuildChecks();
  if (!result.passed) {
    console.error("PRODUCTION BUILD CHECK FAILED");
    for (const failure of result.failures) console.error(`  - ${failure.label}: ${failure.detail}`);
    process.exit(1);
  }
  console.log("Production build security gate passed.");
}
