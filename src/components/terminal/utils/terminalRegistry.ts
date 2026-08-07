import type { Terminal } from "@xterm/xterm";
import type { SearchAddon } from "@xterm/addon-search";

export interface TerminalHandle {
  terminal: Terminal;
  searchAddon: SearchAddon;
  clear: () => void;
  copy: () => void;
  paste: () => Promise<void>;
  selectAll: () => void;
  findNext: (query: string, options?: { caseSensitive?: boolean; regex?: boolean }) => void;
  findPrevious: (query: string, options?: { caseSensitive?: boolean; regex?: boolean }) => void;
  focus: () => void;
  restart: () => void;
}

const registry = new Map<string, TerminalHandle>();

export function registerTerminal(sessionId: string, handle: TerminalHandle) {
  registry.set(sessionId, handle);
}

export function unregisterTerminal(sessionId: string) {
  registry.delete(sessionId);
}

export function getTerminal(sessionId: string): TerminalHandle | undefined {
  return registry.get(sessionId);
}

export function getActiveTerminal(activeSessionId: string | null): TerminalHandle | undefined {
  if (!activeSessionId) return undefined;
  return registry.get(activeSessionId);
}
