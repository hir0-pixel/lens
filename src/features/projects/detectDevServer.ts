import { isTauri } from "./platform";

const COMMON_PORTS = [5173, 3000, 4173, 8080, 4200, 8000, 4321];

/** Probe localhost for a running dev server; returns URL or null. */
export async function detectDevServerUrl(): Promise<string | null> {
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      for (const port of COMMON_PORTS) {
        const open = await invoke<boolean>("port_is_open", { port });
        if (open) return `http://localhost:${port}`;
      }
      return null;
    } catch {
      /* fall through */
    }
  }

  for (const port of COMMON_PORTS) {
    try {
      const ctrl = new AbortController();
      const t = window.setTimeout(() => ctrl.abort(), 150);
      await fetch(`http://127.0.0.1:${port}/`, {
        mode: "no-cors",
        signal: ctrl.signal,
      });
      window.clearTimeout(t);
      return `http://localhost:${port}`;
    } catch {
      /* try next */
    }
  }
  return null;
}
