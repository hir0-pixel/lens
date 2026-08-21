#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runtimeRoot = path.join(root, "deploy", "on-prem", "rag");

function walk(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entry = statSync(current);
    if (entry.isDirectory()) {
      for (const child of readdirSync(current)) stack.push(path.join(current, child));
      continue;
    }
    if (/\.(ya?ml|json)$/i.test(current)) files.push(current);
  }
  return files.sort();
}

function fail(message) {
  throw new Error(`Track 7 deployment check failed: ${message}`);
}

function contains(text, pattern) {
  if (!pattern.test(text)) fail(`missing ${pattern} in manifest set`);
}

function requireFile(files, relativePath) {
  const fullPath = path.join(runtimeRoot, ...relativePath.split("/"));
  if (!files.includes(fullPath)) fail(`required manifest missing: deploy/on-prem/rag/${relativePath}`);
  return readFileSync(fullPath, "utf8");
}

function requireBoundedCollectorQueue(exporterBlock, name) {
  if (!/sending_queue:\s*\n\s*enabled:\s*true/.test(exporterBlock)) fail(`${name} exporter has no enabled sending_queue`);
  const queue = exporterBlock.match(/queue_size:\s*(\d+)/);
  if (!queue || Number(queue[1]) < 1 || Number(queue[1]) > 10_000) fail(`${name} exporter has no bounded queue_size`);
  const retry = exporterBlock.match(/max_elapsed_time:\s*([1-9]\d*)s/);
  if (!retry || Number(retry[1]) > 300) fail(`${name} exporter has no bounded retry max_elapsed_time`);
}

function assertNoPayloadKeysInAllowlists(observability) {
  const forbiddenAllowedKey = /\b(?:api[_-]?key|authorization|bearer|chunk|content|credential|document|memory|output|password|prompt|raw|secret|session|subject|token|tool_?arg|tool_?result|user_?id)\b/i;
  const keepKeys = [...observability.matchAll(/keep_keys\([^\n]+?\[([^\]]*)\]\)/g)];
  if (keepKeys.length < 8) fail("observability sanitizer does not define enough explicit keep_keys allowlists");
  for (const match of keepKeys) {
    if (forbiddenAllowedKey.test(match[1])) {
      fail(`observability sanitizer allowlist includes a payload-bearing key: ${match[1]}`);
    }
  }
}

