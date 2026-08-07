import { isTauri } from "./platform";

/**
 * Native directory picker (Tauri dialog / File System Access / prompt fallback).
 * Returns absolute path string, or null if cancelled.
 */
export async function pickFolder(
  title = "Open Folder",
): Promise<string | null> {
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title,
      });
      if (typeof selected === "string" && selected.length > 0) return selected;
      return null;
    } catch (err) {
      console.warn("Tauri dialog failed, falling back", err);
    }
  }

  // Browser File System Access API (Chrome/Edge) — path may be a display name only
  const w = window as Window & {
    showDirectoryPicker?: () => Promise<{ name: string }>;
  };
  if (typeof w.showDirectoryPicker === "function") {
    try {
      const handle = await w.showDirectoryPicker();
      // Browsers don't expose absolute paths; store a stable pseudo-path
      return `browser://${handle.name}`;
    } catch {
      return null; // user cancel
    }
  }

  const typed = window.prompt(
    `${title}\nEnter a folder path:`,
    typeof navigator !== "undefined" && /Win/i.test(navigator.platform)
      ? "C:\\Users"
      : "~",
  );
  return typed?.trim() || null;
}
