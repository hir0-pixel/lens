import { CommandPalette } from "@/features/command-palette/CommandPalette";
import { GlobalSearchPanel } from "@/features/global-search/GlobalSearchPanel";
import { useWorkbenchShortcuts } from "@/features/keyboard/useWorkbenchShortcuts";

/**
 * Mounts Command Palette + Global Search overlays and wires shortcuts.
 */
export function WorkbenchOverlays() {
  useWorkbenchShortcuts();

  return (
    <>
      <CommandPalette />
      <GlobalSearchPanel />
    </>
  );
}
