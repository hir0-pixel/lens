/** @vitest-environment node */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ProductionRagLoadError, runProductionRagLoad } from "../../scripts/readiness/production-rag-load-lib.mjs";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const DIGEST_D = `sha256:${"d".repeat(64)}`;
const DIGEST_E = `sha256:${"e".repeat(64)}`;

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function createManualClock() {
  let current = 1_726_000_000_000;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();

  const fireDue = () => {
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= current)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0]);
      if (due.length === 0) return;
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.fn();
      }
    }
  };

  return {
    now: () => current,
    perfNow: () => current,
    sleep: async (ms: number) => {
      current += ms;
      fireDue();
      await Promise.resolve();
    },
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: current + ms, fn });
      return id;
    },
    clearTimeout: (id: number) => {
      timers.delete(id);
    },
  };
}

function createMaterials(overrides: { token?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "lens-production-rag-load-"));
  writeFileSync(join(dir, "ca.pem"), "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n", "utf8");
  writeFileSync(join(dir, "client.pem"), "-----BEGIN CERTIFICATE-----\nCLIENT\n-----END CERTIFICATE-----\n", "utf8");
  writeFileSync(join(dir, "client.key"), "-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----\n", "utf8");
  writeFileSync(join(dir, "workload.token"), overrides.token ?? "t".repeat(48), "utf8");
  return {
    dir,
    caFile: join(dir, "ca.pem"),
    certFile: join(dir, "client.pem"),
    keyFile: join(dir, "client.key"),
    workloadTokenFile: join(dir, "workload.token"),
  };
}

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) rmSync(path, { recursive: true, force: true });
  }
});

function baseOptions(overrides: Record<string, unknown> = {}) {
  const materials = createMaterials();
  cleanupPaths.push(materials.dir);
  return {
    mode: "chat",
    endpoint: "https://orchestrator.platform.internal/v1/chat",
    caFile: materials.caFile,
    certFile: materials.certFile,
    keyFile: materials.keyFile,
    workloadTokenFile: materials.workloadTokenFile,
    targetRatePerSec: 10,
    maxInFlight: 4,
    connectedSessions: 100,
    sustainedDurationMs: 1_000,
    burstMultiplier: 1,
    burstDurationMs: 0,
    cancellationFraction: 0,
    cancelAfterMs: 0,
    cancellationDurationMs: 0,
    faultObservationDurationMs: 0,
    recoveryRatePerSec: 8,
    recoveryDurationMs: 0,
    requestDeadlineMs: 30_000,
    maxLagMs: 1_000,
    maxBacklogTokens: 8,
    maxPacingDrops: 0,
    minHeadroomFraction: 0,
    minAchievedRateFraction: 0.7,
    environmentDigest: DIGEST_A,
    modelDigest: DIGEST_B,
    corpusDigest: DIGEST_C,
    indexDigest: DIGEST_D,
    artifactDigest: DIGEST_E,
    productionMode: false,
    allowLoopbackForTests: false,
    ...overrides,
  };
}

