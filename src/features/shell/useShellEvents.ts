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
        window.dispatchEvent(new CustomEvent("orchids:open-ide"));
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
      window.dispatchEvent(new CustomEvent("orchids:open-terminal"));
    }
    function onTerminalSplit() {
      window.dispatchEvent(new CustomEvent("orchids:open-terminal"));
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
            new CustomEvent("orchids:open-file", {
              detail: { path: `untitled-${Date.now()}.tsx` },
            }),
          );
        }
      });
    }

    window.addEventListener("orchids:view", onView);
    window.addEventListener("orchids:toggle-ai", onToggleAi);
    window.addEventListener("orchids:toggle-panel", onTogglePanel);
    window.addEventListener("orchids:terminal-new", onTerminalNew);
    window.addEventListener("orchids:terminal-split", onTerminalSplit);
    window.addEventListener("orchids:open-projects", onOpenProjectsEvt);
    window.addEventListener("orchids:open-folder", onOpenFolderEvt);
    window.addEventListener("orchids:exit", onExitEvt);
    window.addEventListener("orchids:open-settings", onOpenSettingsEvt);
    window.addEventListener("orchids:command", onCommand);
    return () => {
      window.removeEventListener("orchids:view", onView);
      window.removeEventListener("orchids:toggle-ai", onToggleAi);
      window.removeEventListener("orchids:toggle-panel", onTogglePanel);
      window.removeEventListener("orchids:terminal-new", onTerminalNew);
      window.removeEventListener("orchids:terminal-split", onTerminalSplit);
      window.removeEventListener("orchids:open-projects", onOpenProjectsEvt);
      window.removeEventListener("orchids:open-folder", onOpenFolderEvt);
      window.removeEventListener("orchids:exit", onExitEvt);
      window.removeEventListener("orchids:open-settings", onOpenSettingsEvt);
      window.removeEventListener("orchids:command", onCommand);
    };
  }, [onOpenProjects, onOpenSettings]);
}
