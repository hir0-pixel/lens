/**
 * Security helpers — secrets, XSS-safe URLs, input validation.
 */

import { maskSecret } from "@/shared/diagnostics/logger";

const DANGEROUS_PROTOCOLS = /^(javascript|data|vbscript):/i;

/** Block javascript: / data: URLs in markdown links and browser navigation */
export function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "#";
  if (DANGEROUS_PROTOCOLS.test(trimmed)) return "#";
  return trimmed;
}

/** Soft-validate API key shape without rejecting legitimate keys */
export function isPlausibleApiKey(key: string, kind?: string): boolean {
  const t = key.trim();
  if (!t) return kind === "ollama" || kind === "lens";
  if (t.length < 8) return false;
  if (/\s/.test(t)) return false;
  return true;
}

/** Prepare provider config for localStorage — keys stay local but we never log them raw */
export function redactProviderForLog(provider: {
  id: string;
  name: string;
  apiKey?: string;
  baseUrl?: string;
}) {
  return {
    id: provider.id,
    name: provider.name,
    apiKey: provider.apiKey ? maskSecret(provider.apiKey) : "",
    baseUrl: provider.baseUrl,
  };
}

/**
 * Escape HTML entities for any string interpolated into innerHTML
 * (prefer React text nodes; this is a last-resort guard).
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export { maskSecret };
