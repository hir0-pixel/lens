import { useEffect } from "react";
import { registerDefaultCommands } from "@/features/command-palette/registerDefaultCommands";
import { commandRegistry } from "@/features/command-palette/CommandRegistry";
import { useCommandStore } from "@/features/command-palette/commandStore";
import { isModKey } from "@/features/keyboard/ShortcutRegistry";
import { useLayoutStore } from "@/stores/layoutStore";

let commandsRegistered = false;

/**
 * Command palette, Quick Open, Global Search, and Go To shortcuts.
 * Layout toggles remain in useKeyboardShortcuts to avoid double-firing.
 */
export function useWorkbenchShortcuts() {
  const overlay = useCommandStore((s) => s.overlay);
  const openCommands = useCommandStore((s) => s.openCommands);
  const openQuickOpen = useCommandStore((s) => s.openQuickOpen);
  const openSearch = useCommandStore((s) => s.openSearch);
  const openSymbols = useCommandStore((s) => s.openSymbols);
  const openWorkspaceSymbols = useCommandStore((s) => s.openWorkspaceSymbols);
  const openGotoLine = useCommandStore((s) => s.openGotoLine);
  const close = useCommandStore((s) => s.close);

  useEffect(() => {
    if (!commandsRegistered) {
      registerDefaultCommands();
      commandsRegistered = true;
    }
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const inEditable =
        tag === "input" ||
        tag === "textarea" ||
        Boolean(target?.isContentEditable) ||
        Boolean(target?.classList.contains("xterm-helper-textarea"));

      if (e.key === "Escape" && overlay) {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }

      if (e.key === "F1") {
        e.preventDefault();
        openCommands();
        return;
      }

      const mod = isModKey(e);
      if (!mod) return;

      const key = e.key.toLowerCase();

      if (e.shiftKey && key === "p") {
        e.preventDefault();
        openCommands();
        return;
      }

      if (!e.shiftKey && key === "p") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("orchids:open-ide"));
        useLayoutStore.getState().openTools("editor");
        openQuickOpen();
        return;
      }

      if (!e.shiftKey && key === "n" && !e.altKey && !inEditable) {
        e.preventDefault();
        void commandRegistry.execute("orchids.chat.new");
        return;
      }

      if (!e.shiftKey && key === "o" && !e.altKey && !inEditable) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("orchids:open-folder"));
        return;
      }

      if (e.shiftKey && (key === "`" || e.code === "Backquote") && !inEditable) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("orchids:terminal-new"));
        return;
      }

      if (e.shiftKey && key === "n" && !inEditable) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("orchids:open-ide"));
        return;
      }

      if (e.shiftKey && key === "a" && !inEditable) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("orchids:new-agent"));
        return;
      }

      if (!e.shiftKey && key === "f" && !inEditable) {
        e.preventDefault();
        void commandRegistry.execute("edit.find");
        return;
      }

      if (!e.shiftKey && key === "h" && !inEditable) {
        e.preventDefault();
        void commandRegistry.execute("edit.replace");
        return;
      }

      if (!e.shiftKey && key === "s" && !inEditable) {
        e.preventDefault();
        void commandRegistry.execute("file.save");
        return;
      }

      if (e.shiftKey && key === "f") {
        e.preventDefault();
        openSearch();
        return;
      }

      if (e.shiftKey && key === "g") {
        e.preventDefault();
        useLayoutStore.getState().openTools("git");
        return;
      }

      if (e.shiftKey && key === "e") {
        e.preventDefault();
        const s = useLayoutStore.getState();
        if (s.navOpen) s.closeNav();
        else s.openExplorer();
        return;
      }

      if (e.shiftKey && key === "o") {
        e.preventDefault();
        openSymbols();
        return;
      }

      if (!e.shiftKey && key === "t" && !inEditable) {
        e.preventDefault();
        openWorkspaceSymbols();
        return;
      }

      if (!e.shiftKey && key === "g" && !inEditable) {
        e.preventDefault();
        openGotoLine();
        return;
      }

      if (key === ",") {
        e.preventDefault();
        void commandRegistry.execute("workbench.action.openSettings");
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    overlay,
    close,
    openCommands,
    openQuickOpen,
    openSearch,
    openSymbols,
    openWorkspaceSymbols,
    openGotoLine,
  ]);
}
