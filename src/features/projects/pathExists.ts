import { isTauri } from "./platform";

/** Returns whether a filesystem path exists (Tauri). Browser paths assumed ok. */
export async function pathExists(path: string): Promise<boolean> {
  if (!path) return false;
  if (path.startsWith("browser://")) return true;
  if (!isTauri()) return true;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("path_exists", { path });
  } catch {
    return true;
  }
}
