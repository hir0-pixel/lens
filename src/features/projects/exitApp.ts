import { isTauri } from "./platform";

/** Close the current Orchids window (Tauri) or browser tab. */
export async function exitApp(): Promise<void> {
  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
      return;
    } catch {
      /* fall through */
    }
  }
  window.close();
}
