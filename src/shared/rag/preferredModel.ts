import type { Model } from "@/lib/types";

const DEPRECATED_MODEL_PREFIXES = ["gemini-2.5-flash", "gemini-2.5-pro"];

function isAvailable(model: Model): boolean {
  return model.available !== false;
}

/** Prefer current Gemini flash models; skip deprecated 2.5 ids when possible. */
export function pickPreferredRagModel(models: readonly Model[]): Model | undefined {
  const available = models.filter(isAvailable);
  if (available.length === 0) return undefined;
  const preferredIds = ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-latest"];
  for (const id of preferredIds) {
    const match = available.find((model) => model.id === id);
    if (match) return match;
  }
  const nonDeprecated = available.find(
    (model) => !DEPRECATED_MODEL_PREFIXES.some((prefix) => model.id === prefix || model.id.startsWith(`${prefix}-`)),
  );
  return nonDeprecated ?? available[0];
}

export function resolveAskModelId(models: readonly Model[], sessionModelId: string | undefined): string | undefined {
  if (sessionModelId && models.some((model) => model.id === sessionModelId && isAvailable(model))) {
    if (!DEPRECATED_MODEL_PREFIXES.some((prefix) => sessionModelId === prefix || sessionModelId.startsWith(`${prefix}-`))) {
      return sessionModelId;
    }
  }
  return pickPreferredRagModel(models)?.id;
}
