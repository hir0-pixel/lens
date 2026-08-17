#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const percentile = (values, p) => values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] : 0;

export async function runModelBridgeLoad({ url, token, requests = 10, concurrency = 2, fetcher = fetch }) {
  if (url !== "http://edge:8082/v1/lab/generate" || typeof token !== "string" || token.length < 32) throw new Error("Invalid internal model bridge configuration.");
  if (!Number.isSafeInteger(requests) || requests < 1 || requests > 200 || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 20 || concurrency > requests) throw new Error("Invalid load profile.");
  const durations = [];
  let cursor = 0;
  let passed = 0;
  let failed = 0;
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const worker = async () => {
    while (cursor < requests) {
      const requestNumber = cursor++;
      const requestStarted = performance.now();
      try {
        const response = await fetcher(url, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ publicTest: true, prompt: `Readiness probe ${requestNumber + 1}. Reply briefly.` }),
          signal: AbortSignal.timeout(120_000),
        });
        const payload = await response.json();
        if (!response.ok || typeof payload?.output !== "string" || payload.output.length === 0) throw new Error("INVALID_RESPONSE");
        passed += 1;
      } catch {
        failed += 1;
      } finally {
        durations.push(Math.round(performance.now() - requestStarted));
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  durations.sort((a, b) => a - b);
  return {
    schemaVersion: 1,
    evidenceKind: "single-server-model-bridge-load",
    startedAt,
    completedAt: new Date().toISOString(),
    requests,
    concurrency,
    passed,
    failed,
    durationMs: Math.round(performance.now() - started),
    latencyMs: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95), p99: percentile(durations, 0.99), max: durations.at(-1) ?? 0 },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const requests = Number.parseInt(process.argv[2] ?? "10", 10);
  const concurrency = Number.parseInt(process.argv[3] ?? "2", 10);
  const evidence = await runModelBridgeLoad({ url: process.env.LENS_INTERNAL_MODEL_BRIDGE_URL, token: process.env.LENS_INTERNAL_MODEL_BRIDGE_TOKEN, requests, concurrency });
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.failed > 0) process.exitCode = 1;
}
