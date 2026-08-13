import { toast } from "sonner";
import { useSessionStore } from "@/stores/sessionStore";
import { useTerminalStore } from "@/stores/terminalStore";
import { pathExists } from "./pathExists";
import { pickFolder } from "./pickFolder";

export function folderNameFromPath(path: string): string {
  const cleaned = path.replace(/[/\\]+$/, "");
  const parts = cleaned.split(/[/\\]/).filter(Boolean);
  const last = parts[parts.length - 1] ?? "Project";
  return last.replace(/^browser:\/\//, "") || "Project";
}

/** Open a known folder path as the active project (no picker). */
export async function openFolderPath(
  path: string,
  opts?: { verifyExists?: boolean },
): Promise<{ ok: true } | { ok: false; reason: "missing" | "cancelled" }> {
  const trimmed = path.trim();
  if (!trimmed) return { ok: false, reason: "cancelled" };

  if (opts?.verifyExists !== false) {
    const exists = await pathExists(trimmed);
    if (!exists) return { ok: false, reason: "missing" };
  }

  const store = useSessionStore.getState();
  const session = store.openFolderAsRepository(trimmed);
  useTerminalStore.getState().setDefaultCwd(trimmed);

  window.dispatchEvent(
    new CustomEvent("lens:project-opened", {
      detail: { path: trimmed, sessionId: session.id },
    }),
  );
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent("lens:focus-composer"));
  }, 50);

  return { ok: true };
}

/** File > Open Folder / Welcome "Open project" — same handler. */
export async function openFolder(): Promise<void> {
  const selected = await pickFolder("Open Folder");
  if (!selected) return;

  const result = await openFolderPath(selected, { verifyExists: false });
  if (result.ok) {
    toast.success("Project opened", {
      description: folderNameFromPath(selected),
    });
  }
}
