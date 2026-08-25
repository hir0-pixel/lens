import {
  assertInternalOrigin,
  assertWorkloadToken,
  readBoundedJson,
  type FetchPort,
} from "../../services/internal-http/internalHttp";
import { createModelProviderAdapter } from "../../services/model-provider/createModelProviderAdapter";
import type { AdapterType, ProviderEndpointConfig } from "../../services/model-provider/ProviderAdapter";
import type { SecretStore } from "../../services/secrets/SecretStore";

const PROVIDER_CAPABILITY = "grounded-assistant";

export interface ProviderRuntimeConfig {
  /** Stable provider identity, bound to the request/lease identity. */
  providerId: string;
  adapterType: AdapterType;
  /** Internal origin only — never a secret. Sovereign requires HTTPS/internal or loopback HTTP. */
  internalUrl: string;
  /** Opaque secret reference; the sidecar resolves the plaintext only immediately before the adapter call. */
  secretRef: string;
  tlsWorkloadRef: string;
  allowedCapabilities: readonly ("generate" | "embed" | "stream")[];
  modelRef: string;
  timeoutMs: number;
  maxConcurrency: number;
  catalogVersion: number;
  catalogDigest: `sha256:${string}`;
}

export type ProviderRuntimeResolutionCode =
  | "FORBIDDEN"
  | "STALE_FENCE"
  | "DEPENDENCY_UNAVAILABLE";

/**
 * Thrown when a model_ref cannot be resolved to a live, approved provider runtime config.
 * Every code maps to a fail-closed outcome: the sidecar must never substitute a default
 * model or echo a synthetic response.
 */
export class ProviderRuntimeResolutionError extends Error {
  constructor(readonly code: ProviderRuntimeResolutionCode, message: string) {
    super(message);
    this.name = "ProviderRuntimeResolutionError";
  }
}

/** Minimal authenticated, server-to-server provider-runtime config resolver (non-secret config only). */
export interface ProviderRuntimeConfigResolver {
  resolve(modelRef: string, capability: string): Promise<ProviderRuntimeConfig>;
}

/** Minimal authenticated, server-to-server provider secret resolver (plaintext only immediately before use). */
export interface ProviderSecretResolver {
  resolve(secretRef: string): Promise<string>;
}

const SECRET_LIKE_KEYS = ["apikey", "api_key", "secret", "secretkey", "secret_key", "token", "password", "authorization"];

function assertSha256Digest(value: unknown, field: string): `sha256:${string}` {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new ProviderRuntimeResolutionError("DEPENDENCY_UNAVAILABLE", `Provider config field ${field} is malformed.`);
  }
  return value as `sha256:${string}`;
}

function parseProviderRuntimeConfig(body: Record<string, unknown>, modelRef: string): ProviderRuntimeConfig {
  // Defense in depth: a config endpoint must never return secret material. If it does, reject
  // the entire config rather than risk leaking a key into the runtime.
  for (const key of Object.keys(body)) {
    if (SECRET_LIKE_KEYS.includes(key.toLowerCase()) && typeof body[key] === "string" && (body[key] as string).length >= 8) {
      throw new ProviderRuntimeResolutionError("DEPENDENCY_UNAVAILABLE", "Provider config response carried secret material.");
    }
  }
  const adapterType = body.adapterType;
  if (adapterType !== "openai-compatible" && adapterType !== "gemini-dev") {
    throw new ProviderRuntimeResolutionError("DEPENDENCY_UNAVAILABLE", "Provider config returned an unknown adapter type.");
  }
  const internalUrl = typeof body.internalUrl === "string" ? body.internalUrl : "";
  if (!internalUrl) throw new ProviderRuntimeResolutionError("DEPENDENCY_UNAVAILABLE", "Provider config missing internalUrl.");
  const secretRef = typeof body.secretRef === "string" ? body.secretRef : "";
  if (!secretRef || secretRef.includes("/") || secretRef.includes("\\") || secretRef.includes(" ")) {
    throw new ProviderRuntimeResolutionError("DEPENDENCY_UNAVAILABLE", "Provider config secret_ref is invalid.");
  }
  const allowedCapabilities = Array.isArray(body.allowedCapabilities)
    ? (body.allowedCapabilities.filter((c) => c === "generate" || c === "embed" || c === "stream") as ("generate" | "embed" | "stream")[])
    : [];
  const timeoutMs = typeof body.timeoutMs === "number" && Number.isFinite(body.timeoutMs) ? body.timeoutMs : 0;
  const maxConcurrency = typeof body.maxConcurrency === "number" && Number.isFinite(body.maxConcurrency) ? body.maxConcurrency : 0;
  if (timeoutMs < 100 || maxConcurrency < 1) {
    throw new ProviderRuntimeResolutionError("DEPENDENCY_UNAVAILABLE", "Provider config timeouts/concurrency are invalid.");
  }
  return {
    providerId: typeof body.providerId === "string" ? body.providerId : "",
    adapterType,
    internalUrl,
    secretRef,
    tlsWorkloadRef: typeof body.tlsWorkloadRef === "string" ? body.tlsWorkloadRef : "",
    allowedCapabilities,
    modelRef,
    timeoutMs,
    maxConcurrency,
    catalogVersion: typeof body.catalogVersion === "number" ? body.catalogVersion : 0,
    catalogDigest: assertSha256Digest(body.catalogDigest, "catalogDigest"),
  };
}