describe("production RAG load harness", () => {
  it("rejects public endpoints and invalid workload-token files", async () => {
    await expect(runProductionRagLoad(baseOptions({
      endpoint: "https://public.example/v1/chat",
    }))).rejects.toThrow(ProductionRagLoadError);

    await expect(runProductionRagLoad(baseOptions({
      workloadTokenFile: undefined,
    }))).rejects.toThrow(/workload token file is required/i);

    const bad = createMaterials({ token: "short-token" });
    cleanupPaths.push(bad.dir);
    await expect(runProductionRagLoad(baseOptions({
      mode: "retrieve",
      endpoint: "https://retrieval.platform.internal/v1/retrieve",
      candidateLimit: 100,
      workloadTokenFile: bad.workloadTokenFile,
    }))).rejects.toThrow(/Workload token file must contain at least 32 bytes/);

    await expect(runProductionRagLoad(baseOptions({
      maxResponseBytes: 0,
    }))).rejects.toThrow(/maxResponseBytes must be an integer between 1 and 262144/);

    await expect(runProductionRagLoad(baseOptions({
      maxResponseBytes: 300_000,
    }))).rejects.toThrow(/maxResponseBytes must be an integer between 1 and 262144/);
  });

  it("sends retry_budget=0 with exact query digests and does not retry failed generations", async () => {
    const clock = createManualClock();
    const bodies: Array<Record<string, unknown>> = [];
    let calls = 0;
    const evidence = await runProductionRagLoad(baseOptions({
      targetRatePerSec: 5,
      sustainedDurationMs: 600,
      minAchievedRateFraction: 0.5,
    }), {
      ...clock,
      transport: async (request: { body: string }) => {
        calls += 1;
        const body = JSON.parse(request.body) as Record<string, unknown>;
        bodies.push(body);
        await clock.sleep(20);
        return {
          status: calls === 1 ? 503 : 200,
          headers: { "content-type": "application/json" },
          bodyText: calls === 1
            ? JSON.stringify({ error: "DEPENDENCY_UNAVAILABLE" })
            : JSON.stringify({ output: "private completion that must never appear in evidence" }),
        };
      },
    });

    expect(calls).toBe(evidence.attempted);
    expect(evidence.typed_failures.dependency_unavailable).toBe(1);
    expect(JSON.stringify(evidence)).not.toContain("private completion");
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body.retry_budget).toBe(0);
      expect(body.query_digest).toBe(sha256(String(body.input_text)));
    }
  });

  it("enforces bounded concurrency and keeps evidence content-free", async () => {
    const clock = createManualClock();
    let active = 0;
    let peak = 0;
    let firstRequestId = "";
    let tokenSeen = "";
    const evidence = await runProductionRagLoad(baseOptions({
      maxInFlight: 2,
      targetRatePerSec: 8,
      sustainedDurationMs: 1_000,
      minAchievedRateFraction: 0.5,
    }), {
      ...clock,
      transport: async (request: { body: string; headers: Record<string, string> }) => {
        active += 1;
        peak = Math.max(peak, active);
        const body = JSON.parse(request.body) as Record<string, unknown>;
        firstRequestId ||= String(body.request_id);
        tokenSeen ||= String(request.headers["x-lens-orchestrator-token"] ?? "");
        await clock.sleep(150);
        active -= 1;
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          bodyText: JSON.stringify({
            output: "sensitive synthetic output",
            citations: [{ anchor: "synthetic-doc" }],
          }),
        };
      },
    });

    expect(peak).toBeLessThanOrEqual(2);
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain("sensitive synthetic output");
    expect(serialized).not.toContain("synthetic-doc");
    expect(serialized).not.toContain(firstRequestId);
    expect(serialized).not.toContain(tokenSeen);
  });

  it("supports retrieval candidate envelopes 100, 500, and 1000 without logging returned context", async () => {
    for (const candidateLimit of [100, 500, 1000] as const) {
      const clock = createManualClock();
      const seenLimits: number[] = [];
      const evidence = await runProductionRagLoad(baseOptions({
        mode: "retrieve",
        endpoint: "https://retrieval.platform.internal/v1/retrieve",
        candidateLimit,
        targetRatePerSec: 4,
        sustainedDurationMs: 500,
        minAchievedRateFraction: 0.5,
      }), {
        ...clock,
        transport: async (request: { body: string }) => {
          const body = JSON.parse(request.body) as Record<string, unknown>;
          seenLimits.push(Number(body.candidate_limit));
          expect(body.query_digest).toBe(sha256(String(body.query_text)));
          await clock.sleep(30);
          return {
            status: 200,
            headers: { "content-type": "application/json" },
            bodyText: JSON.stringify({
              status: "context",
              sources: [{ text: "protected synthetic chunk" }],
            }),
          };
        },
      });

      expect(evidence.mode).toBe("retrieve");
      expect(evidence.profile.candidate_limit).toBe(candidateLimit);
      expect(seenLimits.length).toBeGreaterThan(0);
      expect(new Set(seenLimits)).toEqual(new Set([candidateLimit]));
      expect(JSON.stringify(evidence)).not.toContain("protected synthetic chunk");
    }
  });

  it("records cancelled requests during the cancellation phase", async () => {
    const clock = createManualClock();
    const evidence = await runProductionRagLoad(baseOptions({
      targetRatePerSec: 4,
      sustainedDurationMs: 0,
      cancellationDurationMs: 500,
      cancellationFraction: 1,
      cancelAfterMs: 25,
      minAchievedRateFraction: 0.5,
    }), {
      ...clock,
      transport: async (request: { signal: AbortSignal }) => {
        await clock.sleep(100);
        if (request.signal.aborted) {
          const error = new Error("aborted");
          error.name = "AbortError";
          throw error;
        }
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          bodyText: JSON.stringify({ ok: true }),
        };
      },
    });

    expect(evidence.cancelled).toBeGreaterThan(0);
    const cancellationPhase = evidence.phases.find((phase: { name: string }) => phase.name === "cancellation");
    expect(cancellationPhase?.cancelled).toBeGreaterThan(0);
  });

  it("records typed dependency failures during fault observation and recovery success afterward", async () => {
    const clock = createManualClock();
    const evidence = await runProductionRagLoad(baseOptions({
      targetRatePerSec: 4,
      sustainedDurationMs: 250,
      faultObservationDurationMs: 250,
      recoveryDurationMs: 250,
      recoveryRatePerSec: 2,
      minAchievedRateFraction: 0.4,
    }), {
      ...clock,
      transport: async () => {
        const current = clock.now() - 1_726_000_000_000;
        await clock.sleep(30);
        if (current >= 250 && current < 500) {
          return {
            status: 503,
            headers: { "content-type": "application/json" },
            bodyText: JSON.stringify({ error: "DEPENDENCY_UNAVAILABLE" }),
          };
        }
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          bodyText: JSON.stringify({ ok: true }),
        };
      },
    });

    const faultPhase = evidence.phases.find((phase: { name: string }) => phase.name === "fault-observation");
    const recoveryPhase = evidence.phases.find((phase: { name: string }) => phase.name === "recovery-surge");
    expect(faultPhase?.typed_failures.dependency_unavailable).toBeGreaterThan(0);
    expect(recoveryPhase?.success).toBeGreaterThan(0);
  });

  it("rejects redirects and oversized responses as bounded transport failures", async () => {
    const clock = createManualClock();
    const redirectEvidence = await runProductionRagLoad(baseOptions({
      targetRatePerSec: 4,
      sustainedDurationMs: 1_000,
      minAchievedRateFraction: 0.3,
    }), {
      ...clock,
      transport: async () => {
        await clock.sleep(10);
        return {
          status: 302,
          headers: { "content-type": "application/json", location: "https://public.example" },
          bodyText: JSON.stringify({ error: "redirect" }),
          redirected: true,
        };
      },
    });
    expect(redirectEvidence.typed_failures.redirect_rejected ?? 0).toBeGreaterThan(0);

    const oversize = "x".repeat(300_000);
    const oversizedEvidence = await runProductionRagLoad(baseOptions({
      targetRatePerSec: 4,
      sustainedDurationMs: 1_000,
      minAchievedRateFraction: 0.3,
    }), {
      ...clock,
      transport: async () => {
        await clock.sleep(10);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          bodyText: oversize,
        };
      },
    });
    expect(oversizedEvidence.typed_failures.invalid_response ?? 0).toBeGreaterThan(0);
  });

  it("writes a schema-versioned content-free evidence file when outputPath is supplied", async () => {
    const clock = createManualClock();
    const materials = createMaterials();
    cleanupPaths.push(materials.dir);
    const outputPath = join(materials.dir, "evidence.json");
    const evidence = await runProductionRagLoad({
      ...baseOptions({
        outputPath,
        maxInFlight: 2,
        targetRatePerSec: 4,
        sustainedDurationMs: 500,
        minAchievedRateFraction: 0.3,
      }),
    }, {
      ...clock,
      transport: async () => {
        await clock.sleep(20);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          bodyText: JSON.stringify({ output: "private result" }),
        };
      },
    });

    const onDisk = readFileSync(outputPath, "utf8");
    expect(JSON.parse(onDisk).schema_version).toBe(1);
    expect(onDisk).not.toContain("private result");
    expect(JSON.parse(onDisk).pass).toBe(evidence.pass);
  });
});
