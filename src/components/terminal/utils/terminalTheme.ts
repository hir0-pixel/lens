import type { ITerminalOptions } from "@xterm/xterm";

/** Cursor / VS Code Dark+ terminal palette */
export const TERMINAL_THEME: NonNullable<ITerminalOptions["theme"]> = {
  background: "#1F1F1F",
  foreground: "#CCCCCC",
  cursor: "#AEAFAD",
  cursorAccent: "#1F1F1F",
  selectionBackground: "rgba(0,120,212,0.35)",
  black: "#000000",
  red: "#CD3131",
  green: "#0DBC79",
  yellow: "#E5E510",
  blue: "#2472C8",
  magenta: "#BC3FBC",
  cyan: "#11A8CD",
  white: "#E5E5E5",
  brightBlack: "#666666",
  brightRed: "#F14C4C",
  brightGreen: "#23D18B",
  brightYellow: "#F5F543",
  brightBlue: "#3B8EEA",
  brightMagenta: "#D670D6",
  brightCyan: "#29B8DB",
  brightWhite: "#E5E5E5",
};

export const TERMINAL_OPTIONS: ITerminalOptions = {
  fontFamily:
    '"JetBrains Mono", "Cascadia Code", Consolas, "Courier New", monospace',
  fontSize: 14,
  lineHeight: 1.2,
  theme: TERMINAL_THEME,
  cursorBlink: true,
  cursorStyle: "block",
  scrollback: 10000,
  allowProposedApi: true,
  smoothScrollDuration: 125,
};

export function getPrompt(shell: string, cwd: string): string {
  const short = cwd.split(/[/\\]/).pop() || cwd;
  switch (shell) {
    case "powershell":
      return `\r\n\x1b[33mPS\x1b[0m ${short}> `;
    case "cmd":
      return `\r\n${cwd}>`;
    default:
      return `\r\n\x1b[32m➜\x1b[0m  \x1b[36m${short}\x1b[0m `;
  }
}

export function getBootLines(
  _projectName: string,
  cwd: string,
  shell: string,
): string[] {
  return [
    `\x1b[90m${shell} · ${cwd}\x1b[0m`,
    "",
  ];
}
