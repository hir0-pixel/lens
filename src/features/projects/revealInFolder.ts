import { isTauri } from "@/features/projects/platform";

/** Reveal a path in the OS file manager (Explorer / Finder). */
export async function revealInFolder(path: string): Promise<boolean> {
  if (!path || path.startsWith("browser://")) return false;
  if (isTauri()) {
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(path);
      return true;
    } catch {
      try {
        const { openPath } = await import("@tauri-apps/plugin-opener");
        await openPath(path);
        return true;
      } catch {
        return false;
      }
    }
  }
  return false;
}
