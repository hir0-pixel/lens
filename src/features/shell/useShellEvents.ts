import { useEffect } from "react";
import { useLayoutStore, type ActivityView } from "@/stores/layoutStore";
import { useTerminalStore } from "@/stores/terminalStore";
import { useSessionStore } from "@/stores/sessionStore";
import { commandRegistry } from "@/features/command-palette/CommandRegistry";
import { openFolder } from "@/features/projects/openFolder";
import { exitApp } from "@/features/projects/exitApp";

/**
 * Bridges menu-bar / chrome CustomEvents into layout + command systems.
 * Terminal opens as a side tools pane (Cursor-style), not only bottom.
 */
export function useShellEvents(opts: {
  onOpenProjects?: () => void;
  onOpenSettings?: (section?: string) => void;
}) {
  const { onOpenProjects, onOpenSettings } = opts;

  useEffect(() => {
    function onView(e: Event) {
      const id = (e as CustomEvent<{ id?: ActivityView }>).detail?.id;
      if (id) {
        window.dispatchEvent(new CustomEvent("lens:open-ide"));
        useLayoutStore.getState().setActivityView(id);
      }
    }
    function onToggleAi() {
      useLayoutStore.getState().toggleTools();
    }
    function onTogglePanel() {
      useLayoutStore.getState().toggleBottomPanel();
    }
    function onTerminalNew() {
      const repos = useSessionStore.getState().repositories;
      const activeId = useSessionStore.getState().activeRepositoryId;
      const cwd =
        repos.find((r) => r.id === activeId)?.path ??
        useTerminalStore.getState().defaultCwd;
      useTerminalStore.getState().createSession({ cwd });
      window.dispatchEvent(new CustomEvent("lens:open-terminal"));
    }
    function onTerminalSplit() {
      window.dispatchEvent(new CustomEvent("lens:open-terminal"));
      const { activeSessionId, splitSession } = useTerminalStore.getState();
      if (activeSessionId) splitSession(activeSessionId, "horizontal");
    }
    function onOpenProjectsEvt() {
      onOpenProjects?.();
    }
    function onOpenFolderEvt() {
      void openFolder();
    }
    function onExitEvt() {
      void exitApp();
    }
    function onOpenSettingsEvt(e: Event) {
      const section = (e as CustomEvent<{ section?: string }>).detail?.section;
      onOpenSettings?.(section);
    }
    function onCommand(e: Event) {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      void commandRegistry.execute(id).then((ok) => {
        if (ok) return;
        if (id === "file.new") {
          window.dispatchEvent(
            new CustomEvent("lens:open-file", {
              detail: { path: `untitled-${Date.now()}.tsx` },
            }),
          );
        }
      });
    }

    window.addEventListener("lens:view", onView);
    window.addEventListener("lens:toggle-ai", onToggleAi);
    window.addEventListener("lens:toggle-panel", onTogglePanel);
    window.addEventListener("lens:terminal-new", onTerminalNew);
    window.addEventListener("lens:terminal-split", onTerminalSplit);
    window.addEventListener("lens:open-projects", onOpenProjectsEvt);
    window.addEventListener("lens:open-folder", onOpenFolderEvt);
    window.addEventListener("lens:exit", onExitEvt);
    window.addEventListener("lens:open-settings", onOpenSettingsEvt);
    window.addEventListener("lens:command", onCommand);
    return () => {
      window.removeEventListener("lens:view", onView);
      window.removeEventListener("lens:toggle-ai", onToggleAi);
      window.removeEventListener("lens:toggle-panel", onTogglePanel);
      window.removeEventListener("lens:terminal-new", onTerminalNew);
      window.removeEventListener("lens:terminal-split", onTerminalSplit);
      window.removeEventListener("lens:open-projects", onOpenProjectsEvt);
      window.removeEventListener("lens:open-folder", onOpenFolderEvt);
      window.removeEventListener("lens:exit", onExitEvt);
      window.removeEventListener("lens:open-settings", onOpenSettingsEvt);
      window.removeEventListener("lens:command", onCommand);
    };
  }, [onOpenProjects, onOpenSettings]);
}
