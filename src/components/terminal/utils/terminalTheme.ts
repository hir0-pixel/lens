import type { ITerminalOptions } from "@xterm/xterm";

/** Windows console palette used by Cursor's PowerShell terminal on Windows. */
export const DARK_TERMINAL_THEME: NonNullable<ITerminalOptions["theme"]> = {
  background: "#141312",
  foreground: "#fdfbfa",
  cursor: "#fdfbfa",
  cursorAccent: "#141312",
  selectionBackground: "color-mix(in srgb, #26d862 35%, transparent)",
  black: "#1f2121",
  red: "#b91c1c",
  green: "#26d862",
  // PSReadLine uses DarkYellow for commands and DarkGray for parameters.
  yellow: "#f5a623",
  blue: "#b5cef5",
  magenta: "#7183ff",
  cyan: "#32b8c6",
  white: "#fdfbfa",
  brightBlack: "#818581",
  brightRed: "#fecaca",
  brightGreen: "#5be987",
  brightYellow: "#ffefcf",
  brightBlue: "#d2e3fc",
  brightMagenta: "#b5cef5",
  brightCyan: "#b3e5ed",
  brightWhite: "#fdfbfa",
};

export const LIGHT_TERMINAL_THEME: NonNullable<ITerminalOptions["theme"]> = {
  background: "#f1f0ec",
  foreground: "#26251e",
  cursor: "#26251e",
  cursorAccent: "#f1f0ec",
  selectionBackground: "#e6e5e0",
  black: "#26251e",
  red: "#b91c1c",
  green: "#1d3023",
  yellow: "#ab570a",
  blue: "#001d3c",
  magenta: "#7183ff",
  cyan: "#147786",
  white: "#5f6368",
  brightBlack: "#818581",
  brightRed: "#fecaca",
  brightGreen: "#26d862",
  brightYellow: "#f5a623",
  brightBlue: "#1a73e8",
  brightMagenta: "#7183ff",
  brightCyan: "#32b8c6",
  brightWhite: "#26251e",
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
