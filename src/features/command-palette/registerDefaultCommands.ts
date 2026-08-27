import {
  Bot,
  FileCode2,
  FolderOpen,
  GitBranch,
  Hash,
  Keyboard,
  LayoutPanelLeft,
  MessageSquare,
  PanelBottom,
  Save,
  Search,
  Settings,
  Terminal,
  Type,
} from "@/components/icons/tabler";
import { toast } from "sonner";
import { commandRegistry } from "./CommandRegistry";
import { useCommandStore } from "./commandStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { formatShortcut } from "@/features/keyboard/ShortcutRegistry";

/** Enter agent+tools workspace from empty home when a View/Go command needs IDE chrome. */
function ensureIde() {
  window.dispatchEvent(new CustomEvent("lens:open-ide"));
}

/**
 * Registers IDE commands that call existing layout/store APIs.
 * Safe to call once at app boot (idempotent overwrite).
 */
export function registerDefaultCommands(): void {
  const open = () => useCommandStore.getState();

  commandRegistry.registerMany([
    {
      id: "file.new",
      title: "New File",
      category: "File",
      icon: FileCode2,
      shortcut: formatShortcut("mod+alt+n"),
      keywords: ["untitled", "create"],
      run: () => {
        window.dispatchEvent(
          new CustomEvent("lens:open-file", {
            detail: { path: `untitled-${Date.now()}.tsx` },
          }),
        );
      },
    },
    {
      id: "file.openFolder",
      title: "Open Folder…",
      category: "File",
      icon: FolderOpen,
      shortcut: formatShortcut("mod+o"),
      keywords: ["project", "directory", "repo"],
      run: () => {
        window.dispatchEvent(new CustomEvent("lens:open-folder"));
      },
    },
    {
      id: "file.save",
      title: "Save",
      category: "File",
      icon: Save,
      shortcut: formatShortcut("mod+s"),
      run: () => {
        toast.success("Saved", { description: "Active file saved" });
      },
    },
    {
      id: "file.saveAll",
      title: "Save All",
      category: "File",
      icon: Save,
      run: () => {
        toast.success("Saved all", { description: "All dirty editors saved" });
      },
    },
    {
      id: "lens.chat.new",
      title: "New Chat",
      category: "AI",
      icon: MessageSquare,
      shortcut: formatShortcut("mod+n"),
      keywords: ["session", "agent", "new"],
      run: () => {
        window.dispatchEvent(new CustomEvent("lens:new-agent"));
      },
    },
    {
      id: "edit.find",
      title: "Find",
      category: "Edit",
      icon: Search,
      shortcut: formatShortcut("mod+f"),
      run: () => open().openSearch(),
    },
    {
      id: "edit.replace",
      title: "Replace",
      category: "Edit",
      icon: Search,
      shortcut: formatShortcut("mod+h"),
      run: () => open().openSearch(),
    },
    {
      id: "go.symbol",
      title: "Go to Symbol in Editor…",
      category: "Go",
      icon: Hash,
      run: () => open().openSymbols(),
    },
    {
      id: "go.line",
      title: "Go to Line/Column…",
      category: "Go",
      icon: Type,
      run: () => open().openGotoLine(),
    },
    {
      id: "workbench.action.showCommands",
      title: "Show All Commands",
      category: "View",
      description: "Open the command palette",
      icon: Keyboard,
      shortcut: formatShortcut("mod+shift+p"),
      keywords: ["palette", "commands"],
      run: () => open().openCommands(),
    },
    {
      id: "workbench.action.quickOpen",
      title: "Go to File…",
      category: "Go",
      description: "Quick Open — search files by name",
      icon: FileCode2,
      shortcut: formatShortcut("mod+p"),
      keywords: ["file", "open", "quick"],
      run: () => {
        ensureIde();
        useLayoutStore.getState().openTools("editor");
        open().openQuickOpen();
      },
    },
    {
      id: "workbench.action.findInFiles",
      title: "Search: Find in Files",
      category: "Search",
      description: "Search across the workspace",
      icon: Search,
      shortcut: formatShortcut("mod+shift+f"),
      keywords: ["grep", "find", "global"],
      run: () => open().openSearch(),
    },
    {
      id: "workbench.action.gotoSymbol",
      title: "Go to Symbol in Editor…",
      category: "Go",
      icon: Hash,
      shortcut: formatShortcut("mod+shift+o"),
      run: () => open().openSymbols(),
    },
    {
      id: "workbench.action.showAllSymbols",
      title: "Go to Symbol in Workspace…",
      category: "Go",
      icon: Hash,
      shortcut: formatShortcut("mod+t"),
      run: () => open().openWorkspaceSymbols(),
    },
    {
      id: "workbench.action.gotoLine",
      title: "Go to Line/Column…",
      category: "Go",
      icon: Type,
      shortcut: formatShortcut("mod+g"),
      run: () => open().openGotoLine(),
    },
    {
      id: "workbench.action.toggleSidebar",
      title: "Toggle Primary Side Bar Visibility",
      category: "View",
      icon: LayoutPanelLeft,
      shortcut: formatShortcut("mod+b"),
      run: () => {
        ensureIde();
        useLayoutStore.getState().toggleNav();
      },
    },
    {
      id: "workbench.action.toggleAiPanel",
      title: "View: Toggle Tools Panel",
      category: "View",
      description: "Show or hide the tools workspace (editor, browser, terminal)",
      icon: Bot,
      shortcut: formatShortcut("mod+l"),
      keywords: ["tools", "editor", "agent", "panel"],
      run: () => {
        ensureIde();
        useLayoutStore.getState().toggleTools();
      },
    },
    {
      id: "workbench.action.toggleBottomPanel",
      title: "View: Toggle Panel",
      category: "View",
      description: "Show or hide the bottom terminal panel",
      icon: PanelBottom,
      shortcut: formatShortcut("mod+j"),
      run: () => {
        ensureIde();
        useLayoutStore.getState().toggleBottomPanel();
      },
    },
    {
      id: "workbench.action.terminal.focus",
      title: "Terminal: Focus Terminal",
      category: "Terminal",
      icon: Terminal,
      shortcut: formatShortcut("mod+`"),
      run: () => {
        ensureIde();
        const s = useLayoutStore.getState();
        if (s.bottomPanelOpen && s.bottomPanelTab === "terminal") {
          s.toggleBottomPanel();
        } else {
          s.openBottomPanel("terminal");
          s.setBottomPanelSlim(false);
        }
      },
    },
    {
      id: "workbench.action.problems.focus",
      title: "View: Focus Problems",
      category: "View",
      icon: Search,
      run: () => {
        ensureIde();
        useLayoutStore.getState().openBottomPanel("problems");
      },
    },
    {
      id: "workbench.view.scm",
      title: "View: Show Git",
      category: "View",
      description: "Open Git in the tools pane",
      icon: GitBranch,
      shortcut: formatShortcut("mod+shift+g"),
      keywords: ["git", "scm", "source"],
      run: () => {
        ensureIde();
        useLayoutStore.getState().openTools("git");
      },
    },
    {
      id: "workbench.view.explorer",
      title: "View: Show Explorer",
      category: "View",
      icon: FolderOpen,
      shortcut: formatShortcut("mod+shift+e"),
      run: () => {
        ensureIde();
        const s = useLayoutStore.getState();
        if (s.navOpen) s.closeNav();
        else s.openExplorer();
      },
    },
    {
      id: "workbench.view.preview",
      title: "View: Open Preview",
      category: "View",
      icon: FileCode2,
      keywords: ["preview", "browser"],
      run: () => {
        ensureIde();
        useLayoutStore.getState().openTools("preview");
      },
    },
    {
      id: "workbench.view.logs",
      title: "View: Open Logs",
      category: "View",
      keywords: ["logs"],
      run: () => {
        ensureIde();
        useLayoutStore.getState().openTools("logs");
      },
    },
    {
      id: "workbench.view.tasks",
      title: "View: Open Tasks",
      category: "View",
      keywords: ["tasks", "agent"],
      run: () => {
        ensureIde();
        useLayoutStore.getState().openTools("tasks");
      },
    },
    {
      id: "workbench.view.memory",
      title: "View: Open Memory",
      category: "View",
      keywords: ["memory"],
      run: () => {
        ensureIde();
        useLayoutStore.getState().openTools("memory");
      },
    },
    {
      id: "workbench.view.editor",
      title: "View: Open Editor",
      category: "View",
      icon: FileCode2,
      keywords: ["editor", "code"],
      run: () => {
        ensureIde();
        useLayoutStore.getState().openTools("editor");
      },
    },
    {
      id: "workbench.view.search",
      title: "View: Show Search",
      category: "Search",
      icon: Search,
      run: () => {
        useLayoutStore.getState().setActivityView("search");
        open().openSearch();
      },
    },
    {
      id: "workbench.action.openSettings",
      title: "Preferences: Open Settings",
      category: "Preferences",
      icon: Settings,
      shortcut: formatShortcut("mod+,"),
      keywords: ["preferences", "config"],
      run: () => {
        window.dispatchEvent(new CustomEvent("lens:open-settings"));
      },
    },
    {
      id: "lens.ai.focusComposer",
      title: "AI: Focus Composer",
      category: "AI",
      icon: MessageSquare,
      shortcut: formatShortcut("mod+i"),
      run: () => {
        window.dispatchEvent(new CustomEvent("lens:focus-composer"));
      },
    },
    {
      id: "workbench.action.closeOverlay",
      title: "Close Overlay",
      category: "View",
      enabled: () => useCommandStore.getState().overlay !== null,
      run: () => useCommandStore.getState().close(),
    },
    {
      id: "editor.action.revealDefinition",
      title: "Go to Definition",
      category: "Go",
      icon: Hash,
      description: "Jump to symbol definition (mock)",
      keywords: ["definition", "f12"],
      run: () => open().openWorkspaceSymbols(),
    },
    {
      id: "editor.action.goToReferences",
      title: "Go to References",
      category: "Go",
      icon: Hash,
      keywords: ["references", "usages"],
      run: () => open().openWorkspaceSymbols(),
    },
    {
      id: "editor.action.goToTypeDefinition",
      title: "Go to Type Definition",
      category: "Go",
      icon: Type,
      run: () => open().openWorkspaceSymbols(),
    },
    {
      id: "editor.action.goToImplementation",
      title: "Go to Implementations",
      category: "Go",
      icon: Hash,
      run: () => open().openWorkspaceSymbols(),
    },
    {
      id: "help.keyboardShortcuts",
      title: "Help: Keyboard Shortcuts Reference",
      category: "Help",
      icon: Keyboard,
      description: "Open command palette filtered to shortcuts",
      run: () => {
        open().openCommands();
        useCommandStore.getState().setQuery(">shortcut");
      },
    },
  ]);
}
