import type { ITerminalOptions } from "@xterm/xterm";

/** Windows console palette used by Cursor's PowerShell terminal on Windows. */
export const TERMINAL_THEME: NonNullable<ITerminalOptions["theme"]> = {
  background: "#0C0C0C",
  foreground: "#F2F2F2",
  cursor: "#F2F2F2",
  cursorAccent: "#0C0C0C",
  selectionBackground: "rgba(0,120,212,0.35)",
  black: "#0C0C0C",
  red: "#C50F1F",
  green: "#13A10E",
  // PSReadLine uses DarkYellow for commands and DarkGray for parameters.
  yellow: "#C19C00",
  blue: "#0037DA",
  magenta: "#881798",
  cyan: "#3A96DD",
  white: "#CCCCCC",
  brightBlack: "#767676",
  brightRed: "#E74856",
  brightGreen: "#16C60C",
  brightYellow: "#F9F1A5",
  brightBlue: "#3B78FF",
  brightMagenta: "#B4009E",
  brightCyan: "#61D6D6",
  brightWhite: "#F2F2F2",
};

export const TERMINAL_OPTIONS: ITerminalOptions = {
  fontFamily:
    'Consolas, "Cascadia Mono", "Cascadia Code", "Courier New", monospace',
  fontSize: 13,
  fontWeight: 400,
  lineHeight: 1,
  letterSpacing: 0,
  theme: TERMINAL_THEME,
  cursorBlink: true,
  cursorStyle: "bar",
  cursorWidth: 2,
  cursorInactiveStyle: "outline",
  scrollback: 10000,
  allowProposedApi: true,
  smoothScrollDuration: 125,
};

export function getPrompt(shell: string, cwd: string): string {
  const short = cwd.split(/[/\\]/).pop() || cwd;
  switch (shell) {
    case "powershell":
      return `\x1b[33mPS\x1b[0m ${short}> `;
    case "cmd":
      return `${cwd}>`;
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
