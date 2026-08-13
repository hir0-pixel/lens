import type { AppSettingsBundle } from "@/shared/settings/defaults";
import { SETTINGS_VERSION } from "@/shared/settings/defaults";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates imported / exported settings payloads before applying them.
 */
export const ValidationService = {
  validateSettingsBundle(raw: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!raw || typeof raw !== "object") {
      return { ok: false, errors: ["Payload must be a JSON object"], warnings };
    }

    const obj = raw as Record<string, unknown>;
    if (typeof obj.version !== "number") {
      errors.push("Missing settings version");
    } else if (obj.version !== SETTINGS_VERSION) {
      warnings.push(
        `Version mismatch (file: ${obj.version}, app: ${SETTINGS_VERSION})`,
      );
    }

    const required: (keyof AppSettingsBundle)[] = [
      "general",
      "editor",
      "terminal",
      "browser",
      "ai",
      "git",
      "privacy",
      "accessibility",
    ];
    for (const key of required) {
      if (!obj[key] || typeof obj[key] !== "object") {
        errors.push(`Missing or invalid section: ${key}`);
      }
    }

    return { ok: errors.length === 0, errors, warnings };
  },

  validateApiKey(key: string, kind: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const trimmed = key.trim();
    if (!trimmed && kind !== "ollama" && kind !== "lens") {
      warnings.push("API key is empty");
    }
    if (trimmed.length > 0 && trimmed.length < 8) {
      errors.push("API key looks too short");
    }
    return { ok: errors.length === 0, errors, warnings };
  },

  validateUrl(url: string): ValidationResult {
    const errors: string[] = [];
    try {
      new URL(url);
    } catch {
      errors.push("Invalid URL");
    }
    return { ok: errors.length === 0, errors, warnings: [] };
  },
};
