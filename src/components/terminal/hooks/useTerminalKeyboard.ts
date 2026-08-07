import { useEffect } from "react";
import { useTerminalStore } from "@/stores/terminalStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { getActiveTerminal } from "@/components/terminal/utils/terminalRegistry";

export function useTerminalKeyboard() {
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const createSession = useTerminalStore((s) => s.createSession);
  const closeSession = useTerminalStore((s) => s.closeSession);
  const setActiveSession = useTerminalStore((s) => s.setActiveSession);
  const setSearch = useTerminalStore((s) => s.setSearch);
  const sessions = useTerminalStore((s) => s.sessions);
  const setBottomPanelTab = useLayoutStore((s) => s.setBottomPanelTab);
  const bottomPanelOpen = useLayoutStore((s) => s.bottomPanelOpen);
  const toggleBottomPanel = useLayoutStore((s) => s.toggleBottomPanel);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement;
      const inTerminal =
        target.closest("[data-terminal-workspace]") !== null ||
        target.classList.contains("xterm-helper-textarea");

      if (!inTerminal && !bottomPanelOpen) return;

      if (mod && e.shiftKey && e.key === "`") {
        e.preventDefault();
        if (!bottomPanelOpen) toggleBottomPanel();
        setBottomPanelTab("terminal");
        createSession();
        return;
      }

      if (mod && e.key.toLowerCase() === "f" && inTerminal) {
        e.preventDefault();
        setSearch({ open: true });
        return;
      }

      if (mod && e.shiftKey && e.key === "5" && inTerminal) {
        e.preventDefault();
        getActiveTerminal(activeSessionId)?.clear();
        return;
      }

      if (mod && e.key === "Tab" && inTerminal && sessions.length > 1) {
        e.preventDefault();
        const idx = sessions.findIndex((s) => s.id === activeSessionId);
        const next = e.shiftKey
          ? sessions[(idx - 1 + sessions.length) % sessions.length]
          : sessions[(idx + 1) % sessions.length];
        if (next) setActiveSession(next.id);
        return;
      }

      if (mod && e.key === "w" && inTerminal && activeSessionId) {
        e.preventDefault();
        closeSession(activeSessionId);
        return;
      }

      if (e.key === "Escape" && inTerminal) {
        const searchOpen = useTerminalStore.getState().search.open;
        if (searchOpen) {
          e.preventDefault();
          setSearch({ open: false, query: "" });
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeSessionId,
    bottomPanelOpen,
    closeSession,
    createSession,
    sessions,
    setActiveSession,
    setBottomPanelTab,
    setSearch,
    toggleBottomPanel,
  ]);
}
