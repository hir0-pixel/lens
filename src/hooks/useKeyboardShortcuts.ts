import { useEffect } from "react";
import { useLayoutStore } from "@/stores/layoutStore";

/**
 * Layout shortcuts — agent-first: surfaces open on demand.
 * Ctrl+B / Ctrl+Shift+E — explorer · Ctrl+L — tools · Ctrl+J / ` — utility
 */
export function useKeyboardShortcuts() {
  const toggleNav = useLayoutStore((s) => s.toggleNav);
  const toggleTools = useLayoutStore((s) => s.toggleTools);
  const toggleBottomPanel = useLayoutStore((s) => s.toggleBottomPanel);
  const openBottomPanel = useLayoutStore((s) => s.openBottomPanel);
  const bottomPanelOpen = useLayoutStore((s) => s.bottomPanelOpen);
  const setBottomPanelTab = useLayoutStore((s) => s.setBottomPanelTab);
  const setBottomPanelSlim = useLayoutStore((s) => s.setBottomPanelSlim);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "F5" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        // Debug adapter not configured — surface the panel with a clear empty state
        window.dispatchEvent(
          new CustomEvent("orchids:view", { detail: { id: "debug" } }),
        );
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      // Palette owns Ctrl+P / Ctrl+Shift+P / Ctrl+Shift+F / Ctrl+Shift+E / Ctrl+,
      if (
        e.key.toLowerCase() === "p" ||
        e.key.toLowerCase() === "f" ||
        e.key.toLowerCase() === "e" ||
        e.key === ","
      ) {
        return;
      }

      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        toggleNav();
      } else if ((e.key === "l" || e.key === "L") && !e.shiftKey) {
        e.preventDefault();
        toggleTools();
      } else if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        toggleBottomPanel();
      } else if (e.key === "`") {
        e.preventDefault();
        if (bottomPanelOpen) {
          toggleBottomPanel();
        } else {
          openBottomPanel("terminal");
          setBottomPanelTab("terminal");
          setBottomPanelSlim(false);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    toggleNav,
    toggleTools,
    toggleBottomPanel,
    openBottomPanel,
    bottomPanelOpen,
    setBottomPanelTab,
    setBottomPanelSlim,
  ]);
}
