import { isTauri } from "@/features/projects/platform";
import type { ShellResult, ShellState } from "../types";

/**
 * Execute real terminal commands on the user's OS when running in Tauri,
 * with fallbacks for built-in navigation and shell utilities.
 */
export async function executeRealCommand(
  input: string,
  state: ShellState,
  onStreamOutput?: (text: string) => void,
): Promise<ShellResult> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { output: "", newState: state };
  }

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  // Built-in terminal navigation
  if (cmd === "clear" || cmd === "cls") {
    return { output: "", newState: state, clear: true };
  }

  if (cmd === "pwd") {
    return { output: `${state.cwd}\r\n`, newState: state };
  }

  if (cmd === "cd") {
    const target = args[0] || "~";
    let nextCwd = state.cwd;
    if (target === "~") {
      nextCwd = "C:/Users/PMYLS";
    } else if (target.startsWith("/") || /^[A-Za-z]:/.test(target)) {
      nextCwd = target;
    } else {
      nextCwd = `${state.cwd}/${target}`.replace(/\/+/g, "/");
    }
    return { output: "", newState: { ...state, cwd: nextCwd } };
  }

  if (cmd === "exit") {
    return { output: "\x1b[90mSession terminated\x1b[0m\r\n", newState: state, exitSession: true };
  }

  // Attempt Real OS Command execution via Tauri shell
  if (isTauri()) {
    try {
      // Dynamic import for Tauri plugin shell with vite-ignore annotation
      const shellPkg = "@tauri-apps/plugin-shell";
      const tauriShell: any = await import(/* @vite-ignore */ shellPkg).catch(() => null);
      if (tauriShell?.Command) {
        const isWin = typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");
        const program = isWin ? "powershell.exe" : "bash";
        const programArgs = isWin ? ["-NoProfile", "-Command", input] : ["-c", input];

        const command = tauriShell.Command.create(program, programArgs, {
          cwd: state.cwd.startsWith("~") ? undefined : state.cwd,
        });

        let accumulated = "";

        command.on("close", (data: { code: number }) => {
          if (data.code !== 0) {
            onStreamOutput?.(`\r\n\x1b[31mProcess exited with code ${data.code}\x1b[0m\r\n`);
          }
        });

        command.stdout.on("data", (data: string) => {
          const formatted = data.replace(/\n/g, "\r\n");
          accumulated += formatted;
          onStreamOutput?.(formatted);
        });

        command.stderr.on("data", (data: string) => {
          const formatted = `\x1b[31m${data.replace(/\n/g, "\r\n")}\x1b[0m`;
          accumulated += formatted;
          onStreamOutput?.(formatted);
        });

        await command.spawn();
        return { output: "", newState: state };
      }
    } catch (err) {
      console.warn("Tauri shell spawn failed", err);
      return { output: `\x1b[31mError spawning Tauri shell: ${err}\x1b[0m\r\n`, newState: state };
    }
  }

  return {
    output: `\x1b[31mCommand execution is only supported in Desktop mode.\x1b[0m\r\n`,
    newState: state,
  };
}
