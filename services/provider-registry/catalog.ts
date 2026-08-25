import { employeeModelDoesNotAffectRag, type CompanyRagProfile } from "../rag-profile/companyRagProfile";
import { catalogArtifactDigest, type ProviderRecord } from "./ProviderRegistry";

const MODEL_REF_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export interface EmployeeModel {
  modelRef: string;
  label: string;
  available: boolean;
}

export function isValidModelRef(value: unknown): value is string {
  return typeof value === "string" && MODEL_REF_PATTERN.test(value);
}

export function employeeCatalogEntries(providers: readonly ProviderRecord[]): readonly EmployeeModel[] {
  const models: EmployeeModel[] = [];
  for (const provider of providers) {
    for (const modelId of provider.catalogModelIds) {
      if (!isValidModelRef(modelId)) continue;
      models.push({
        modelRef: modelId,
        label: modelId,
        available: provider.state === "active",
      });
    }
  }
  return models;
}

export function resolveApprovedModel(input: {
  modelRef: string;
  capability: string;
  providers: readonly ProviderRecord[];
  ragProfile?: CompanyRagProfile;
}): { artifactDigest: `sha256:${string}` } {
  if (!isValidModelRef(input.modelRef)) throw new Error("FORBIDDEN");
  if (input.ragProfile && !employeeModelDoesNotAffectRag(input.ragProfile, input.modelRef)) {
    throw new Error("FORBIDDEN");
  }
  for (const provider of input.providers) {
    if (provider.state !== "active") continue;
    if (!provider.catalogModelIds.includes(input.modelRef)) continue;
    const caps = new Set([...provider.capabilities, "grounded-assistant"]);
    if (!caps.has(input.capability) && input.capability !== "grounded-assistant") continue;
    return { artifactDigest: catalogArtifactDigest(provider.id, input.modelRef, provider.catalogVersion) };
  }
  throw new Error("FORBIDDEN");
}

export function redactSecrets(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(record)) {
      const lower = key.toLowerCase();
      if (lower.includes("key") || lower.includes("secret") || lower.includes("authorization") || lower === "authorization") {
        continue;
      }
      next[key] = redactSecrets(nested);
    }
    return next;
  }
  return value;
}
