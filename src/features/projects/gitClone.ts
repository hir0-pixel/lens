import { isTauri } from "./platform";

export async function gitClone(
  url: string,
  dest: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const trimmedUrl = url.trim();
  const trimmedDest = dest.trim();
  if (!trimmedUrl || !trimmedDest) {
    return { ok: false, error: "URL and destination are required" };
  }

  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const path = await invoke<string>("git_clone", {
        url: trimmedUrl,
        dest: trimmedDest,
      });
      return { ok: true, path };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Browser / mock: simulate clone into a virtual path
  await new Promise((r) => setTimeout(r, 800));
  const name =
    trimmedUrl
      .replace(/\.git$/i, "")
      .split(/[/\\]/)
      .filter(Boolean)
      .pop() ?? "repo";
  return { ok: true, path: `${trimmedDest.replace(/[/\\]$/, "")}/${name}` };
}
