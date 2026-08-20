import { isTauri } from "@/features/projects/platform";
import type { ShellResult, ShellState } from "../types";

/**
 * Execute real terminal commands on the user's OS when running in Tauri,
 * with fallbacks for built-in navigation and shell utilities.
 */
export async function executeRealCommand(
  input: string,
  state: ShellState,
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
      nextCwd = "~";
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
      const tauriShell: any = await import("@tauri-apps/plugin-shell").catch(() => null);
      if (tauriShell?.Command) {
        const isWin = typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");
        const program = isWin
          ? state.shell === "cmd"
            ? "cmd.exe"
            : "powershell.exe"
          : state.shell === "zsh"
            ? "zsh"
            : "bash";
        const programArgs = isWin
          ? state.shell === "cmd"
            ? ["/d", "/s", "/c", input]
            : ["-NoProfile", "-Command", input]
          : ["-c", input];

        const command = tauriShell.Command.create(program, programArgs, {
          cwd: state.cwd.startsWith("~") ? undefined : state.cwd,
        });

        // `execute()` resolves only after the command exits and includes all
        // output, so the next prompt is always drawn after the result.
        const output = await command.execute();
        const normalize = (text: string) => text.replace(/\r?\n/g, "\r\n");
        const stdout = normalize(output.stdout);
        const stderr = output.stderr
          ? `\x1b[31m${normalize(output.stderr)}\x1b[0m`
          : "";
        const exit = output.code && output.code !== 0
          ? `\x1b[31mProcess exited with code ${output.code}\x1b[0m`
          : "";
        const combined = [stdout, stderr, exit].filter(Boolean).join("");
        return {
          output: combined && !combined.endsWith("\r\n") ? `${combined}\r\n` : combined,
          newState: state,
        };
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
