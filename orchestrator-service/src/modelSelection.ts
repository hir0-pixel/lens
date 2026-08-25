import { OrchestratorError } from "../../services/orchestrator/types";

const MODEL_REF_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

export interface ModelCatalogEntry {
  artifactDigest: `sha256:${string}`;
  approvedCapabilities: readonly string[];
}

export interface ModelSelectionPort {
  resolve(input: { modelRef: string; capability: string }): { artifactDigest: `sha256:${string}` };
}

export function isValidModelRef(value: unknown): value is string {
  return typeof value === "string" && MODEL_REF_PATTERN.test(value);
}

/**
 * Server-side model catalog: the sovereign profile only ever routes to
 * internal artifact digests named here. The client supplies a symbolic
 * `model_ref` alias and NEVER an endpoint, provider, or digest directly.
 * This is the pragmatic catalog surface the ModelGateway is required to
 * validate against; full governance (approval workflow, evidence gates,
 * rollout policies) lives in services/model-registry/ModelRegistry.ts and is
 * not yet wired here — see the production readiness report.
 */
export class StaticModelCatalog implements ModelSelectionPort {
  private readonly catalog: ReadonlyMap<string, ModelCatalogEntry>;

  constructor(catalog: Readonly<Record<string, ModelCatalogEntry>>, private readonly defaultRef: string) {
    for (const [ref, entry] of Object.entries(catalog)) {
      if (!isValidModelRef(ref)) throw new Error(`Invalid model_ref in catalog: ${ref}`);
      if (!DIGEST_PATTERN.test(entry.artifactDigest)) throw new Error(`Invalid artifact digest for model_ref: ${ref}`);
    }
    if (!(defaultRef in catalog)) throw new Error(`defaultRef "${defaultRef}" is not present in the model catalog.`);
    this.catalog = new Map(Object.entries(catalog));
  }

  resolve(input: { modelRef: string; capability: string }): { artifactDigest: `sha256:${string}` } {
    const ref = input.modelRef || this.defaultRef;
    if (!isValidModelRef(ref)) throw new OrchestratorError("FORBIDDEN", "The requested model reference is malformed.");
    const entry = this.catalog.get(ref);
    if (!entry || !entry.approvedCapabilities.includes(input.capability)) {
      throw new OrchestratorError("FORBIDDEN", "The requested model is not approved for this capability.");
    }
    return { artifactDigest: entry.artifactDigest };
  }
}

export class FailClosedModelSelection implements ModelSelectionPort {
  resolve(): { artifactDigest: `sha256:${string}` } {
    throw new OrchestratorError("EVIDENCE_REQUIRED", "No model catalog adapter is configured.");
  }
}
