import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/main";

const TOKEN = "c".repeat(40);

describe("Runtime adapter sidecar", () => {
  it("starts with a development attempt store and local runtime", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sidecar-"));
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
    await running.close();
  });

  it("streams locally measured usage and rejects a missing scheduler lease", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sidecar-stream-"));
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
    const origin = `http://127.0.0.1:${running.port}`;
    const headers = { "content-type": "application/json", "x-lens-model-workload-token": TOKEN };
    const reservationId = "reservation:stream";
    await fetch(`${origin}/v1/attempts/accept`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        reservation_id: reservationId,
        request_id: "r",
        turn_id: "t",
        step_id: "s",
        request_digest: "digest",
        model_ref: "m",
        artifact_digest: `sha256:${"a".repeat(64)}`,
        endpoint_generation: "1",
        deadline_at: Date.now() + 30_000,
      }),
    });
    const lease = await fetch(`${origin}/v1/scheduler/reservations`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        reservation_id: reservationId,
        request_id: "r",
        turn_id: "t",
        step_id: "s",
        request_digest: "digest",
        model_ref: "m",
        artifact_digest: `sha256:${"a".repeat(64)}`,
        endpoint_ref: "ep",
        endpoint_generation: "1",
        expires_at: Date.now() + 30_000,
      }),
    }).then((response) => response.json() as Promise<{ fence: number; expires_at: number; lease_token: string; endpoint_ref: string }>);
    await fetch(`${origin}/v1/attempts/bind-lease`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        reservation_id: reservationId,
        request_id: "r",
        turn_id: "t",
        step_id: "s",
        model_ref: "m",
        artifact_digest: `sha256:${"a".repeat(64)}`,
        fence: lease.fence,
        endpoint_ref: lease.endpoint_ref,
        endpoint_generation: "1",
        request_digest: "digest",
        expires_at: lease.expires_at,
        lease_token: lease.lease_token,
      }),
    });
    await fetch(`${origin}/v1/attempts/contact-intent`, {
      method: "POST",
      headers,
      body: JSON.stringify({ reservation_id: reservationId }),
    });
    const denied = await fetch(`${origin}/v1/inference/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        reservation_id: reservationId,
        fence: lease.fence,
        endpoint_ref: "ep",
        scope_id: "scope:s",
        deadline_at: Date.now() + 30_000,
        chunks: ["hello "],
      }),
    });
    expect(denied.status).toBe(409);
    const streamed = await fetch(`${origin}/v1/inference/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        reservation_id: reservationId,
        fence: lease.fence,
        endpoint_ref: "ep",
        endpoint_generation: "1",
        request_digest: "digest",
        lease_token: lease.lease_token,
        scope_id: "scope:s",
        deadline_at: Date.now() + 30_000,
        chunks: ["hello "],
      }),
    });
    expect(streamed.headers.get("content-type")).toContain("ndjson");
    const body = await streamed.text();
    expect(body).toContain("hello");
    expect(body).toContain("usage_signature");
    const oversizedId = "reservation:oversize";
    await fetch(`${origin}/v1/attempts/accept`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        reservation_id: oversizedId,
        request_id: "r2",
        turn_id: "t",
        step_id: "s",
        request_digest: "digest",
        model_ref: "m",
        artifact_digest: `sha256:${"a".repeat(64)}`,
        endpoint_generation: "1",
        deadline_at: Date.now() + 30_000,
      }),
    });
    const lease2 = await fetch(`${origin}/v1/scheduler/reservations`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        reservation_id: oversizedId,
        request_id: "r2",
        turn_id: "t",
        step_id: "s",
        request_digest: "digest",
        model_ref: "m",
        artifact_digest: `sha256:${"a".repeat(64)}`,
        endpoint_ref: "ep",
        endpoint_generation: "1",
        expires_at: Date.now() + 30_000,
      }),
    }).then((response) => response.json() as Promise<{ fence: number; expires_at: number; lease_token: string; endpoint_ref: string }>);
    await fetch(`${origin}/v1/attempts/bind-lease`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        reservation_id: oversizedId,
        request_id: "r2",
        turn_id: "t",
        step_id: "s",
        model_ref: "m",
        artifact_digest: `sha256:${"a".repeat(64)}`,
        fence: lease2.fence,
        endpoint_ref: lease2.endpoint_ref,
        endpoint_generation: "1",
        request_digest: "digest",
        expires_at: lease2.expires_at,
        lease_token: lease2.lease_token,
      }),
    });
    await fetch(`${origin}/v1/attempts/contact-intent`, {
      method: "POST",
      headers,
      body: JSON.stringify({ reservation_id: oversizedId }),
    });
    const oversized = await fetch(`${origin}/v1/inference/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        reservation_id: oversizedId,
        fence: lease2.fence,
        endpoint_ref: "ep",
        endpoint_generation: "1",
        request_digest: "digest",
        lease_token: lease2.lease_token,
        scope_id: "scope:s",
        deadline_at: Date.now() + 30_000,
        chunks: ["x".repeat(70 * 1024)],
      }),
    });
    expect(oversized.ok).toBe(true);
    expect(await oversized.text()).toContain("\"terminal\":\"failed\"");
    await running.close();
  });
});
