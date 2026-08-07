import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  isPlausibleApiKey,
  maskSecret,
  sanitizeUrl,
} from "@/shared/security/sanitize";

describe("security sanitize", () => {
  it("blocks javascript URLs", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBe("#");
    expect(sanitizeUrl("https://example.com")).toBe("https://example.com");
  });

  it("masks secrets", () => {
    expect(maskSecret("sk-abcdefghijklmnop")).toMatch(/^sk-a…/);
    expect(maskSecret("short")).toBe("••••••••");
  });

  it("validates plausible API keys", () => {
    expect(isPlausibleApiKey("", "ollama")).toBe(true);
    expect(isPlausibleApiKey("abc", "openai")).toBe(false);
    expect(isPlausibleApiKey("sk-12345678", "openai")).toBe(true);
  });

  it("escapes HTML", () => {
    expect(escapeHtml(`<script>"x"</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot;&lt;/script&gt;",
    );
  });
});
