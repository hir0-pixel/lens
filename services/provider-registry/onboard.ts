import { randomUUID } from "node:crypto";
import { createModelProviderAdapter } from "../model-provider/createModelProviderAdapter";
import { assertInternalProviderUrl } from "../model-provider/providerEndpointPolicy";
import type { AdapterType, ProviderProfile } from "../model-provider/ProviderAdapter";
import type { SecretStore } from "../secrets/SecretStore";
import { assertSecretRef } from "../secrets/SecretStore";
import {
  catalogArtifactDigest,
  IdempotencyConflictError,
  onboardInputDigest,
  type ProviderRecord,
  type ProviderRegistry,
} from "./ProviderRegistry";
import { employeeCatalogEntries, type EmployeeModel } from "./catalog";

const MODEL_REF_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export class ProviderOnboardError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ProviderOnboardError";
  }
}

export interface OnboardInput {
  adapterType: AdapterType;
  baseUrl: string;
  apiKey: string;
  tlsWorkloadRef: string;
  allowedModels: readonly string[];
  capabilities: readonly ("generate" | "embed" | "stream")[];
  timeoutMs: number;
  maxConcurrency: number;
  profile: ProviderProfile;
  idempotencyKey: string;
}

function safeUpstreamError(error: unknown): ProviderOnboardError {
  const status = error && typeof error === "object" && "status" in error ? Number((error as { status: number }).status) : 0;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (status === 401 || status === 403) return new ProviderOnboardError("INVALID_KEY", "Provider rejected the credential.");
  if (name === "AbortError" || message.includes("Timeout") || message.includes("aborted")) {
    return new ProviderOnboardError("PROVIDER_UNAVAILABLE", "Provider request timed out.");
  }
  if (message.includes("certificate") || message.includes("TLS") || message.includes("CERT") || name === "Error" && message.toLowerCase().includes("ssl")) {
    return new ProviderOnboardError("PROVIDER_UNAVAILABLE", "Provider TLS validation failed.");
  }
  return new ProviderOnboardError("PROVIDER_UNAVAILABLE", "Provider catalog is unavailable.");
}

