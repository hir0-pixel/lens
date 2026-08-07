export type ShortcutPlatform = "windows" | "macos" | "linux";

export type ShortcutScope =
  | "global"
  | "workspace"
  | "editor"
  | "terminal"
  | "browser"
  | "ai"
  | "command-palette";

export interface Keybinding {
  /** Chord like "mod+shift+p" or "mod+k mod+s" */
  keys: string;
  commandId: string;
  scope: ShortcutScope;
  when?: string;
  platform?: ShortcutPlatform | "all";
}

export interface ResolvedChord {
  parts: string[][];
}

function detectPlatform(): ShortcutPlatform {
  if (typeof navigator === "undefined") return "windows";
  const p = navigator.platform.toLowerCase();
  if (p.includes("mac")) return "macos";
  if (p.includes("linux")) return "linux";
  return "windows";
}

export function getPlatform(): ShortcutPlatform {
  return detectPlatform();
}

export function isModKey(e: KeyboardEvent): boolean {
  return getPlatform() === "macos" ? e.metaKey : e.ctrlKey;
}

/** Normalize a binding string for comparison. */
export function normalizeBinding(keys: string): string {
  return keys
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/cmd|command|meta/g, "mod")
    .replace(/control|ctrl/g, "mod")
    .replace(/option|opt/g, "alt")
    .trim();
}

/** Format binding for display (platform-aware). */
export function formatShortcut(keys: string): string {
  const platform = getPlatform();
  const isMac = platform === "macos";

  return keys
    .split(" ")
    .map((chord) =>
      chord
        .split("+")
        .map((part) => {
          const p = part.toLowerCase();
          if (p === "mod" || p === "ctrl" || p === "cmd" || p === "meta") {
            return isMac ? "⌘" : "Ctrl";
          }
          if (p === "shift") return isMac ? "⇧" : "Shift";
          if (p === "alt" || p === "option") return isMac ? "⌥" : "Alt";
          if (p === "enter") return isMac ? "⏎" : "Enter";
          if (p === "escape" || p === "esc") return "Esc";
          if (p === "backspace") return isMac ? "⌫" : "Backspace";
          if (p === "`") return "`";
          return part.length === 1 ? part.toUpperCase() : part;
        })
        .join(isMac ? "" : "+"),
    )
    .join(" ");
}

export function eventToBinding(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (isModKey(e)) parts.push("mod");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");

  let key = e.key;
  if (key === " ") key = "space";
  if (key.length === 1) key = key.toLowerCase();
  else key = key.toLowerCase();

  // Ignore pure modifiers
  if (["control", "meta", "shift", "alt"].includes(key)) {
    return parts.join("+");
  }

  parts.push(key === "escape" ? "escape" : key);
  return parts.join("+");
}

export function matchesBinding(e: KeyboardEvent, binding: string): boolean {
  const normalized = normalizeBinding(binding);
  // Multi-key chords (mod+k mod+s) need chord state — single chord only here
  const chords = normalized.split(" ");
  if (chords.length > 1) return false;
  return eventToBinding(e) === chords[0];
}

class ShortcutRegistryImpl {
  private bindings: Keybinding[] = [];
  private conflicts: Array<{ a: Keybinding; b: Keybinding }> = [];

  register(binding: Keybinding): void {
    const platform = getPlatform();
    if (binding.platform && binding.platform !== "all" && binding.platform !== platform) {
      return;
    }

    const existing = this.bindings.find(
      (b) =>
        normalizeBinding(b.keys) === normalizeBinding(binding.keys) &&
        b.scope === binding.scope,
    );
    if (existing && existing.commandId !== binding.commandId) {
      this.conflicts.push({ a: existing, b: binding });
    }
    this.bindings.push(binding);
  }

  registerMany(bindings: Keybinding[]): void {
    bindings.forEach((b) => this.register(b));
  }

  getByCommand(commandId: string): Keybinding | undefined {
    return this.bindings.find((b) => b.commandId === commandId);
  }

  getAll(): Keybinding[] {
    return [...this.bindings];
  }

  getConflicts() {
    return [...this.conflicts];
  }

  findCommand(e: KeyboardEvent, scope?: ShortcutScope): string | null {
    const eventBinding = eventToBinding(e);
    for (const b of this.bindings) {
      if (scope && b.scope !== scope && b.scope !== "global") continue;
      if (normalizeBinding(b.keys) === eventBinding) {
        return b.commandId;
      }
    }
    return null;
  }
}

export const shortcutRegistry = new ShortcutRegistryImpl();

/** Default Orchids / Cursor-aligned keybindings. */
export const DEFAULT_KEYBINDINGS: Keybinding[] = [
  { keys: "mod+shift+p", commandId: "workbench.action.showCommands", scope: "global" },
  { keys: "f1", commandId: "workbench.action.showCommands", scope: "global" },
  { keys: "mod+p", commandId: "workbench.action.quickOpen", scope: "global" },
  { keys: "mod+shift+f", commandId: "workbench.action.findInFiles", scope: "global" },
  { keys: "mod+shift+o", commandId: "workbench.action.gotoSymbol", scope: "global" },
  { keys: "mod+t", commandId: "workbench.action.showAllSymbols", scope: "global" },
  { keys: "mod+g", commandId: "workbench.action.gotoLine", scope: "global" },
  { keys: "mod+b", commandId: "workbench.action.toggleSidebar", scope: "global" },
  { keys: "mod+l", commandId: "workbench.action.toggleAiPanel", scope: "global" },
  { keys: "mod+j", commandId: "workbench.action.toggleBottomPanel", scope: "global" },
  { keys: "mod+`", commandId: "workbench.action.toggleBottomPanel", scope: "global" },
  { keys: "mod+,", commandId: "workbench.action.openSettings", scope: "global" },
  { keys: "mod+shift+e", commandId: "workbench.view.explorer", scope: "workspace" },
  { keys: "mod+shift+g", commandId: "workbench.view.scm", scope: "workspace" },
  { keys: "escape", commandId: "workbench.action.closeOverlay", scope: "command-palette" },
];

shortcutRegistry.registerMany(DEFAULT_KEYBINDINGS);
