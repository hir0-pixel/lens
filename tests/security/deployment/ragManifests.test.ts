/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const nodeBin = existsSync(process.execPath) ? process.execPath : "node";

function runNode(script: string) {
  return execFileSync(nodeBin, [script], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
}

describe("Track 7 deployment manifests", () => {
  it("satisfy the static deployment invariant checker", () => {
    const output = runNode(path.join(ROOT, "platform", "deployment", "check-rag-manifests.mjs"));
    expect(output).toContain("Track 7 deployment check passed");
  });

  it("pass the authoritative production build gate", () => {
    const output = runNode(path.join(ROOT, "scripts", "security", "production-build-check.mjs"));
    expect(output).toContain("Production build security gate passed.");
  });

  it("keeps the user-facing ingress limited to the BFF only", () => {
    const runtime = readFileSync(path.join(ROOT, "deploy", "on-prem", "rag", "base", "runtime.yaml"), "utf8");
    expect(runtime).toContain("name: lens-bff-private");
    expect(runtime).not.toMatch(/name:\s*lens-orchestrator-private/);
    expect(runtime).not.toMatch(/name:\s*lens-retrieval-private/);
    expect(runtime).not.toMatch(/type:\s*(LoadBalancer|NodePort)/);
  });

  it("deploys sovereign observability with bounded collector queues and no public endpoint", () => {
    const observability = readFileSync(path.join(ROOT, "deploy", "on-prem", "rag", "base", "observability.yaml"), "utf8");
    expect(observability).toContain("name: lens-otel-collector");
    expect(observability).toMatch(/replicas:\s*3/);
    expect(observability).toMatch(/image:\s*registry\.platform\.internal\/lens\/otel-collector-contrib@sha256:[a-f0-9]{64}/);
    expect(observability).toMatch(/memory_limiter:/);
    expect(observability).toMatch(/filter\/sovereign_payload_guard:/);
    expect(observability).toMatch(/transform\/sovereign_sanitize:/);
    expect(observability).toMatch(/processors:\s*\[memory_limiter,\s*filter\/sovereign_payload_guard,\s*transform\/sovereign_sanitize,\s*batch\]/);
    expect(observability).toMatch(/keep_keys\(span\.attributes,/);
    expect(observability).toMatch(/keep_keys\(datapoint\.attributes,/);
    expect(observability).toMatch(/keep_keys\(log\.attributes,/);
    expect(observability).toMatch(/set\(log\.body,\s*"content-free-operational-event"\)/);
    expect(observability).toMatch(/context:\s*spanevent[\s\S]*spanevent\.name != "" or spanevent\.name == ""/);
    expect(observability).toMatch(/prompt\|raw\|secret\|session\|subject\|token/);
    expect(observability).toMatch(/sending_queue:[\s\S]*queue_size:\s*\d+/);
    expect(observability).toMatch(/retry_on_failure:[\s\S]*max_elapsed_time:\s*[1-9]\d*s/);
    expect(observability).toMatch(/endpoint:\s*https:\/\/metrics\.telemetry\.platform\.internal/);
    expect(observability).toMatch(/endpoint:\s*https:\/\/logs\.telemetry\.platform\.internal/);
    expect(observability).toMatch(/endpoint:\s*https:\/\/traces\.telemetry\.platform\.internal/);
    expect(observability).not.toMatch(/https?:\/\/(?![a-z0-9.-]+\.internal\b)/i);
    expect(observability).not.toMatch(/anonymous[_-]?usage|slack\.com|pagerduty\.com|webhook\.site/i);
  });

  it("keeps payload-bearing keys out of collector allowlists", () => {
    const observability = readFileSync(path.join(ROOT, "deploy", "on-prem", "rag", "base", "observability.yaml"), "utf8");
    const keepKeys = [...observability.matchAll(/keep_keys\([^\n]+?\[([^\]]*)\]\)/g)].map((match) => match[1]);
    expect(keepKeys.length).toBeGreaterThanOrEqual(8);
    for (const allowlist of keepKeys) {
      expect(allowlist).not.toMatch(/\b(?:api[_-]?key|authorization|bearer|chunk|content|credential|document|memory|output|password|prompt|raw|secret|session|subject|token|tool_?arg|tool_?result|user_?id)\b/i);
    }
  });

  it("keeps alerting, dashboard provisioning, and retention policy version-controlled", () => {
    const observability = readFileSync(path.join(ROOT, "deploy", "on-prem", "rag", "base", "observability.yaml"), "utf8");
    for (const alertName of [
      "LensRequestErrorBudgetBurn",
      "LensRequestLatencyP99High",
      "LensActiveRequestsSaturated",
      "LensResourceSaturation",
      "LensPdpGovernanceLatency",
      "LensAuditQuorumLoss",
      "LensPublicationMismatch",
      "LensTelemetryQueueDrops",
      "LensIndexReplicaLoss",
      "LensInferenceSaturation",
      "LensRecoverySurge",
    ]) {
      expect(observability).toContain(`alert: ${alertName}`);
    }
    expect(observability).toContain("receiver: internal-noc");
    expect(observability).toContain("allowUiUpdates: false");
    expect(observability).toContain("\"editable\": false");
    expect(observability).toMatch(/default_days:\s*[1-9]\d*/);
    expect(observability).toContain("indefinite_retention: false");
    expect(observability).toContain("audit_pipeline: excluded");
  });
});