/**
 * Workload-authenticated internal HTTP resolver. The sidecar never learns a provider key from
 * this call — only non-secret config. The origin must be an approved internal endpoint.
 */
export class HttpProviderRuntimeConfigResolver implements ProviderRuntimeConfigResolver {
  private readonly origin: URL;
  constructor(
    configUrl: string,
    private readonly token: string,
    private readonly fetcher: FetchPort = fetch,
  ) {
    this.origin = assertInternalOrigin(configUrl, "LENS_PROVIDER_RUNTIME_CONFIG_URL");
    assertWorkloadToken(token, "LENS_PROVIDER_RUNTIME_CONFIG_TOKEN");
  }

  async resolve(modelRef: string, capability: string): Promise<ProviderRuntimeConfig> {
    const url = new URL(this.origin.toString());
    url.searchParams.set("model_ref", modelRef);
    url.searchParams.set("capability", capability);
    const response = await this.fetcher(url, {
      headers: { accept: "application/json", "x-lens-workload-token": this.token },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 404) throw new ProviderRuntimeResolutionError("FORBIDDEN", "Model is not an approved model_ref.");
    if (response.status === 403) throw new ProviderRuntimeResolutionError("FORBIDDEN", "Provider is disabled or unapproved.");
    if (response.status === 410) throw new ProviderRuntimeResolutionError("STALE_FENCE", "Provider catalog is stale.");
    if (!response.ok) throw new ProviderRuntimeResolutionError("DEPENDENCY_UNAVAILABLE", "Provider runtime config is unavailable.");
    const body = await readBoundedJson(response) as Record<string, unknown>;
    return parseProviderRuntimeConfig(body, modelRef);
  }
}

/**
 * Workload-authenticated internal HTTP secret resolver. Resolves the plaintext key only
 * immediately before the adapter call; the sidecar never logs or persists it.
 */
export class HttpProviderSecretResolver implements ProviderSecretResolver {
  private readonly origin: URL;
  constructor(
    secretUrl: string,
    private readonly token: string,
    private readonly fetcher: FetchPort = fetch,
  ) {
    this.origin = assertInternalOrigin(secretUrl, "LENS_PROVIDER_SECRET_URL");
    assertWorkloadToken(token, "LENS_PROVIDER_SECRET_TOKEN");
  }

  async resolve(secretRef: string): Promise<string> {
    const url = new URL(this.origin.toString());
    url.searchParams.set("secret_ref", secretRef);
    const response = await this.fetcher(url, {
      headers: { accept: "application/json", "x-lens-workload-token": this.token },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 404) throw new ProviderRuntimeResolutionError("FORBIDDEN", "Secret reference is unknown.");
    if (!response.ok) throw new ProviderRuntimeResolutionError("DEPENDENCY_UNAVAILABLE", "Provider secret resolution failed.");
    const body = await readBoundedJson(response) as Record<string, unknown>;
    const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";
    if (apiKey.length < 8) throw new ProviderRuntimeResolutionError("DEPENDENCY_UNAVAILABLE", "Resolved secret is invalid.");
    return apiKey;
  }
}

/** Sidecar-local secret store that fetches the plaintext only on `get` via the authenticated resolver. */
export class SidecarSecretStore implements SecretStore {
  private readonly cache = new Map<string, string>();
  constructor(private readonly resolver: ProviderSecretResolver) {}
  async put(): Promise<void> {
    throw new Error("The sidecar does not persist secrets.");
  }
  async get(secretRef: string): Promise<string> {
    const cached = this.cache.get(secretRef);
    if (cached) return cached;
    const value = await this.resolver.resolve(secretRef);
    this.cache.set(secretRef, value);
    return value;
  }
  async delete(): Promise<void> {
    // No persisted state to remove; the resolver-side secret lives in the BFF SecretStore.
  }
}

/** Per-provider bounded concurrency semaphore keyed by provider identity. */
export class ProviderConcurrencyGate {
  private readonly active = new Map<string, number>();
  private readonly waiters = new Map<string, Array<() => void>>();
  constructor(
    private readonly limits: ReadonlyMap<string, number> = new Map(),
    private readonly defaultLimit = 8,
  ) {}

