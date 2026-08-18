import { useEffect } from "react";
import TitleBar from "@/components/TitleBar";
import { ToolsWorkspace } from "@/components/workspace/ToolsWorkspace";
import StatusBar from "@/components/shell/StatusBar";
import { WorkspaceNavRail } from "@/components/workspace/WorkspaceNavRail";
import { WorkspaceNavigator } from "@/components/workspace/WorkspaceNavigator";
import { WorkbenchOverlays } from "@/features/command-palette/WorkbenchOverlays";
import SettingsDialog from "@/components/settings/SettingsDialog";
import { useLayoutStore } from "@/stores/layoutStore";
import { INITIAL_PROJECTS, MODELS } from "@/lib/mock-data";
import { openAgentsWindow } from "@/features/windows/openAppWindow";
import { useState } from "react";

/**
 * Separate IDE OS window — full editor shell only.
 */
export default function IdeWindowApp() {
  const navOpen = useLayoutStore((s) => s.navOpen);
  const openExplorer = useLayoutStore((s) => s.openExplorer);
  const openTools = useLayoutStore((s) => s.openTools);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const project = INITIAL_PROJECTS.find((p) => p.name === "Haytham_poc") ?? INITIAL_PROJECTS[0];
  const model = MODELS[0];

  useEffect(() => {
    document.title = "IDE";
    openExplorer();
    openTools("editor");
    window.setTimeout(() => {
      try {
        const path = localStorage.getItem("lens-ide-open-path");
        if (path) {
          window.dispatchEvent(
            new CustomEvent("lens:open-file", { detail: { path } }),
          );
          localStorage.removeItem("lens-ide-open-path");
        } else {
          window.dispatchEvent(new CustomEvent("lens:focus-editor"));
        }
      } catch {
        window.dispatchEvent(new CustomEvent("lens:focus-editor"));
      }
    }, 50);
  }, [openExplorer, openTools]);

  useEffect(() => {
    function onSettings() {
      setSettingsOpen(true);
    }
    window.addEventListener("lens:open-settings", onSettings);
    return () => window.removeEventListener("lens:open-settings", onSettings);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-[var(--bg-canvas)] font-sans text-[var(--text-primary)] antialiased">
      <TitleBar
        projectName={project.name}
        variant="ide"
        onOpenSettings={() => setSettingsOpen(true)}
        onAgentsWindow={() => void openAgentsWindow()}
        onOpenTerminal={() => {
          window.dispatchEvent(new CustomEvent("lens:toggle-panel"));
        }}
      />

      <div className="flex min-h-0 flex-1">
        <div className="w-12 shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <WorkspaceNavRail onOpenSettings={() => setSettingsOpen(true)} />
        </div>

        {navOpen && (
          <div className="w-[260px] shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <WorkspaceNavigator
              projects={INITIAL_PROJECTS}
              activeProjectId={project.id}
            />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <ToolsWorkspace />
        </div>
      </div>

      <StatusBar project={project} model={model} credits={2_000_000} />
      <WorkbenchOverlays />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
