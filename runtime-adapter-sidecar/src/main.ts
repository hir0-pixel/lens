import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign } from "node:crypto";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AuthorityReceiptIssuer, Ed25519ReceiptVerifier, type AuthorityReceiptClaims } from "../../services/security/authorityReceipt";
import { GpuScheduler, type SchedulerReserveInput } from "../../services/gpu-scheduler/GpuScheduler";
import { SqlGpuScheduler } from "../../services/gpu-scheduler/SqlGpuScheduler";
import { InferenceAdapter } from "../../services/inference-adapter/InferenceAdapter";
import { measureOutputUnits, USAGE_SCHEMA_VERSION } from "../../services/inference-adapter/localMeter";
import { RelationalRuntimeAttemptStore } from "../../services/runtime-attempt/RelationalRuntimeAttemptStore";
import type { RuntimeAttemptState } from "../../services/runtime-attempt/RuntimeAttemptStore";
import { PostgresPool, createSqlitePgCompatPool, type PgPool } from "../../services/storage/pgPool";
import { createInternalServiceHttp } from "../../services/internal-http/internalServiceHttp";
import { assertInternalOrigin, assertWorkloadToken, deadlineSignal, readBoundedJson, type FetchPort } from "../../services/internal-http/internalHttp";
import { canonicalJson } from "../../services/security/canonicalJson";
import type { SecretStore } from "../../services/secrets/SecretStore";
import {
  HttpProviderRuntimeConfigResolver,
  HttpProviderSecretResolver,
  ProviderConcurrencyGate,
  ProviderRuntimeResolutionError,
  PROVIDER_CAPABILITY,
  type ProviderIdentityBinding,
  type ProviderRuntimeConfigResolver,
  type ProviderSecretResolver,
  runProviderGeneration,
  SidecarSecretStore,
} from "./providerRuntime";

const MAX_STREAM_BYTES = 64 * 1024;

export interface RuntimeAdapterEnv {
  PORT?: string;
  HOST?: string;
  WORKLOAD_TOKEN: string;
  INTERNAL_RUNTIME_URL: string;
  INTERNAL_RUNTIME_WORKLOAD_TOKEN: string;
  /** Internal server-to-server provider-runtime config resolver (non-secret config only). */
  PROVIDER_RUNTIME_CONFIG_URL?: string;
  PROVIDER_RUNTIME_CONFIG_TOKEN?: string;
  PROVIDER_SECRET_URL?: string;
  PROVIDER_SECRET_TOKEN?: string;
  /** Explicitly-gated lab/legacy mode that still permits the legacy InternalRuntimeClient. Never enabled in sovereign production. */
  RUNTIME_LAB_MODE?: string;
  SCHEDULER_SIGNING_KEY?: string;
  USAGE_SIGNING_KEY?: string;
  ATTEMPT_STORE_PROFILE?: string;
  ATTEMPT_STORE_DB_PATH?: string;
  ATTEMPT_STORE_DATABASE_URL?: string;
  GPU_CAPACITY?: string;
  SCHEDULER_CELL_ID?: string;
}