  acquire(key: string): Promise<() => void> {
    const limit = this.limits.get(key) ?? this.defaultLimit;
    const current = this.active.get(key) ?? 0;
    if (current < limit) {
      this.active.set(key, current + 1);
      return Promise.resolve(() => this.release(key));
    }
    return new Promise((resolve) => {
      const list = this.waiters.get(key) ?? [];
      list.push(() => resolve(this.acquire(key)));
      this.waiters.set(key, list);
    });
  }

  private release(key: string): void {
    const current = (this.active.get(key) ?? 1) - 1;
    if (current <= 0) this.active.delete(key);
    else this.active.set(key, current);
    const list = this.waiters.get(key);
    if (list && list.length > 0) {
      const next = list.shift()!;
      queueMicrotask(next);
    }
  }
}

export interface ProviderIdentityBinding {
  providerId: string;
  catalogVersion: number;
  catalogDigest: `sha256:${string}`;
}

/**
 * Resolves the approved provider config for a model_ref, rejects stale/disabled/unapproved/
 * capability-mismatched config, then streams real generation through the canonical
 * OpenAICompatibleAdapter. No echo, no default-model substitution, no key in any response.
 */
export async function* runProviderGeneration(input: {
  resolver: ProviderRuntimeConfigResolver;
  secretStore: SecretStore;
  concurrency: ProviderConcurrencyGate;
  modelRef: string;
  capability: string;
  chunks: readonly string[];
  deadlineAt: number;
  signal: AbortSignal;
  fetcher?: FetchPort;
  /** Expected provider catalog identity bound at lease accept; mismatch fails closed as STALE_FENCE. */
  expectedCatalog?: ProviderIdentityBinding;
}): AsyncGenerator<string> {
  const cfg = await input.resolver.resolve(input.modelRef, input.capability);

  if (input.expectedCatalog && (input.expectedCatalog.catalogVersion !== cfg.catalogVersion || input.expectedCatalog.catalogDigest !== cfg.catalogDigest)) {
    throw new ProviderRuntimeResolutionError("STALE_FENCE", "Provider catalog version/digest drifted from the authorized lease.");
  }
  if (!cfg.allowedCapabilities.includes("generate") || !cfg.allowedCapabilities.includes("stream")) {
    throw new ProviderRuntimeResolutionError("FORBIDDEN", "Provider does not support the required generate/stream capability.");
  }

  const release = await input.concurrency.acquire(cfg.providerId);
  try {
    const adapterConfig: ProviderEndpointConfig = {
      adapterType: cfg.adapterType,
      baseUrl: cfg.internalUrl,
      secretRef: cfg.secretRef,
      tlsWorkloadRef: cfg.tlsWorkloadRef,
      allowedModels: [input.modelRef],
      expectedCapabilities: cfg.allowedCapabilities,
      timeoutMs: cfg.timeoutMs,
      maxConcurrency: cfg.maxConcurrency,
      profile: "sovereign",
    };
    const adapter = createModelProviderAdapter(adapterConfig, input.fetcher ?? fetch, input.secretStore);
    try {
      const upstream = adapter.generateStream(
        { model: input.modelRef, chunks: input.chunks, deadlineAt: input.deadlineAt },
        input.signal,
      );
      const iterator = upstream[Symbol.asyncIterator]();
      const abortPromise = new Promise<IteratorResult<string>>((_, reject) => {
        const cancel = () => reject(new Error("CANCELLED"));
        if (input.signal.aborted) cancel();
        else input.signal.addEventListener("abort", cancel, { once: true });
      });
      while (true) {
        const next = await Promise.race([iterator.next(), abortPromise]);
        if (next.done) return;
        yield next.value;
      }
    } catch (err) {
      // A client disconnect must be observed as a cancellation, not a provider failure.
      if (input.signal.aborted) throw new Error("CANCELLED");
      // The adapter communicates normalized outcomes as plain objects ({ code }). Map them to
      // real errors the sidecar's fail-closed path understands; never let a provider error
      // surface as a synthetic success.
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
      if (code === "CANCELLED") throw new Error("CANCELLED");
      if (code === "OVERLOADED") throw new Error("OVERLOADED");
      if (code === "FORBIDDEN") {
        // The provider rejected the credential or the model at request time. This is a
        // provider-side failure, not a client authorization rejection, so it fails closed as
        // an internal error (the attempt is marked unknown) rather than leaking as a 409.
        throw new Error("DEPENDENCY_UNAVAILABLE");
      }
      if (code === "STALE_FENCE") throw new ProviderRuntimeResolutionError("STALE_FENCE", "Provider returned a stale fence.");
      throw new ProviderRuntimeResolutionError("DEPENDENCY_UNAVAILABLE", "Provider generation failed.");
    }
  } finally {
    release();
  }
}

export { PROVIDER_CAPABILITY };
