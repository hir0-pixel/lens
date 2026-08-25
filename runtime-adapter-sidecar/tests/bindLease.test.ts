import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main, evaluateSidecarReadiness } from "../src/main";

const TOKEN = "c".repeat(40);

describe("evaluateSidecarReadiness", () => {
  it("reports ready in development/test regardless of dependency availability", async () => {
    expect(await evaluateSidecarReadiness({ profile: "test", storeReady: async () => false })).toBe(true);
    expect(await evaluateSidecarReadiness({ profile: "development", storeReady: async () => false })).toBe(true);
  });

  it("fails closed in production when the store is unavailable", async () => {
    expect(await evaluateSidecarReadiness({ profile: "production", storeReady: async () => false })).toBe(false);
  });

  it("fails closed in production when no runtime health endpoint is configured", async () => {
    expect(await evaluateSidecarReadiness({ profile: "production", storeReady: async () => true })).toBe(false);
  });

  it("fails closed in production when the runtime health probe is unhealthy", async () => {
    const fetchFn = (async () => ({ ok: false })) as unknown as typeof fetch;
    expect(await evaluateSidecarReadiness({
      profile: "production", storeReady: async () => true, runtimeHealthUrl: "http://runtime/healthz", fetchFn,
    })).toBe(false);
  });

  it("reports ready in production when store and runtime health are good", async () => {
    const fetchFn = (async () => ({ ok: true })) as unknown as typeof fetch;
    expect(await evaluateSidecarReadiness({
      profile: "production", storeReady: async () => true, runtimeHealthUrl: "http://runtime/healthz", fetchFn,
    })).toBe(true);
  });
});

describe("Runtime adapter sidecar bind-lease", () => {
  const runningServers: { close: () => Promise<void> }[] = [];
  afterEach(async () => {
    while (runningServers.length) await runningServers.pop()!.close();
    vi.restoreAllMocks();
  });

  async function start() {
    const dir = mkdtempSync(join(tmpdir(), "sidecar-bind-"));
    const keys = generateKeyPairSync("ed25519");
    const pem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const running = await main({
      PORT: "0",
      HOST: "127.0.0.1",
      WORKLOAD_TOKEN: TOKEN,
      INTERNAL_RUNTIME_URL: "http://127.0.0.1:1",
      INTERNAL_RUNTIME_WORKLOAD_TOKEN: TOKEN,
      SCHEDULER_SIGNING_KEY: pem,
      USAGE_SIGNING_KEY: pem,
      ATTEMPT_STORE_PROFILE: "test",
      ATTEMPT_STORE_DB_PATH: join(dir, "attempts.db"),
    }, { localRuntime: true });
    runningServers.push(running);
    return { running, origin: `http://127.0.0.1:${running.port}` };
  }

  async function acceptAndReserve(origin: string, reservationId: string, requestId = "r") {
    const headers = { "content-type": "application/json", "x-lens-model-workload-token": TOKEN };
    await fetch(`${origin}/v1/attempts/accept`, {
      method: "POST", headers,
      body: JSON.stringify({
        reservation_id: reservationId, request_id: requestId, turn_id: "t", step_id: "s",
        request_digest: "digest", model_ref: "m", artifact_digest: `sha256:${"a".repeat(64)}`,
        endpoint_generation: "1", deadline_at: Date.now() + 30_000,
      }),
    });
    return fetch(`${origin}/v1/scheduler/reservations`, {
      method: "POST", headers,
      body: JSON.stringify({
        reservation_id: reservationId, request_id: requestId, turn_id: "t", step_id: "s",
        request_digest: "digest", model_ref: "m", artifact_digest: `sha256:${"a".repeat(64)}`,
        endpoint_ref: "ep", endpoint_generation: "1", expires_at: Date.now() + 30_000,
      }),
    }).then((r) => r.json() as Promise<{ fence: number; lease_token: string; expires_at: number; endpoint_ref: string }>);
  }

  const baseBody = (lease: { fence: number; lease_token: string; expires_at: number; endpoint_ref: string }, overrides: Record<string, unknown> = {}) => ({
    reservation_id: "reservation:bind",
    request_id: "r", turn_id: "t", step_id: "s", model_ref: "m",
    artifact_digest: `sha256:${"a".repeat(64)}`,
    endpoint_ref: lease.endpoint_ref, endpoint_generation: "1",
    request_digest: "digest", expires_at: lease.expires_at,
    fence: lease.fence, lease_token: lease.lease_token,
    ...overrides,
  });

  it("binds a correctly signed lease and persists the signed expiry", async () => {
    const { origin } = await start();
    const lease = await acceptAndReserve(origin, "reservation:bind");
    const res = await fetch(`${origin}/v1/attempts/bind-lease`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lens-model-workload-token": TOKEN },
      body: JSON.stringify(baseBody(lease)),
    });
    expect(res.status).toBe(200);
  });

  it("rejects a missing lease_token", async () => {
    const { origin } = await start();
    const lease = await acceptAndReserve(origin, "reservation:bind");
    const res = await fetch(`${origin}/v1/attempts/bind-lease`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lens-model-workload-token": TOKEN },
      body: JSON.stringify({ ...baseBody(lease), lease_token: "" }),
    });
    expect(res.status).toBe(409);
  });

  it("rejects a tampered/forged lease_token", async () => {
    const { origin } = await start();
    const lease = await acceptAndReserve(origin, "reservation:bind");
    const res = await fetch(`${origin}/v1/attempts/bind-lease`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lens-model-workload-token": TOKEN },
      body: JSON.stringify({ ...baseBody(lease), lease_token: "ar1.not-a-real-token.signature" }),
    });
    expect(res.status).toBe(409);
  });

  it("rejects when body.expires_at does not exactly equal the signed lease expiry", async () => {
    const { origin } = await start();
    const lease = await acceptAndReserve(origin, "reservation:bind");
    const res = await fetch(`${origin}/v1/attempts/bind-lease`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lens-model-workload-token": TOKEN },
      body: JSON.stringify({ ...baseBody(lease), expires_at: lease.expires_at + 1_000 }),
    });
    expect(res.status).toBe(409);
  });

  it("rejects a missing required field (artifact_digest)", async () => {
    const { origin } = await start();
    const lease = await acceptAndReserve(origin, "reservation:bind");
    const { artifact_digest: _artifactDigest, ...rest } = baseBody(lease);
    const res = await fetch(`${origin}/v1/attempts/bind-lease`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lens-model-workload-token": TOKEN },
      body: JSON.stringify(rest),
    });
    expect(res.status).toBe(409);
  });

  it("rejects a mismatched request_digest (bound digest does not recompute)", async () => {
    const { origin } = await start();
    const lease = await acceptAndReserve(origin, "reservation:bind");
    const res = await fetch(`${origin}/v1/attempts/bind-lease`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lens-model-workload-token": TOKEN },
      body: JSON.stringify({ ...baseBody(lease), request_digest: "tampered" }),
    });
    expect(res.status).toBe(409);
  });
});