function loadEnv(): RuntimeAdapterEnv {
  return {
    PORT: process.env.PORT ?? "8793",
    HOST: process.env.HOST ?? "127.0.0.1",
    WORKLOAD_TOKEN: process.env.LENS_RUNTIME_ADAPTER_WORKLOAD_TOKEN ?? "",
    INTERNAL_RUNTIME_URL: process.env.LENS_INTERNAL_RUNTIME_URL ?? "",
    INTERNAL_RUNTIME_WORKLOAD_TOKEN: process.env.LENS_INTERNAL_RUNTIME_WORKLOAD_TOKEN ?? "",
    PROVIDER_RUNTIME_CONFIG_URL: process.env.LENS_PROVIDER_RUNTIME_CONFIG_URL,
    PROVIDER_RUNTIME_CONFIG_TOKEN: process.env.LENS_PROVIDER_RUNTIME_CONFIG_TOKEN,
    PROVIDER_SECRET_URL: process.env.LENS_PROVIDER_SECRET_URL,
    PROVIDER_SECRET_TOKEN: process.env.LENS_PROVIDER_SECRET_TOKEN,
    RUNTIME_LAB_MODE: process.env.LENS_RUNTIME_LAB_MODE,
    SCHEDULER_SIGNING_KEY: process.env.LENS_SCHEDULER_SIGNING_KEY,
    USAGE_SIGNING_KEY: process.env.LENS_USAGE_SIGNING_KEY,
    ATTEMPT_STORE_PROFILE: process.env.LENS_ATTEMPT_STORE_PROFILE,
    ATTEMPT_STORE_DB_PATH: process.env.LENS_ATTEMPT_STORE_DB_PATH,
    ATTEMPT_STORE_DATABASE_URL: process.env.LENS_ATTEMPT_STORE_DATABASE_URL,
    GPU_CAPACITY: process.env.LENS_GPU_CAPACITY,
    SCHEDULER_CELL_ID: process.env.LENS_SCHEDULER_CELL_ID,
  };
}

