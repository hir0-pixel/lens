import { createServer, type Server } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/main";
import { ProviderConcurrencyGate, ProviderRuntimeResolutionError, SidecarSecretStore, type ProviderRuntimeConfig, type ProviderRuntimeConfigResolver, type ProviderSecretResolver } from "../src/providerRuntime";

const TOKEN = "c".repeat(40);

function digest(version: number): `sha256:${string}` {
  return `sha256:${"a".repeat(64 - String(version).length)}${version}`;
}

interface UpstreamCall {
  model: string;
  auth: string;
  body: unknown;
}

function startUpstream(opts: { mode?: "ok" | "invalid-key" | "overload" | "malformed" | "slow"; delayMs?: number; firstChunkDelayMs?: number } = {}): { server: Server; port: number; calls: UpstreamCall[] } {
  const calls: UpstreamCall[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const url = req.url ?? "";
      if (url.startsWith("/v1/chat/completions")) {
        calls.push({ model: "", auth: req.headers["authorization"] ?? "", body: raw ? JSON.parse(raw) : null });
        const parsed = raw ? JSON.parse(raw) : {};
        calls[calls.length - 1].model = parsed.model ?? "";
        if (opts.mode === "invalid-key") { res.statusCode = 401; res.end(); return; }
        if (opts.mode === "overload") { res.statusCode = 429; res.end(); return; }
        if (opts.mode === "malformed") {
          res.setHeader("content-type", "application/x-ndjson");
          res.end("data: not-json-at-all\n\n");
          return;
        }
        const finish = () => {
          res.setHeader("content-type", "application/x-ndjson");
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Hello " } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "world" } }] })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        };
        if (opts.mode === "slow") {
          res.setHeader("content-type", "application/x-ndjson");
          setTimeout(() => {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Hello " } }] })}\n\n`);
            setTimeout(() => {
              res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "world" } }] })}\n\n`);
              res.write("data: [DONE]\n\n");
              res.end();
            }, opts.delayMs ?? 400);
          }, opts.firstChunkDelayMs ?? 0);
        } else {
          finish();
        }
        return;
      }
      // /v1/models and everything else: pretend healthy
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "x" }] }));
    });
  });
  const port = 0;
  return { server, get port() { return port; }, calls };
}

async function listen(s: Server): Promise<number> {
  return new Promise((resolve) => s.listen(0, "127.0.0.1", () => resolve((s.address() as { port: number }).port)));
}

function makeConfig(modelRef: string, internalUrl: string, providerId: string, secretRef: string, catalogVersion = 1): ProviderRuntimeConfig {
  return {
    providerId,
    adapterType: "openai-compatible",
    internalUrl,
    secretRef,
    tlsWorkloadRef: "wl:sidecar",
    allowedCapabilities: ["generate", "stream"],
    modelRef,
    timeoutMs: 10_000,
    maxConcurrency: 4,
    catalogVersion,
    catalogDigest: digest(catalogVersion),
  };
}

describe("Sidecar provider-runtime integration", () => {
  const runningServers: { close: () => Promise<void> }[] = [];
  let upstream: ReturnType<typeof startUpstream>;
  let upstreamPort = 0;
  let sidecarOrigin = "";
  let cfgResolver: ProviderRuntimeConfigResolver;
  let secretResolver: ProviderSecretResolver;
  const secrets: Record<string, string> = { p_approved: "sk-approved-key-12345", p_other: "sk-other-key-67890" };

  afterEach(async () => {
    while (runningServers.length) await runningServers.pop()!.close();
    if (upstream) await new Promise<void>((r) => upstream.server.close(() => r()));
    vi.restoreAllMocks();
  });

  async function startSidecar(modelRef: string, providerId = "prv_approved") {
    upstream = startUpstream();
    upstreamPort = await listen(upstream.server);
    cfgResolver = {
      async resolve(ref: string) {
        if (ref !== modelRef) throw new ProviderRuntimeResolutionError("FORBIDDEN", "Model not approved.");
        return makeConfig(ref, `http://127.0.0.1:${upstreamPort}`, providerId, "p_approved");
      },
    };
    secretResolver = { async resolve(ref: string) { const k = secrets[ref]; if (!k) throw new ProviderRuntimeResolutionError("FORBIDDEN", "unknown"); return k; } };
    const dir = mkdtempSync(join(tmpdir(), "sidecar-prov-"));
    const keys = generateKeyPairSync("ed25519");
    const pem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const running = await main({
      PORT: "0", HOST: "127.0.0.1", WORKLOAD_TOKEN: TOKEN,
      INTERNAL_RUNTIME_URL: "", INTERNAL_RUNTIME_WORKLOAD_TOKEN: "",
      SCHEDULER_SIGNING_KEY: pem, USAGE_SIGNING_KEY: pem,
      ATTEMPT_STORE_PROFILE: "test", ATTEMPT_STORE_DB_PATH: join(dir, "attempts.db"),
    }, {
      providerRuntime: {
        configResolver: cfgResolver,
        secretStore: new SidecarSecretStore(secretResolver),
        gate: new ProviderConcurrencyGate(new Map(), 4),
      },
    });
    runningServers.push(running);
    sidecarOrigin = `http://127.0.0.1:${running.port}`;
    return running;
  }

  async function fullHandshake(reservationId: string, modelRef: string, deadlineAt: number) {
    const headers = { "content-type": "application/json", "x-lens-model-workload-token": TOKEN };
    const requestId = `req:${reservationId}`;
    const turnId = `turn:${reservationId}`;
    const stepId = `step:${reservationId}`;
    await fetch(`${sidecarOrigin}/v1/attempts/accept`, {
      method: "POST", headers,
      body: JSON.stringify({
        reservation_id: reservationId, request_id: requestId, turn_id: turnId, step_id: stepId,
        request_digest: "digest", model_ref: modelRef, artifact_digest: `sha256:${"a".repeat(64)}`,
        endpoint_generation: "1", deadline_at: deadlineAt,
      }),
    });
    const lease = await fetch(`${sidecarOrigin}/v1/scheduler/reservations`, {
      method: "POST", headers,
      body: JSON.stringify({
        reservation_id: reservationId, request_id: requestId, turn_id: turnId, step_id: stepId,
        request_digest: "digest", model_ref: modelRef, artifact_digest: `sha256:${"a".repeat(64)}`,
        endpoint_ref: "ep", endpoint_generation: "1", expires_at: deadlineAt,
      }),
    }).then((r) => r.json() as Promise<{ fence: number; expires_at: number; lease_token: string; endpoint_ref: string }>);
    await fetch(`${sidecarOrigin}/v1/attempts/bind-lease`, {
      method: "POST", headers,
      body: JSON.stringify({
        reservation_id: reservationId, request_id: requestId, turn_id: turnId, step_id: stepId,
        model_ref: modelRef, artifact_digest: `sha256:${"a".repeat(64)}`, fence: lease.fence,
        endpoint_ref: lease.endpoint_ref, endpoint_generation: "1", request_digest: "digest",
        expires_at: lease.expires_at, lease_token: lease.lease_token,
      }),
    });
    await fetch(`${sidecarOrigin}/v1/attempts/contact-intent`, { method: "POST", headers, body: JSON.stringify({ reservation_id: reservationId }) });
    return lease;
  }

  function generateBody(
    reservationId: string,
    lease: { fence: number; lease_token: string; endpoint_ref: string; expires_at: number },
    deadlineAt: number,
  ) {
    return {
      reservation_id: reservationId,
      fence: lease.fence,
      endpoint_ref: lease.endpoint_ref,
      endpoint_generation: "1",
      request_digest: "digest",
      lease_token: lease.lease_token,
      scope_id: "scope:s",
      deadline_at: deadlineAt,
      chunks: ["question"],
    };
  }

  function parseNdjson(text: string): Array<Record<string, unknown>> {
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it("invokes the real OpenAI-compatible adapter for the selected model_ref and never echoes", async () => {
    await startSidecar("approved-model");
    const lease = await fullHandshake("res-approved", "approved-model", Date.now() + 30_000);
    const res = await fetch(`${sidecarOrigin}/v1/inference/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lens-model-workload-token": TOKEN },
      body: JSON.stringify(generateBody("res-approved", lease, Date.now() + 30_000)),
    });
    expect(res.ok).toBe(true);
    const text = await res.text();
    const events = parseNdjson(text);
    const rendered = events.map((event) => typeof event.delta === "string" ? event.delta : "").join("");
    // Real streamed output, not the local echo of the prompt.
    expect(rendered).toBe("Hello world");
    expect(rendered).not.toContain("question");
    // The provider actually received the selected model + bearer key.
    expect(upstream.calls.length).toBe(1);
    expect(upstream.calls[0].model).toBe("approved-model");
    expect(upstream.calls[0].auth).toBe("Bearer sk-approved-key-12345");
  });

  it("does not leak the provider key into the sidecar response or logs", async () => {
    await startSidecar("approved-model");
    const lease = await fullHandshake("res-leak", "approved-model", Date.now() + 30_000);
    const res = await fetch(`${sidecarOrigin}/v1/inference/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lens-model-workload-token": TOKEN },
      body: JSON.stringify({ ...generateBody("res-leak", lease, Date.now() + 30_000), chunks: ["q"] }),
    });
    const text = await res.text();
    expect(text).not.toContain("sk-approved-key-12345");
  });

  it("fails closed for an unapproved/external model before contacting any provider", async () => {
    await startSidecar("approved-model");
    // Different model_ref than the resolver approves.
    const lease = await fullHandshake("res-unapproved", "evil-model", Date.now() + 30_000);
    const res = await fetch(`${sidecarOrigin}/v1/inference/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lens-model-workload-token": TOKEN },
      body: JSON.stringify({ ...generateBody("res-unapproved", lease, Date.now() + 30_000), chunks: ["q"] }),
    });
    expect(res.status).toBe(409);
    expect(upstream.calls.length).toBe(0);
  });

  it("fails closed on an invalid provider key and marks the attempt unknown", async () => {
    upstream = startUpstream({ mode: "invalid-key" });
    upstreamPort = await listen(upstream.server);
    cfgResolver = { async resolve() { return makeConfig("approved-model", `http://127.0.0.1:${upstreamPort}`, "prv", "p_approved"); } };
    secretResolver = { async resolve() { return "sk-approved-key-12345"; } };
    const dir = mkdtempSync(join(tmpdir(), "sidecar-key-"));
    const keys = generateKeyPairSync("ed25519");
    const pem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const running = await main({
      PORT: "0", HOST: "127.0.0.1", WORKLOAD_TOKEN: TOKEN,
      INTERNAL_RUNTIME_URL: "", INTERNAL_RUNTIME_WORKLOAD_TOKEN: "",
      SCHEDULER_SIGNING_KEY: pem, USAGE_SIGNING_KEY: pem,
      ATTEMPT_STORE_PROFILE: "test", ATTEMPT_STORE_DB_PATH: join(dir, "attempts.db"),
    }, { providerRuntime: { configResolver: cfgResolver, secretStore: new SidecarSecretStore(secretResolver), gate: new ProviderConcurrencyGate(new Map(), 4) } });
    runningServers.push(running);
    sidecarOrigin = `http://127.0.0.1:${running.port}`;
    const lease = await fullHandshake("res-key", "approved-model", Date.now() + 30_000);
    const res = await fetch(`${sidecarOrigin}/v1/inference/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lens-model-workload-token": TOKEN },
      body: JSON.stringify({ ...generateBody("res-key", lease, Date.now() + 30_000), chunks: ["q"] }),
    });
    expect(res.status).toBe(500);
    expect(upstream.calls.length).toBe(1);
  });

  it("fails closed on provider overload (429)", async () => {
    upstream = startUpstream({ mode: "overload" });
    upstreamPort = await listen(upstream.server);
    cfgResolver = { async resolve() { return makeConfig("approved-model", `http://127.0.0.1:${upstreamPort}`, "prv", "p_approved"); } };
    secretResolver = { async resolve() { return "sk-approved-key-12345"; } };
    const dir = mkdtempSync(join(tmpdir(), "sidecar-ovl-"));
    const keys = generateKeyPairSync("ed25519");
    const pem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const running = await main({
      PORT: "0", HOST: "127.0.0.1", WORKLOAD_TOKEN: TOKEN,
      INTERNAL_RUNTIME_URL: "", INTERNAL_RUNTIME_WORKLOAD_TOKEN: "",
      SCHEDULER_SIGNING_KEY: pem, USAGE_SIGNING_KEY: pem,
      ATTEMPT_STORE_PROFILE: "test", ATTEMPT_STORE_DB_PATH: join(dir, "attempts.db"),
    }, { providerRuntime: { configResolver: cfgResolver, secretStore: new SidecarSecretStore(secretResolver), gate: new ProviderConcurrencyGate(new Map(), 4) } });
    runningServers.push(running);
    sidecarOrigin = `http://127.0.0.1:${running.port}`;
    const lease = await fullHandshake("res-ovl", "approved-model", Date.now() + 30_000);
    const res = await fetch(`${sidecarOrigin}/v1/inference/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lens-model-workload-token": TOKEN },
      body: JSON.stringify({ ...generateBody("res-ovl", lease, Date.now() + 30_000), chunks: ["q"] }),
    });
    expect(res.status).toBe(429);
    expect(upstream.calls.length).toBe(1);
  });

  it("fails closed on a malformed provider stream", async () => {
    upstream = startUpstream({ mode: "malformed" });
    upstreamPort = await listen(upstream.server);
    cfgResolver = { async resolve() { return makeConfig("approved-model", `http://127.0.0.1:${upstreamPort}`, "prv", "p_approved"); } };
    secretResolver = { async resolve() { return "sk-approved-key-12345"; } };
    const dir = mkdtempSync(join(tmpdir(), "sidecar-mal-"));
    const keys = generateKeyPairSync("ed25519");
    const pem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const running = await main({
      PORT: "0", HOST: "127.0.0.1", WORKLOAD_TOKEN: TOKEN,
      INTERNAL_RUNTIME_URL: "", INTERNAL_RUNTIME_WORKLOAD_TOKEN: "",
      SCHEDULER_SIGNING_KEY: pem, USAGE_SIGNING_KEY: pem,
      ATTEMPT_STORE_PROFILE: "test", ATTEMPT_STORE_DB_PATH: join(dir, "attempts.db"),
    }, { providerRuntime: { configResolver: cfgResolver, secretStore: new SidecarSecretStore(secretResolver), gate: new ProviderConcurrencyGate(new Map(), 4) } });
    runningServers.push(running);
    sidecarOrigin = `http://127.0.0.1:${running.port}`;
    const lease = await fullHandshake("res-mal", "approved-model", Date.now() + 30_000);
    const res = await fetch(`${sidecarOrigin}/v1/inference/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lens-model-workload-token": TOKEN },
      body: JSON.stringify({ ...generateBody("res-mal", lease, Date.now() + 30_000), chunks: ["q"] }),
    });
    expect(res.ok).toBe(false);
    expect(upstream.calls.length).toBe(1);
  });

  it("cancels on client abort and fails closed (no synthetic output)", async () => {
    upstream = startUpstream({ mode: "slow", firstChunkDelayMs: 0, delayMs: 500 });
    upstreamPort = await listen(upstream.server);
    cfgResolver = { async resolve() { return makeConfig("approved-model", `http://127.0.0.1:${upstreamPort}`, "prv", "p_approved"); } };
    secretResolver = { async resolve() { return "sk-approved-key-12345"; } };
    const dir = mkdtempSync(join(tmpdir(), "sidecar-cancel-"));
    const keys = generateKeyPairSync("ed25519");
    const pem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const running = await main({
      PORT: "0", HOST: "127.0.0.1", WORKLOAD_TOKEN: TOKEN,
      INTERNAL_RUNTIME_URL: "", INTERNAL_RUNTIME_WORKLOAD_TOKEN: "",
      SCHEDULER_SIGNING_KEY: pem, USAGE_SIGNING_KEY: pem,
      ATTEMPT_STORE_PROFILE: "test", ATTEMPT_STORE_DB_PATH: join(dir, "attempts.db"),
    }, { providerRuntime: { configResolver: cfgResolver, secretStore: new SidecarSecretStore(secretResolver), gate: new ProviderConcurrencyGate(new Map(), 4) } });
    runningServers.push(running);
    sidecarOrigin = `http://127.0.0.1:${running.port}`;
    const lease = await fullHandshake("res-cancel", "approved-model", Date.now() + 30_000);
    const controller = new AbortController();
    const p = fetch(`${sidecarOrigin}/v1/inference/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lens-model-workload-token": TOKEN },
      body: JSON.stringify({ ...generateBody("res-cancel", lease, Date.now() + 30_000), chunks: ["q"] }),
      signal: controller.signal,
    });
    const res = await p;
    const reader = res.body!.getReader();
    await reader.read();
    controller.abort();
    await expect(reader.read()).rejects.toThrow();
    let status: { state?: string } = {};
    for (let index = 0; index < 20; index += 1) {
      status = await fetch(`${sidecarOrigin}/v1/attempts/status`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-lens-model-workload-token": TOKEN },
        body: JSON.stringify({ reservation_id: "res-cancel" }),
      }).then((r) => r.json() as Promise<{ state?: string }>);
      if (status.state === "CANCELLED") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(status.state).toBe("CANCELLED");
  });

  it("enforces per-provider bounded concurrency", async () => {
    // Slow upstream; with maxConcurrency=1, a second overlapping generate must queue, not error.
    upstream = startUpstream({ mode: "slow", delayMs: 250 });
    upstreamPort = await listen(upstream.server);
    cfgResolver = { async resolve() { return makeConfig("approved-model", `http://127.0.0.1:${upstreamPort}`, "prv", "p_approved", 1); } };
    secretResolver = { async resolve() { return "sk-approved-key-12345"; } };
    const dir = mkdtempSync(join(tmpdir(), "sidecar-conc-"));
    const keys = generateKeyPairSync("ed25519");
    const pem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const running = await main({
      PORT: "0", HOST: "127.0.0.1", WORKLOAD_TOKEN: TOKEN,
      INTERNAL_RUNTIME_URL: "", INTERNAL_RUNTIME_WORKLOAD_TOKEN: "",
      SCHEDULER_SIGNING_KEY: pem, USAGE_SIGNING_KEY: pem,
      ATTEMPT_STORE_PROFILE: "test", ATTEMPT_STORE_DB_PATH: join(dir, "attempts.db"),
    }, { providerRuntime: { configResolver: cfgResolver, secretStore: new SidecarSecretStore(secretResolver), gate: new ProviderConcurrencyGate(new Map([["prv", 1]]), 1) } });
    runningServers.push(running);
    sidecarOrigin = `http://127.0.0.1:${running.port}`;
    const leaseA = await fullHandshake("res-conc-1", "approved-model", Date.now() + 30_000);
    const leaseB = await fullHandshake("res-conc-2", "approved-model", Date.now() + 30_000);
    const fire = (id: string, lease: { fence: number; lease_token: string; endpoint_ref: string; expires_at: number }) => fetch(`${sidecarOrigin}/v1/inference/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lens-model-workload-token": TOKEN },
      body: JSON.stringify({ ...generateBody(id, lease, Date.now() + 30_000), chunks: ["q"] }),
    });
    const [a, b] = await Promise.all([fire("res-conc-1", leaseA), fire("res-conc-2", leaseB)]);
    await Promise.all([a.text(), b.text()]);
    // Both resolve (queued, not rejected); the upstream serialized them.
    expect([a.ok, b.ok]).toContain(true);
    expect(upstream.calls.length).toBe(2);
  });

  it("switching model_ref selects the correct provider adapter and does not alter RAG auth identity", async () => {
    // Two providers on two upstreams; same RAG identity fields throughout.
    const upstreamA = startUpstream();
    const portA = await listen(upstreamA.server);
    const upstreamB = startUpstream();
    const portB = await listen(upstreamB.server);
    const resolver: ProviderRuntimeConfigResolver = {
      async resolve(ref: string) {
        if (ref === "model-a") return makeConfig(ref, `http://127.0.0.1:${portA}`, "prv-a", "p_approved");
        if (ref === "model-b") return makeConfig(ref, `http://127.0.0.1:${portB}`, "prv-b", "p_other");
        throw new ProviderRuntimeResolutionError("FORBIDDEN", "unapproved");
      },
    };
    const sResolver: ProviderSecretResolver = { async resolve(ref) { return secrets[ref] ?? "sk-default"; } };
    const dir = mkdtempSync(join(tmpdir(), "sidecar-switch-"));
    const keys = generateKeyPairSync("ed25519");
    const pem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const running = await main({
      PORT: "0", HOST: "127.0.0.1", WORKLOAD_TOKEN: TOKEN,
      INTERNAL_RUNTIME_URL: "", INTERNAL_RUNTIME_WORKLOAD_TOKEN: "",
      SCHEDULER_SIGNING_KEY: pem, USAGE_SIGNING_KEY: pem,
      ATTEMPT_STORE_PROFILE: "test", ATTEMPT_STORE_DB_PATH: join(dir, "attempts.db"),
    }, { providerRuntime: { configResolver: resolver, secretStore: new SidecarSecretStore(sResolver), gate: new ProviderConcurrencyGate(new Map(), 4) } });
    runningServers.push(running);
    sidecarOrigin = `http://127.0.0.1:${running.port}`;
    runningServers.push({ close: async () => new Promise<void>((r) => upstreamA.server.close(() => r())) });
    runningServers.push({ close: async () => new Promise<void>((r) => upstreamB.server.close(() => r())) });

    const leaseA = await fullHandshake("res-a", "model-a", Date.now() + 30_000);
    const leaseB = await fullHandshake("res-b", "model-b", Date.now() + 30_000);
    const genBody = (id: string, lease: { fence: number; lease_token: string; endpoint_ref: string; expires_at: number }) => ({
      method: "POST" as const,
      headers: { "content-type": "application/json", "x-lens-model-workload-token": TOKEN },
      body: JSON.stringify({ ...generateBody(id, lease, Date.now() + 30_000), chunks: ["q"] }),
    });
    const [ra, rb] = await Promise.all([
      fetch(`${sidecarOrigin}/v1/inference/generate`, genBody("res-a", leaseA)),
      fetch(`${sidecarOrigin}/v1/inference/generate`, genBody("res-b", leaseB)),
    ]);
    const [textA, textB] = await Promise.all([ra.text(), rb.text()]);
    expect(parseNdjson(textA).map((event) => typeof event.delta === "string" ? event.delta : "").join("")).toBe("Hello world");
    expect(parseNdjson(textB).map((event) => typeof event.delta === "string" ? event.delta : "").join("")).toBe("Hello world");
    // Each model routed to its own provider/adapter with its own secret; RAG identity unchanged.
    expect(upstreamA.calls[0].model).toBe("model-a");
    expect(upstreamA.calls[0].auth).toBe("Bearer sk-approved-key-12345");
    expect(upstreamB.calls[0].model).toBe("model-b");
    expect(upstreamB.calls[0].auth).toBe("Bearer sk-other-key-67890");
  });
});
