/**
 * Open / focus separate OS windows — Cursor-style Agents vs IDE.
 * Uses Tauri WebviewWindow when available; falls back to window.open in browser.
 */

const IDE_LABEL = "ide";
const AGENTS_LABEL = "main";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function getWindowMode(): "agents" | "ide" | "file-editor" {
  if (typeof window === "undefined") return "agents";
  const q = new URLSearchParams(window.location.search);
  if (q.get("window") === "file-editor" || q.has("filePath")) return "file-editor";
  if (q.get("window") === "ide") return "ide";
  return "agents";
}

export async function openFileWindow(filePath: string): Promise<void> {
  const encodedPath = encodeURIComponent(filePath);
  const url = `${window.location.origin}${window.location.pathname}?window=file-editor&filePath=${encodedPath}`;
  const label = `file-${filePath.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  if (isTauri()) {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        await existing.setFocus();
        await existing.unminimize();
        return;
      }
      const fileWin = new WebviewWindow(label, {
        url: `?window=file-editor&filePath=${encodedPath}`,
        title: `Edit ${filePath}`,
        width: 1000,
        height: 720,
        minWidth: 600,
        minHeight: 400,
        center: true,
        focus: true,
        decorations: true,
        resizable: true,
      });
      fileWin.once("tauri://error", () => {
        window.open(url, label, "width=1000,height=720");
      });
      return;
    } catch (err) {
      console.warn("Tauri file window failed, fallback to popup", err);
    }
  }

  const popup = window.open(url, label, "width=1000,height=720,menubar=no");
  popup?.focus();
}

export async function openIdeWindow(): Promise<void> {
  const url = `${window.location.origin}${window.location.pathname}?window=ide`;

  if (isTauri()) {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const existing = await WebviewWindow.getByLabel(IDE_LABEL);
      if (existing) {
        await existing.setFocus();
        await existing.unminimize();
        return;
      }
      const ide = new WebviewWindow(IDE_LABEL, {
        url: "?window=ide",
        title: "IDE",
        width: 1440,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        center: true,
        focus: true,
        decorations: true,
        resizable: true,
      });
      ide.once("tauri://error", (e) => {
        console.error("Failed to create IDE window", e);
        window.open(url, "lens-ide", "width=1440,height=900");
      });
      return;
    } catch (err) {
      console.warn("Tauri IDE window failed, using browser popup", err);
    }
  }

  const popup = window.open(url, "lens-ide", "width=1440,height=900,menubar=no");
  popup?.focus();
}

export async function openAgentsWindow(): Promise<void> {
  if (isTauri()) {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const main = await WebviewWindow.getByLabel(AGENTS_LABEL);
      if (main) {
        await main.setFocus();
        await main.unminimize();
        return;
      }
      // Main may be labeled differently — try current + all
      const { getCurrentWebviewWindow } = await import(
        "@tauri-apps/api/webviewWindow"
      );
      const current = getCurrentWebviewWindow();
      if (current.label !== IDE_LABEL) {
        await current.setFocus();
        return;
      }
    } catch (err) {
      console.warn("Focus agents window failed", err);
    }
  }

  // Browser: focus opener or navigate
  if (window.opener && !window.opener.closed) {
    (window.opener as Window).focus();
    return;
  }
  window.open(
    `${window.location.origin}${window.location.pathname}?window=agents`,
    "lens-agents",
    "width=1440,height=900",
  );
}