export class ProviderOnboardingService {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly secrets: SecretStore,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async onboard(input: OnboardInput): Promise<{ id: string; status: string }> {
    if (input.apiKey.length < 8) throw new ProviderOnboardError("INVALID_ARGUMENT", "Provider key is invalid.");
    if (!input.idempotencyKey || input.idempotencyKey.length > 128) throw new ProviderOnboardError("INVALID_ARGUMENT", "Idempotency key is invalid.");
    if (input.allowedModels.length < 1) throw new ProviderOnboardError("INVALID_ARGUMENT", "An explicit model allowlist is required.");
    try {
      assertInternalProviderUrl(input.baseUrl, input.profile);
    } catch {
      throw new ProviderOnboardError("INVALID_ARGUMENT", "Provider base URL is not allowed for this deployment profile.");
    }
    const digest = onboardInputDigest(input);
    const existing = await this.registry.getByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      if (existing.inputDigest !== digest) throw new IdempotencyConflictError();
      return { id: existing.id, status: existing.state };
    }
    const secretRef = `p_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    assertSecretRef(secretRef);
    await this.secrets.put(secretRef, input.apiKey);
    try {
      const adapter = createModelProviderAdapter({
        adapterType: input.adapterType,
        baseUrl: input.baseUrl,
        secretRef,
        tlsWorkloadRef: input.tlsWorkloadRef,
        allowedModels: input.allowedModels,
        expectedCapabilities: input.capabilities,
        timeoutMs: input.timeoutMs,
        maxConcurrency: input.maxConcurrency,
        profile: input.profile,
      }, this.fetcher, this.secrets);
      const discovered = await adapter.discoverModels();
      const catalogModelIds = discovered.map((model) => model.id).filter((id) => MODEL_REF_PATTERN.test(id));
      const record = await this.registry.create({
        adapterType: input.adapterType,
        baseUrl: input.baseUrl,
        secretRef,
        tlsWorkloadRef: input.tlsWorkloadRef,
        allowedModels: input.allowedModels,
        capabilities: input.capabilities,
        timeoutMs: input.timeoutMs,
        maxConcurrency: input.maxConcurrency,
        profile: input.profile,
        state: catalogModelIds.length > 0 ? "active" : "unhealthy",
        catalogVersion: 1,
        catalogModelIds,
        idempotencyKey: input.idempotencyKey,
        inputDigest: digest,
      });
      return { id: record.id, status: record.state };
    } catch (error) {
      if (error instanceof IdempotencyConflictError) throw error;
      if (error instanceof ProviderOnboardError) throw error;
      await this.secrets.delete(secretRef).catch(() => undefined);
      throw safeUpstreamError(error);
    }
  }

  async disable(id: string): Promise<{ id: string; status: string }> {
    const updated = await this.registry.update(id, { state: "disabled" });
    return { id: updated.id, status: updated.state };
  }

  /**
   * Resolves only non-secret provider-runtime config for an approved model_ref. Never returns
   * a key. Throws FORBIDDEN when the owning provider is disabled, NOT_FOUND when the model_ref
   * is not in any approved catalog. The runtime adapter consumes this over an authenticated
   * internal server-to-server call and resolves the secret separately (and only at call time).
   */
  async resolveRuntimeConfig(modelRef: string): Promise<{
    providerId: string;
    adapterType: AdapterType;
    internalUrl: string;
    secretRef: string;
    tlsWorkloadRef: string;
    allowedCapabilities: readonly ("generate" | "embed" | "stream")[];
    timeoutMs: number;
    maxConcurrency: number;
    catalogVersion: number;
    catalogDigest: `sha256:${string}`;
  }> {
    if (!MODEL_REF_PATTERN.test(modelRef)) throw new ProviderOnboardError("NOT_FOUND", "Invalid model_ref.");
    const providers = await this.registry.listActive();
    let disabledMatch = false;
    for (const provider of providers) {
      if (!provider.catalogModelIds.includes(modelRef)) continue;
      if (provider.state !== "active") {
        disabledMatch = true;
        continue;
      }
      return {
        providerId: provider.id,
        adapterType: provider.adapterType,
        internalUrl: provider.baseUrl,
        secretRef: provider.secretRef,
        tlsWorkloadRef: provider.tlsWorkloadRef,
        allowedCapabilities: provider.capabilities as ("generate" | "embed" | "stream")[],
        timeoutMs: provider.timeoutMs,
        maxConcurrency: provider.maxConcurrency,
        catalogVersion: provider.catalogVersion,
        catalogDigest: catalogArtifactDigest(provider.id, modelRef, provider.catalogVersion),
      };
    }
    if (disabledMatch) throw new ProviderOnboardError("FORBIDDEN", "Provider is disabled or unapproved.");
    throw new ProviderOnboardError("NOT_FOUND", "Model is not an approved model_ref.");
  }

  async refreshCatalog(id: string): Promise<{ id: string; status: string; catalogVersion: number }> {
    const current = await this.registry.get(id);
    if (!current) throw new ProviderOnboardError("NOT_FOUND", "Provider not found.");
    if (current.state === "disabled") throw new ProviderOnboardError("FORBIDDEN", "Provider is disabled.");
    try {
      const adapter = createModelProviderAdapter({
        adapterType: current.adapterType,
        baseUrl: current.baseUrl,
        secretRef: current.secretRef,
        tlsWorkloadRef: current.tlsWorkloadRef,
        allowedModels: current.allowedModels,
        expectedCapabilities: current.capabilities as ("generate" | "embed" | "stream")[],
        timeoutMs: current.timeoutMs,
        maxConcurrency: current.maxConcurrency,
        profile: current.profile,
      }, this.fetcher, this.secrets);
      const discovered = await adapter.discoverModels();
      const catalogModelIds = discovered.map((model) => model.id).filter((id) => MODEL_REF_PATTERN.test(id));
      const updated = await this.registry.update(id, {
        catalogModelIds,
        catalogVersion: current.catalogVersion + 1,
        state: catalogModelIds.length > 0 ? "active" : "unhealthy",
      });
      return { id: updated.id, status: updated.state, catalogVersion: updated.catalogVersion };
    } catch (error) {
      await this.registry.update(id, { state: "unhealthy" }).catch(() => undefined);
      throw safeUpstreamError(error);
    }
  }

  async employeeCatalog(): Promise<readonly EmployeeModel[]> {
    const providers = await this.registry.listActive();
    return employeeCatalogEntries(providers);
  }

  async approvedSnapshot(): Promise<readonly { modelRef: string; artifactDigest: `sha256:${string}`; capabilities: readonly string[]; catalogVersion: number }[]> {
    const providers = await this.registry.listActive();
    const out: { modelRef: string; artifactDigest: `sha256:${string}`; capabilities: readonly string[]; catalogVersion: number }[] = [];
    for (const provider of providers) {
      if (provider.state !== "active") continue;
      for (const modelId of provider.catalogModelIds) {
        out.push({
          modelRef: modelId,
          artifactDigest: catalogArtifactDigest(provider.id, modelId, provider.catalogVersion),
          capabilities: [...provider.capabilities, "grounded-assistant"],
          catalogVersion: provider.catalogVersion,
        });
      }
    }
    return out;
  }

  publicRecord(record: ProviderRecord): { id: string; status: string } {
    return { id: record.id, status: record.state };
  }
}
