import { describe, expect, it } from "vitest";
import { ValidationService } from "@/shared/preferences/ValidationService";
import { SETTINGS_VERSION } from "@/shared/settings/defaults";

describe("ValidationService", () => {
  it("rejects non-objects", () => {
    const r = ValidationService.validateSettingsBundle(null);
    expect(r.ok).toBe(false);
  });

  it("accepts a complete settings bundle", () => {
    const r = ValidationService.validateSettingsBundle({
      version: SETTINGS_VERSION,
      general: {},
      editor: {},
      terminal: {},
      browser: {},
      ai: {},
      git: {},
      privacy: {},
      accessibility: {},
    });
    expect(r.ok).toBe(true);
  });

  it("warns on version mismatch", () => {
    const r = ValidationService.validateSettingsBundle({
      version: 999,
      general: {},
      editor: {},
      terminal: {},
      browser: {},
      ai: {},
      git: {},
      privacy: {},
      accessibility: {},
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("validates URLs", () => {
    expect(ValidationService.validateUrl("https://api.openai.com").ok).toBe(
      true,
    );
    expect(ValidationService.validateUrl("not-a-url").ok).toBe(false);
  });
});
