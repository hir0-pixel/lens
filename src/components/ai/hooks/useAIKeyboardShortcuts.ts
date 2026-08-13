import { useEffect } from "react";

interface UseAIKeyboardShortcutsOptions {
  onFocusComposer: () => void;
  onEscape: () => void;
  enabled?: boolean;
}

export function useAIKeyboardShortcuts({
  onFocusComposer,
  onEscape,
  enabled = true,
}: UseAIKeyboardShortcutsOptions) {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "i") {
        e.preventDefault();
        onFocusComposer();
        return;
      }

      if (e.key === "Escape") {
        onEscape();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    function onFocusEvent() {
      onFocusComposer();
    }
    window.addEventListener("lens:focus-composer", onFocusEvent);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("lens:focus-composer", onFocusEvent);
    };
  }, [enabled, onFocusComposer, onEscape]);
}