function pem(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required.`);
  return value.includes("BEGIN") ? value : readFileSync(value, "utf8");
}

function parseProfile(value: string | undefined): "development" | "test" | "production" {
  if (value === "development" || value === "test" || value === "production") return value;
  throw new Error("LENS_ATTEMPT_STORE_PROFILE must be development, test, or production.");
}

function signUsage(privatePem: string, payload: Record<string, unknown>): string {
  const key = createPrivateKey(privatePem);
  return cryptoSign(null, Buffer.from(canonicalJson(payload), "utf8"), key).toString("base64url");
}

async function writeNdjson(res: ServerResponse, payload: Record<string, unknown>): Promise<void> {
  if (res.destroyed || res.writableEnded) return;
  const line = `${JSON.stringify(payload)}\n`;
  if (!res.write(line)) await once(res, "drain");
}

class InternalRuntimeClient {
  private readonly origin: URL;
  constructor(url: string, private readonly token: string, private readonly fetcher: FetchPort = fetch) {
    this.origin = assertInternalOrigin(url, "LENS_INTERNAL_RUNTIME_URL");
    assertWorkloadToken(token, "LENS_INTERNAL_RUNTIME_WORKLOAD_TOKEN");
  }
  async *stream(input: { reservationId: string; fence: number; endpointRef: string; scopeId: string; deadlineAt: number; chunks: readonly string[] }, signal: AbortSignal): AsyncGenerator<string> {
    const response = await this.fetcher(new URL("/v1/inference/generate", this.origin), {
      method: "POST",
      headers: { "content-type": "application/json", "x-lens-model-workload-token": this.token },
      body: JSON.stringify({
        reservation_id: input.reservationId,
        fence: input.fence,
        endpoint_ref: input.endpointRef,
        scope_id: input.scopeId,
        deadline_at: input.deadlineAt,
        chunks: input.chunks,
      }),
      signal: deadlineSignal(signal, input.deadlineAt),
    });
    if (response.status >= 400 && response.status < 500) throw new Error("STALE_FENCE");
    if (!response.ok) throw new Error("DEPENDENCY_UNAVAILABLE");
    const payload = await readBoundedJson(response) as Record<string, unknown>;
    if (typeof payload.output !== "string") throw new Error("DEPENDENCY_UNAVAILABLE");
    yield payload.output;
  }
}

/**
 * Truthful readiness for the sidecar. Development/test preserve the prior "ready once
 * startup finished" behavior. Production must reflect real scheduler/store availability
 * and a configured internal runtime health contract; when the runtime has no health
 * endpoint (or is unreachable) we fail closed rather than advertising a healthy dependency
 * we cannot prove. `storeReady`/`fetchFn` are injectable so this can be unit-tested without
 * standing up a real PostgreSQL instance.
 */
export async function evaluateSidecarReadiness(opts: {
  profile: "development" | "test" | "production";
  storeReady: () => Promise<boolean>;
  runtimeHealthUrl?: string;
  fetchFn?: typeof fetch;
}): Promise<boolean> {
  if (opts.profile !== "production") return true;
  if (!(await opts.storeReady())) return false;
  if (!opts.runtimeHealthUrl) return false;
  const doFetch = opts.fetchFn ?? fetch;
  try {
    const res = await doFetch(opts.runtimeHealthUrl, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

export interface ProviderRuntimeDependencies {
  configResolver: ProviderRuntimeConfigResolver;
  secretStore: SecretStore;
  gate: ProviderConcurrencyGate;
}

export async function main(
  env: RuntimeAdapterEnv = loadEnv(),
  options: {
    localRuntime?: boolean;
    providerRuntime?: ProviderRuntimeDependencies;
    providerRuntimeConfigResolver?: ProviderRuntimeConfigResolver;
    providerSecretResolver?: ProviderSecretResolver;
  } = {},
): Promise<{ close: () => Promise<void>; port: number }> {
  if (env.WORKLOAD_TOKEN.length < 32) throw new Error("LENS_RUNTIME_ADAPTER_WORKLOAD_TOKEN must contain at least 32 characters.");
  const profile = parseProfile(env.ATTEMPT_STORE_PROFILE);
  const schedulerKey = pem(env.SCHEDULER_SIGNING_KEY, "LENS_SCHEDULER_SIGNING_KEY");
  const schedulerIssuer = new AuthorityReceiptIssuer(schedulerKey);
  const leaseVerifier = new Ed25519ReceiptVerifier(createPublicKey(schedulerKey));
  const usageKey = pem(env.USAGE_SIGNING_KEY, "LENS_USAGE_SIGNING_KEY");

  let pool: PgPool;
  let postgres: PostgresPool | undefined;
  if (profile === "production") {
    if (!env.ATTEMPT_STORE_DATABASE_URL) throw new Error("Production RuntimeAttemptStore requires LENS_ATTEMPT_STORE_DATABASE_URL.");
    if (env.ATTEMPT_STORE_DB_PATH) throw new Error("SQLite RuntimeAttemptStore is development/test-only.");
    if (!env.SCHEDULER_CELL_ID) throw new Error("Production scheduler requires LENS_SCHEDULER_CELL_ID.");
    postgres = new PostgresPool(env.ATTEMPT_STORE_DATABASE_URL);
    await postgres.connect();
    if (!(await postgres.ready())) throw new Error("RuntimeAttemptStore PostgreSQL is not ready.");
    pool = postgres;
  } else {
    if (!env.ATTEMPT_STORE_DB_PATH) throw new Error(`LENS_ATTEMPT_STORE_DB_PATH is required for ${profile}.`);
    pool = createSqlitePgCompatPool(env.ATTEMPT_STORE_DB_PATH);
  }
  const attempts = new RelationalRuntimeAttemptStore(pool);
  await attempts.ready();
  const sqlScheduler = profile === "production" ? new SqlGpuScheduler(pool, schedulerIssuer, env.SCHEDULER_CELL_ID!, Number(env.GPU_CAPACITY ?? "8")) : undefined;
  await sqlScheduler?.ready();
  const memoryScheduler = sqlScheduler ? undefined : new GpuScheduler(Number(env.GPU_CAPACITY ?? "8"), () => Date.now(), schedulerIssuer);

  const local = new InferenceAdapter();

  // The governed, sovereign path: resolve an approved provider-runtime config (non-secret)
  // and stream real generation through the canonical OpenAICompatibleAdapter. Configured via
  // workload-authenticated internal server-to-server resolution (env) or injected in tests.
  let providerRuntime: ProviderRuntimeDependencies | undefined = options.providerRuntime;
  if (
    !providerRuntime &&
    env.PROVIDER_RUNTIME_CONFIG_URL &&
    env.PROVIDER_RUNTIME_CONFIG_TOKEN &&
    env.PROVIDER_SECRET_URL &&
    env.PROVIDER_SECRET_TOKEN
  ) {
    const configResolver = options.providerRuntimeConfigResolver ?? new HttpProviderRuntimeConfigResolver(env.PROVIDER_RUNTIME_CONFIG_URL, env.PROVIDER_RUNTIME_CONFIG_TOKEN);
    const secretResolver = options.providerSecretResolver ?? new HttpProviderSecretResolver(env.PROVIDER_SECRET_URL, env.PROVIDER_SECRET_TOKEN);
    providerRuntime = { configResolver, secretStore: new SidecarSecretStore(secretResolver), gate: new ProviderConcurrencyGate(new Map()) };
  }

  // The legacy InternalRuntimeClient (a separate control-plane runtime) is only reachable in an
  // explicitly gated lab/legacy mode and never when the governed provider path is configured.
  const labMode = env.RUNTIME_LAB_MODE === "1";
  const remote = !providerRuntime && !options.localRuntime && labMode && env.INTERNAL_RUNTIME_URL
    ? new InternalRuntimeClient(env.INTERNAL_RUNTIME_URL, env.INTERNAL_RUNTIME_WORKLOAD_TOKEN)
    : undefined;

  // Provider catalog identity bound to each reservation (lease) identity. Resolved at accept and
  // re-checked at generate so a disabled/stale/version-drifted provider fails closed.
  const providerIdentityBinding = new Map<string, ProviderIdentityBinding>();
  const reconcileTimer = setInterval(() => {
    void attempts.reconcileExpired(Date.now());
    void sqlScheduler?.reclaim(Date.now());
  }, 5_000);
  reconcileTimer.unref();

  const generateStream = async (body: Record<string, unknown>, res: ServerResponse, req: IncomingMessage): Promise<void> => {
    const reservationId = String(body.reservation_id);
    const leaseToken = String(body.lease_token ?? "");
    const status = await attempts.getAttemptStatus(reservationId).catch(() => undefined);
    if (!status || status.state === "OUTCOME_UNKNOWN") throw new Error("OUTCOME_UNKNOWN");
    if (status.state !== "CONTACT_INTENT_COMMITTED" && status.state !== "RUNTIME_STARTED" && status.state !== "STREAMING") {
      throw new Error("STALE_FENCE");
    }
    if (!leaseToken) throw new Error("STALE_FENCE");
    const lease = leaseVerifier.verify(leaseToken, {
      purpose: "scheduler_lease",
      issuer: "authority-scheduler",
      requestId: status.requestId,
      turnId: status.turnId,
      stepId: status.stepId,
      reservationRef: reservationId,
      modelRef: status.modelRef,
      artifactDigest: status.artifactDigest as `sha256:${string}`,
      revision: status.fence,
    });
    const expectedBound = `sha256:${createHash("sha256").update(`${status.requestDigest}|${status.endpointRef}|${status.endpointGeneration}|${status.artifactDigest}`).digest("hex")}`;
    if (lease.boundDigest !== expectedBound) throw new Error("STALE_FENCE");
    if (!Number.isFinite(Number(body.fence)) || Number(body.fence) !== status.fence) throw new Error("STALE_FENCE");
    if (!body.endpoint_ref || !body.endpoint_generation || !body.request_digest) throw new Error("STALE_FENCE");
    if (status.endpointRef !== String(body.endpoint_ref)) throw new Error("STALE_FENCE");
    if (status.endpointGeneration !== String(body.endpoint_generation)) throw new Error("STALE_FENCE");
    if (status.requestDigest !== String(body.request_digest)) throw new Error("STALE_FENCE");
    if ((status.leaseExpiresAt ?? 0) > 0 && status.leaseExpiresAt! <= Date.now()) throw new Error("STALE_FENCE");
    if (status.state === "CONTACT_INTENT_COMMITTED") await attempts.transitionTo(reservationId, "RUNTIME_STARTED");
    await attempts.transitionTo(reservationId, "STREAMING").catch(() => undefined);

    const chunks = Array.isArray(body.chunks) ? body.chunks.map(String) : [];
    const executeInput = {
      reservationId,
      fence: Number(body.fence),
      endpointRef: String(body.endpoint_ref ?? status.endpointRef ?? ""),
      scopeId: String(body.scope_id),
      deadlineAt: Number(body.deadline_at),
      chunks,
    };
    const openStream = async (): Promise<void> => {
      if (res.headersSent) return;
      res.writeHead(200, {
        "content-type": "application/x-ndjson",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
    };
    let output = "";
    const runSignal = new AbortController();
    res.on("close", () => { if (!res.writableEnded) runSignal.abort(); });
    req.on("aborted", () => runSignal.abort());
    req.on("close", () => { if (!res.writableEnded) runSignal.abort(); });

    const persistMeasured = async (terminal: "completed" | "cancelled" | "failed"): Promise<void> => {
      const measuredUnits = measureOutputUnits(output);
      const usageEventId = `usage:${reservationId}:${body.fence}`;
      const usagePayload = {
        schemaVersion: USAGE_SCHEMA_VERSION,
        reservationId,
        requestId: status.requestId,
        turnId: status.turnId,
        stepId: status.stepId,
        fence: status.fence,
        artifactDigest: status.artifactDigest,
        endpointGeneration: status.endpointGeneration,
        usageEventId,
        measuredUnits,
        terminal,
      };
      const signature = signUsage(usageKey, usagePayload);
      const terminalState = terminal === "cancelled" ? "CANCELLED" : terminal === "failed" ? "FAILED" : "COMPLETED";
      await attempts.completeWithUsage(reservationId, {
        usageEventId,
        generatedTokens: measuredUnits,
        signature,
        terminal: terminalState,
      });
      await writeNdjson(res, {
        done: true,
        receipt: {
          reservation_id: reservationId,
          fence: Number(body.fence),
          scope_id: String(body.scope_id),
          usage_event_id: usageEventId,
          generated_tokens: measuredUnits,
          measured_units: measuredUnits,
          terminal,
          usage_signature: signature,
          schema_version: USAGE_SCHEMA_VERSION,
          request_id: status.requestId,
          turn_id: status.turnId,
          step_id: status.stepId,
          artifact_digest: status.artifactDigest,
          endpoint_generation: status.endpointGeneration,
        },
      });
    };

    try {
      let stream: AsyncGenerator<string>;
      if (providerRuntime) {
        // Governed path: real OpenAI-compatible streaming generation for the employee-selected
        // approved model_ref. Rejects stale/disabled/unapproved/capability-mismatched config.
        stream = runProviderGeneration({
          resolver: providerRuntime.configResolver,
          secretStore: providerRuntime.secretStore,
          concurrency: providerRuntime.gate,
          modelRef: status.modelRef,
          capability: PROVIDER_CAPABILITY,
          chunks,
          deadlineAt: executeInput.deadlineAt,
          signal: runSignal.signal,
          adapterProfile: profile === "production" ? "sovereign" : "development",
          expectedCatalog: providerIdentityBinding.get(reservationId),
        });
      } else if (local) {
        stream = local.stream(executeInput, runSignal.signal);
      } else if (remote) {
        stream = remote.stream(executeInput, deadlineSignal(runSignal.signal, executeInput.deadlineAt));
      } else {
        throw new Error("DEPENDENCY_UNAVAILABLE");
      }
      const iterator = stream[Symbol.asyncIterator]();
      let first = await iterator.next();
      if (!first.done) {
        await openStream();
      }
      while (!first.done) {
        if (runSignal.signal.aborted) throw new Error("CANCELLED");
        const delta = first.value;
        const next = output + delta;
        if (Buffer.byteLength(next, "utf8") > MAX_STREAM_BYTES) throw new Error("OUTPUT_TOO_LARGE");
        output = next;
        await writeNdjson(res, { delta });
        first = await iterator.next();
      }
      if (!res.headersSent) {
        await openStream();
      }
      await persistMeasured("completed");
      res.end();
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[runtime-generate] ${detail}`);
      }
      const message = error instanceof Error ? error.message : "";
      if (message === "CANCELLED") {
        await persistMeasured("cancelled").catch(() => undefined);
        if (!res.writableEnded) res.end();
        return;
      }
      if (message === "OUTPUT_TOO_LARGE") {
        await persistMeasured("failed").catch(() => undefined);
        if (!res.writableEnded) res.end();
        return;
      }
      await attempts.markOutcomeUnknown(reservationId).catch(() => undefined);
      throw error;
    }
  };

  const http = createInternalServiceHttp({
    workloadToken: env.WORKLOAD_TOKEN,
    tokenHeader: "x-lens-model-workload-token",
    routes: {
      "/v1/scheduler/reservations": async (body) => {
        const input: SchedulerReserveInput = {
          reservationId: String(body.reservation_id),
          requestId: String(body.request_id ?? body.reservation_id),
          turnId: String(body.turn_id ?? ""),
          stepId: String(body.step_id ?? body.reservation_id),
          requestDigest: String(body.request_digest),
          modelRef: String(body.model_ref ?? ""),
          artifactDigest: (body.artifact_digest ?? `sha256:${"0".repeat(64)}`) as `sha256:${string}`,
          endpointRef: String(body.endpoint_ref),
          endpointGeneration: String(body.endpoint_generation ?? "1"),
          expiresAt: Number(body.expires_at),
        };
        const lease = sqlScheduler
          ? await sqlScheduler.reserve(input)
          : memoryScheduler!.reserve(input);
        // Echo back the *signed* lease expiry, not the raw request expiry. The bind
        // handler later requires the caller's body.expires_at to exactly equal the
        // signed claim, so the reserve response must carry that same authoritative
        // value — otherwise the two can differ by a sub-millisecond clock delta and
        // the valid path spuriously 409s.
        const signedExpiry = leaseVerifier.verify(lease.leaseToken, {
          purpose: "scheduler_lease",
          requestId: input.requestId,
        }).expiresAt;
        return {
          reservation_id: lease.reservationId,
          request_digest: lease.requestDigest,
          endpoint_ref: lease.endpointRef,
          endpoint_generation: lease.endpointGeneration,
          fence: lease.fence,
          expires_at: signedExpiry,
          lease_token: lease.leaseToken,
        };
      },
      "/v1/scheduler/reservations/start": async (body) => {
        if (sqlScheduler) await sqlScheduler.start(String(body.reservation_id), String(body.request_digest), Number(body.fence));
        else memoryScheduler!.start(String(body.reservation_id), String(body.request_digest), Number(body.fence));
        return {};
      },
      "/v1/scheduler/reservations/release": async (body) => {
        if (sqlScheduler) await sqlScheduler.release(String(body.reservation_id), Number(body.fence));
        else memoryScheduler!.release(String(body.reservation_id), Number(body.fence));
        return {};
      },
      "/v1/attempts/allocate-generation": async (body) => {
        const generation = await attempts.allocateGeneration(String(body.logical_attempt_id));
        return { generation };
      },
      "/v1/attempts/list-logical": async (body) => {
        const rows = await attempts.listLogicalAttempts(String(body.logical_attempt_id));
        return { attempts: rows };
      },
      "/v1/attempts/begin-dispatch": async (body) => {
        const record = await attempts.beginDispatchAttempt({
          logicalAttemptId: String(body.logical_attempt_id),
          requestId: String(body.request_id),
          turnId: String(body.turn_id),
          stepId: String(body.step_id),
          requestDigest: String(body.request_digest),
          modelRef: String(body.model_ref),
          artifactDigest: body.artifact_digest as `sha256:${string}`,
          endpointGeneration: String(body.endpoint_generation),
          deadlineAt: Number(body.deadline_at),
        });
        return record as unknown as Record<string, unknown>;
      },
      "/v1/attempts/accept": async (body) => {
        const record = await attempts.accept({
          reservationId: String(body.reservation_id),
          logicalAttemptId: String(body.logical_attempt_id ?? `${body.request_id}:${body.turn_id}:${body.step_id}`),
          attemptGeneration: Number(body.attempt_generation ?? 1),
          requestId: String(body.request_id),
          turnId: String(body.turn_id),
          stepId: String(body.step_id),
          requestDigest: String(body.request_digest),
          modelRef: String(body.model_ref),
          artifactDigest: body.artifact_digest as `sha256:${string}`,
          endpointGeneration: String(body.endpoint_generation),
          deadlineAt: Number(body.deadline_at),
        });
        // Bind the provider catalog identity to this reservation (lease) so generation fails
        // closed if the provider is later disabled or its catalog version/digest drifts.
        if (providerRuntime && record.modelRef) {
          try {
            const cfg = await providerRuntime.configResolver.resolve(record.modelRef, PROVIDER_CAPABILITY);
            providerIdentityBinding.set(record.reservationId, {
              providerId: cfg.providerId,
              catalogVersion: cfg.catalogVersion,
              catalogDigest: cfg.catalogDigest,
            });
          } catch {
            providerIdentityBinding.delete(record.reservationId);
          }
        }
        return record as unknown as Record<string, unknown>;
      },
      "/v1/attempts/bind-lease": async (body) => {
        const reservationId = String(body.reservation_id ?? "");
        if (!reservationId) throw new Error("STALE_FENCE");
        const current = await attempts.getAttemptStatus(reservationId).catch(() => undefined);
        if (!current) throw new Error("STALE_FENCE");

        const leaseToken = String(body.lease_token ?? "");
        if (!leaseToken) throw new Error("STALE_FENCE");

        // Every authorization input must be present and explicit — never defaulted, so a
        // missing field can never be silently treated as a valid authorization input.
        // The attempt record is the source of truth for request identity; the client-side
        // RuntimeAttemptStore binding contract only carries lease fields, so do not require
        // duplicated request/turn/model fields in the bind body.
        const requestId = current.requestId;
        const turnId = current.turnId;
        const stepId = current.stepId;
        const modelRef = current.modelRef;
        const artifactDigest = String(current.artifactDigest);
        const endpointRef = String(body.endpoint_ref ?? "");
        const endpointGeneration = String(body.endpoint_generation ?? "");
        const requestDigest = String(body.request_digest ?? "");
        const bodyExpiresAt = body.expires_at;
        if (
          !artifactDigest.startsWith("sha256:") || !endpointRef || !endpointGeneration ||
          !requestDigest || !Number.isSafeInteger(Number(bodyExpiresAt))
        ) {
          throw new Error("STALE_FENCE");
        }

        // Verify every signed lease claim against the caller's request before persisting.
        let lease: AuthorityReceiptClaims;
        try {
          lease = leaseVerifier.verify(leaseToken, {
            purpose: "scheduler_lease",
            issuer: "authority-scheduler",
            requestId,
            turnId,
            stepId,
            reservationRef: reservationId,
            modelRef,
            artifactDigest: artifactDigest as `sha256:${string}`,
          });
        } catch {
          throw new Error("STALE_FENCE");
        }

        // The persisted expiry must come from the signed lease, never the caller's body.
        // Reject any body.expires_at that is not exactly the signed lease expiry.
        if (Number(bodyExpiresAt) !== lease.expiresAt) throw new Error("STALE_FENCE");

        // Recomputed bound digest must match the signed lease's bound digest.
        const expectedBound = `sha256:${createHash("sha256").update(`${requestDigest}|${endpointRef}|${endpointGeneration}|${artifactDigest}`).digest("hex")}`;
        if (lease.boundDigest !== expectedBound) throw new Error("STALE_FENCE");
        if (!Number.isSafeInteger(lease.revision) || lease.revision < 1) throw new Error("STALE_FENCE");

        // The caller's body fence must match the signed lease revision exactly — never
        // merely accept that *a* valid signed revision exists. A body fence that was
        // never compared against the signature could rebind a different fence than the
        // one the authority actually authorized.
        if (!Number.isSafeInteger(Number(body.fence)) || Number(body.fence) !== lease.revision) {
          throw new Error("STALE_FENCE");
        }

        // Cross-check the signed lease against the accepted attempt so a lease minted for a
        // different reservation cannot be bound here.
        if (
          current.requestId !== requestId || current.turnId !== turnId || current.stepId !== stepId ||
          current.requestDigest !== requestDigest || current.modelRef !== modelRef ||
          String(current.artifactDigest) !== artifactDigest
        ) {
          throw new Error("STALE_FENCE");
        }

        const record = await attempts.bindSchedulerLease(reservationId, {
          fence: lease.revision,
          endpointRef,
          endpointGeneration,
          requestDigest,
          expiresAt: lease.expiresAt,
        });
        return record as unknown as Record<string, unknown>;
      },
      "/v1/attempts/contact-intent": async (body) => {
        const record = await attempts.commitContactIntent(String(body.reservation_id));
        return record as unknown as Record<string, unknown>;
      },
      "/v1/attempts/not-started": async (body) => {
        const record = await attempts.markNotStarted(String(body.reservation_id), true);
        return record as unknown as Record<string, unknown>;
      },
      "/v1/attempts/unknown": async (body) => {
        const record = await attempts.markOutcomeUnknown(String(body.reservation_id));
        return record as unknown as Record<string, unknown>;
      },
      "/v1/attempts/status": async (body) => {
        const record = await attempts.getAttemptStatus(String(body.reservation_id));
        return record as unknown as Record<string, unknown>;
      },
      "/v1/attempts/transition": async (body) => {
        const record = await attempts.transitionTo(String(body.reservation_id), String(body.to) as RuntimeAttemptState);
        return record as unknown as Record<string, unknown>;
      },
      "/v1/attempts/reconcile": async () => {
        const reconciled = await attempts.reconcileExpired(Date.now());
        return { reconciled };
      },
    },
    streamRoutes: {
      "/v1/inference/generate": generateStream,
    },
    mapError: (error) => {
      if (error instanceof ProviderRuntimeResolutionError) {
        if (error.code === "STALE_FENCE") return { status: 409, body: { error: "STALE_FENCE" } };
        return { status: 409, body: { error: "FORBIDDEN" } };
      }
      const message = error instanceof Error ? error.message : "INTERNAL";
      if (message === "OUTCOME_UNKNOWN") return { status: 409, body: { error: "OUTCOME_UNKNOWN" } };
      if (message === "OVERLOADED") return { status: 429, body: { error: "OVERLOADED" } };
      if (message === "STALE_FENCE" || message === "CONFLICT" || message === "OUTPUT_TOO_LARGE") return { status: 409, body: { error: message } };
      return { status: 500, body: { error: "INTERNAL" } };
    },
  });

  const runtimeHealthUrl = env.INTERNAL_RUNTIME_URL
    ? `${env.INTERNAL_RUNTIME_URL.replace(/\/+$/, "")}/healthz`
    : undefined;
  const evaluateReadiness = () => evaluateSidecarReadiness({
    profile,
    storeReady: async () => (postgres ? await postgres.ready() : true),
    runtimeHealthUrl,
  });
  // Readiness must reflect real dependency health, not merely that startup ran. A periodic
  // recheck keeps it truthful as dependencies come and go.
  const readinessTimer = setInterval(() => {
    void evaluateReadiness().then((ready) => http.setReady(ready));
  }, 5_000);
  readinessTimer.unref();
  http.setReady(await evaluateReadiness());

  const port = Number(env.PORT ?? "8793");
  await http.listen(port, env.HOST ?? "127.0.0.1");
  const address = http.server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  return {
    close: async () => {
      clearInterval(reconcileTimer);
      clearInterval(readinessTimer);
      await http.close();
      await postgres?.close();
    },
    port: boundPort,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