function runObservabilityChecks(files, combined) {
  const observability = requireFile(files, "base/observability.yaml");
  contains(observability, /name:\s*observability-workload/);
  contains(observability, /name:\s*lens-otel-collector/);
  contains(observability, /replicas:\s*3/);
  contains(observability, /image:\s*registry\.platform\.internal\/lens\/otel-collector-contrib@sha256:[a-f0-9]{64}/);
  contains(observability, /type:\s*ClusterIP/);
  contains(observability, /memory_limiter:/);
  contains(observability, /filter\/sovereign_payload_guard:/);
  contains(observability, /transform\/sovereign_sanitize:/);
  contains(observability, /trace_conditions:/);
  contains(observability, /log_conditions:/);
  contains(observability, /metric_conditions:/);
  contains(observability, /context:\s*spanevent[\s\S]*spanevent\.name != "" or spanevent\.name == ""/);
  contains(observability, /set\(log\.body,\s*"content-free-operational-event"\)/);
  contains(observability, /keep_keys\(span\.attributes,/);
  contains(observability, /keep_keys\(datapoint\.attributes,/);
  contains(observability, /keep_keys\(log\.attributes,/);
  contains(observability, /prompt\|raw\|secret\|session\|subject\|token/);
  contains(observability, /batch:/);
  contains(observability, /file_storage:/);
  contains(observability, /readOnlyRootFilesystem:\s*true/);
  contains(observability, /allowPrivilegeEscalation:\s*false/);
  contains(observability, /capabilities:\s*\n\s*drop:\s*\["ALL"\]/);
  contains(observability, /podAntiAffinity:/);
  contains(observability, /topologySpreadConstraints:/);
  contains(observability, /kind:\s*PodDisruptionBudget[\s\S]*name:\s*lens-otel-collector/);
  contains(observability, /kind:\s*NetworkPolicy[\s\S]*name:\s*observability-ingress/);
  contains(observability, /kind:\s*NetworkPolicy[\s\S]*name:\s*observability-egress/);
  contains(observability, /kind:\s*NetworkPolicy[\s\S]*name:\s*runtime-observability-egress/);
  contains(observability, /endpoint:\s*https:\/\/metrics\.telemetry\.platform\.internal/);
  contains(observability, /endpoint:\s*https:\/\/logs\.telemetry\.platform\.internal/);
  contains(observability, /endpoint:\s*https:\/\/traces\.telemetry\.platform\.internal/);

  for (const name of ["metrics", "logs", "traces"]) {
    const block = observability.match(new RegExp(`otlphttp/${name}:[\\s\\S]*?(?=\\n\\s{6}otlphttp/|\\n\\s{4}service:)`));
    if (!block) fail(`missing otlphttp/${name} exporter`);
    requireBoundedCollectorQueue(block[0], `otlphttp/${name}`);
  }
  for (const pipeline of ["metrics", "logs", "traces"]) {
    const pipelineBlock = observability.match(new RegExp(`${pipeline}:\\s*\\n\\s*receivers:\\s*\\[otlp\\]\\s*\\n\\s*processors:\\s*\\[([^\\]]+)\\]`));
    if (!pipelineBlock) fail(`${pipeline} pipeline is missing processors`);
    const processors = pipelineBlock[1].split(",").map((item) => item.trim());
    const expected = ["memory_limiter", "filter/sovereign_payload_guard", "transform/sovereign_sanitize", "batch"];
    if (processors.join("|") !== expected.join("|")) {
      fail(`${pipeline} pipeline processors must be memory_limiter, payload guard, sanitizer, batch`);
    }
  }
  assertNoPayloadKeysInAllowlists(observability);

  if (/endpoint:\s*https?:\/\/(?![a-z0-9.-]+\.internal\b)/i.test(observability)) {
    fail("observability manifests contain a non-internal endpoint");
  }
  if (/anonymous[_-]?usage|telemetry\.grafana\.com|prometheus\.io\/docs|webhook\.site|slack\.com|pagerduty\.com/i.test(observability)) {
    fail("observability manifests contain public SaaS, webhook, or anonymous usage endpoints");
  }
  if (/audit:\s*\n\s*receivers:|exporters:\s*\[[^\]]*audit|name:\s*.*audit.*dashboard/i.test(observability)) {
    fail("Audit must not use the operational observability pipeline");
  }

  contains(observability, /name:\s*lens-observability-rules/);
  for (const alertName of [
    "LensRequestErrorBudgetBurn",
    "LensRequestLatencyP99High",
    "LensActiveRequestsSaturated",
    "LensResourceSaturation",
    "LensPdpGovernanceLatency",
    "LensAuthorizationFailureSpike",
    "LensAuditQuorumLoss",
    "LensPublicationMismatch",
    "LensTelemetryQueueDrops",
    "LensTelemetryExporterFailure",
    "LensIndexReplicaLoss",
    "LensInferenceSaturation",
    "LensRecoverySurge",
  ]) {
    if (!observability.includes(`alert: ${alertName}`)) fail(`missing alert rule ${alertName}`);
  }
  contains(observability, /receiver:\s*internal-noc/);
  contains(observability, /url:\s*https:\/\/incident-noc\.platform\.internal\/v1\/alertmanager/);
  contains(observability, /allowUiUpdates:\s*false/);
  contains(observability, /"editable":\s*false/);
  contains(observability, /name:\s*lens-telemetry-retention-policy/);
  contains(observability, /default_days:\s*(?:[1-9]\d*)/);
  contains(observability, /indefinite_retention:\s*false/);
  contains(observability, /audit_pipeline:\s*excluded/);

  contains(observability, /audit_pipeline:\s*excluded/);
  if (!/lens-otel-collector/.test(combined)) fail("observability gateway is not included in the manifest set");
}

export function runDeploymentChecks() {
  const files = walk(runtimeRoot);
  if (files.length === 0) fail("deploy/on-prem/rag has no manifests");
  const mustExist = [
    path.join(runtimeRoot, "overlays", "canary", "kustomization.yaml"),
    path.join(runtimeRoot, "overlays", "campus-failover", "kustomization.yaml"),
  ];
  for (const file of mustExist) {
    if (!existsSync(file)) fail(`required overlay missing: ${path.relative(root, file)}`);
  }

  const combined = files.map((file) => readFileSync(file, "utf8")).join("\n---\n");

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    if (!content.includes("workloadIdentity")) fail(`${path.relative(root, file)} has no workloadIdentity reference`);
    if (/type:\s*(LoadBalancer|NodePort)\b/.test(content)) fail(`${path.relative(root, file)} exposes a public or node-level Service`);
    if (/ExternalName/.test(content)) fail(`${path.relative(root, file)} relies on ExternalName rather than private Service routing`);
    if (/(openai\.com|anthropic\.com|huggingface\.co|googleapis\.com|localhost:\d+|127\.0\.0\.1:\d+)/i.test(content)) {
      fail(`${path.relative(root, file)} contains a forbidden external or loopback runtime endpoint`);
    }
  }

  contains(combined, /kind:\s*Namespace/);
  contains(combined, /kind:\s*Ingress/);
  contains(combined, /name:\s*lens-bff-private/);
  contains(combined, /kind:\s*Deployment/);
  contains(combined, /name:\s*lens-bff/);
  contains(combined, /name:\s*lens-orchestrator/);
  contains(combined, /name:\s*lens-retrieval/);
  contains(combined, /name:\s*lens-ingestion/);
  contains(combined, /kind:\s*PodDisruptionBudget/);
  contains(combined, /kind:\s*NetworkPolicy/);
  contains(combined, /name:\s*default-deny-all/);
  contains(combined, /policyTypes:\s*\n\s*-\s*Ingress\s*\n\s*-\s*Egress/);
  contains(combined, /topologySpreadConstraints:/);
  contains(combined, /podAntiAffinity:/);
  contains(combined, /serviceAccountToken:/);
  contains(combined, /automountServiceAccountToken:\s*false/);
  contains(combined, /terminationGracePeriodSeconds:/);
  contains(combined, /preStop:/);
  contains(combined, /livenessProbe:/);
  contains(combined, /readinessProbe:/);
  contains(combined, /tls:/);
  contains(combined, /ClusterIP/);
  contains(combined, /lens_retrieval_active_requests/);
  contains(combined, /lens_retrieval_p95_latency_milliseconds/);
  contains(combined, /lens_retrieval_worker_utilization/);
  contains(combined, /lens_ingestion_queue_depth/);
  contains(combined, /lens_ingestion_oldest_age_seconds/);
  contains(combined, /kind:\s*CronJob/);
  contains(combined, /rag-state-backup/);
  contains(combined, /rag-restore-verification/);
  contains(combined, /rag-campus-failover-drill/);
  runObservabilityChecks(files, combined);
  const ingressBackends = [...combined.matchAll(/kind:\s*Ingress[\s\S]*?service:\s*\n\s*name:\s*([^\n]+)/g)].map((match) => match[1].trim());
  if (ingressBackends.some((backend) => backend !== "lens-bff")) fail("only the BFF may be exposed through Ingress");

  return { passed: true, files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runDeploymentChecks();
  console.log(`Track 7 deployment check passed (${result.files.length} manifest files).`);
}
