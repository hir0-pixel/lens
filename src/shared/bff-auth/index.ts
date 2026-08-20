import { createAuthClient, type AuthClient } from "./client";

export interface BffAuthConfig {
  enabled: boolean;
  baseUrl: string;
  openExternal?: (url: string) => void;
}

/**
 * Reads BFF auth configuration from the build environment.
 *
 * The BFF is served on the same origin as the app in production, so the base
 * URL defaults to empty (same-origin) and is always enabled for the web build.
 *
 * `VITE_LENS_BFF_URL` is an explicit override used in development (a separate
 * BFF port) or the Tauri desktop build (a remote/loopback BFF). A value is
 * accepted only when it is a valid http(s) origin; anything else disables the
 * override and falls back to same-origin.
 *
 * Production fail-closed behavior for the *legacy test gateways* is enforced
 * separately in vite.config.ts, which refuses to build when those variables
 * are present in a production build.
 */
export function getBffAuthConfig(
  environment: Record<string, string | boolean | undefined> = import.meta.env,
): BffAuthConfig {
  const value = environment.VITE_LENS_BFF_URL;
  if (typeof value === "string" && value.trim().length > 0) {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") {
        return { enabled: true, baseUrl: url.origin };
      }
    } catch {
      // fall through to same-origin
    }
    return { enabled: true, baseUrl: "" };
  }
  return { enabled: true, baseUrl: "" };
}

let cachedClient: AuthClient | undefined;

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function getBffAuthClient(environment: Record<string, string | boolean | undefined> = import.meta.env): AuthClient | undefined {
  const config = getBffAuthConfig(environment);
  if (!config.enabled) return undefined;
  if (!cachedClient) {
    let openExternal: ((url: string) => void) | undefined;
    if (config.openExternal) {
      openExternal = config.openExternal;
    } else if (isTauri() && environment.DEV !== true) {
      // Production desktop: open the corporate login page in the system
      // browser (the webview never embeds corporate login). In development
      // the webview runs on a loopback origin, so we run the OIDC flow
      // in-process instead — the session cookie then lands in the webview's
      // own jar and the app resumes the session without cross-browser cookie
      // sharing.
      openExternal = (url) => {
        void import("@tauri-apps/plugin-opener").then(({ openUrl }) => {
          void openUrl(url);
        });
      };
    }
    cachedClient = createAuthClient({ baseUrl: config.baseUrl, openExternal });
  }
  return cachedClient;
}

export function resetBffAuthClient(): void {
  cachedClient = undefined;
}

export { createAuthClient } from "./client";
export type { AuthClient, AuthSessionInfo } from "./client";
