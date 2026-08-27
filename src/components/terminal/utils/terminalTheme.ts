import type { ITerminalOptions } from "@xterm/xterm";

/** Windows console palette used by Cursor's PowerShell terminal on Windows. */
export const DARK_TERMINAL_THEME: NonNullable<ITerminalOptions["theme"]> = {
  background: "#0a0a0a",
  foreground: "#ffffff",
  cursor: "#ffffff",
  cursorAccent: "#0a0a0a",
  selectionBackground: "color-mix(in srgb, #0070f3 35%, transparent)",
  black: "#171717",
  red: "#ee0000",
  green: "#0070f3",
  // PSReadLine uses DarkYellow for commands and DarkGray for parameters.
  yellow: "#f5a623",
  blue: "#0761d1",
  magenta: "#7928ca",
  cyan: "#0070f3",
  white: "#a1a1a1",
  brightBlack: "#8f8f8f",
  brightRed: "#ff4d4d",
  brightGreen: "#50e3c2",
  brightYellow: "#ffefcf",
  brightBlue: "#007cf0",
  brightMagenta: "#ff0080",
  brightCyan: "#00dfd8",
  brightWhite: "#ffffff",
};

export const LIGHT_TERMINAL_THEME: NonNullable<ITerminalOptions["theme"]> = {
  background: "#fafafa",
  foreground: "#171717",
  cursor: "#171717",
  cursorAccent: "#fafafa",
  selectionBackground: "#d3e5ff",
  black: "#171717",
  red: "#ee0000",
  green: "#0761d1",
  yellow: "#ab570a",
  blue: "#0761d1",
  magenta: "#7928ca",
  cyan: "#0070f3",
  white: "#4d4d4d",
  brightBlack: "#8f8f8f",
  brightRed: "#ff4d4d",
  brightGreen: "#0070f3",
  brightYellow: "#f5a623",
  brightBlue: "#007cf0",
  brightMagenta: "#ff0080",
  brightCyan: "#00a6a6",
  brightWhite: "#171717",
};

export function getTerminalTheme(isDark: boolean): NonNullable<ITerminalOptions["theme"]> {
  return isDark ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME;
}

export const TERMINAL_OPTIONS: ITerminalOptions = {
  fontFamily:
    'Consolas, "Cascadia Mono", "Cascadia Code", "Courier New", monospace',
  fontSize: 13,
  fontWeight: 400,
  lineHeight: 1,
  letterSpacing: 0,
  theme: DARK_TERMINAL_THEME,
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
