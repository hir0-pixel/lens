import type { ShellResult, ShellState, ShellType } from "../types";

const MOCK_FILES: Record<string, string[]> = {
  "~/dev/finance-dashboard": [
    "src/",
    "public/",
    "package.json",
    "vite.config.ts",
    "tsconfig.json",
    "README.md",
  ],
  "~/dev/finance-dashboard/src": [
    "App.tsx",
    "main.tsx",
    "index.css",
    "components/",
    "stores/",
    "lib/",
  ],
};

function normalizePath(cwd: string, target: string): string {
  if (target.startsWith("~")) return target;
  if (target.startsWith("/") || /^[A-Za-z]:/.test(target)) return target;
  const parts = [...cwd.split("/"), ...target.split("/")];
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/") || "~";
}

function listDir(cwd: string): string[] {
  return MOCK_FILES[cwd] ?? MOCK_FILES["~/dev/finance-dashboard"] ?? [];
}

function colorFile(name: string): string {
  if (name.endsWith("/")) return `\x1b[34m${name}\x1b[0m`;
  if (name.endsWith(".tsx") || name.endsWith(".ts")) return `\x1b[36m${name}\x1b[0m`;
  if (name.endsWith(".json")) return `\x1b[33m${name}\x1b[0m`;
  if (name.endsWith(".css")) return `\x1b[35m${name}\x1b[0m`;
  return name;
}

export function executeCommand(input: string, state: ShellState): ShellResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { output: "", newState: state };
  }

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    case "help":
      return {
        output: [
          "\x1b[33mAvailable commands:\x1b[0m",
          "  help          Show this help",
          "  clear         Clear the terminal",
          "  pwd           Print working directory",
          "  ls [path]     List directory contents",
          "  cd <path>     Change directory",
          "  echo <text>   Print text",
          "  npm <cmd>     Run npm (mock)",
          "  git <cmd>     Run git (mock)",
          "  node -v       Node version",
          "  exit          Close session",
        ].join("\r\n") + "\r\n",
        newState: state,
      };

    case "clear":
      return { output: "", newState: state, clear: true };

    case "pwd":
      return { output: `${state.cwd}\r\n`, newState: state };

    case "ls": {
      const target = args[0] ? normalizePath(state.cwd, args[0]) : state.cwd;
      const files = listDir(target);
      const listing = files.map(colorFile).join("  ");
      return { output: `${listing}\r\n`, newState: state };
    }

    case "cd": {
      if (!args[0]) {
        return { output: "", newState: { ...state, cwd: "~/dev/finance-dashboard" } };
      }
      const next = normalizePath(state.cwd, args[0]);
      return { output: "", newState: { ...state, cwd: next } };
    }

    case "echo":
      return { output: `${args.join(" ")}\r\n`, newState: state };

    case "node":
      if (args[0] === "-v" || args[0] === "--version") {
        return { output: "v22.11.0\r\n", newState: state };
      }
      return { output: `\x1b[31mnode: cannot execute '${args.join(" ")}'\x1b[0m\r\n`, newState: state };

    case "npm": {
      const sub = args[0] ?? "";
      if (sub === "run" && args[1] === "dev") {
        return {
          output: [
            "",
            "\x1b[32m  VITE v7.3.6\x1b[0m  ready in \x1b[33m412 ms\x1b[0m",
            "",
            "  \x1b[32m➜\x1b[0m  Local:   \x1b[36mhttp://localhost:5173/\x1b[0m",
            "  \x1b[32m➜\x1b[0m  Network: \x1b[36mhttp://192.168.1.42:5173/\x1b[0m",
            "",
          ].join("\r\n") + "\r\n",
          newState: state,
        };
      }
      if (sub === "run" && args[1] === "build") {
        return {
          output: "\x1b[32m✓\x1b[0m built in 13.48s\r\n",
          newState: state,
        };
      }
      return { output: `\x1b[90mnpm ${args.join(" ")} — mock output\x1b[0m\r\n`, newState: state };
    }

    case "git": {
      const sub = args[0] ?? "status";
      if (sub === "status") {
        return {
          output: [
            "On branch \x1b[32mmain\x1b[0m",
            "Changes not staged for commit:",
            "  \x1b[31mmodified:\x1b[0m   src/components/shell/BottomPanel.tsx",
            "  \x1b[31mmodified:\x1b[0m   src/stores/terminalStore.ts",
            "  \x1b[32mnew file:\x1b[0m   src/components/terminal/TerminalWorkspace.tsx",
          ].join("\r\n") + "\r\n",
          newState: state,
        };
      }
      if (sub === "branch") {
        return { output: "* main\r\n", newState: state };
      }
      return { output: `\x1b[90mgit ${args.join(" ")} — mock\x1b[0m\r\n`, newState: state };
    }

    case "exit":
      return { output: "\x1b[90mSession ended.\x1b[0m\r\n", newState: state, exitSession: true };

    default:
      return {
        output: `\x1b[31m${cmd}: command not found\x1b[0m\r\n`,
        newState: state,
      };
  }
}

export function defaultShellForPlatform(): ShellType {
  if (typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("win")) {
    return "powershell";
  }
  return "bash";
}
