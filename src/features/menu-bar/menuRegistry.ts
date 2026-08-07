import type { LucideIcon } from "lucide-react";
import {
  FolderOpen,
  Settings,
  LogOut,
  Undo2,
  Redo2,
  Scissors,
  Copy,
  ClipboardPaste,
  Search,
  Replace,
  Command,
  PanelLeft,
  PanelBottom,
  PanelRight,
  FileCode2,
  Hash,
  Bug,
  Play,
  Terminal,
  HelpCircle,
  Info,
  Keyboard,
  Eye,
} from "lucide-react";

export interface MenuCommand {
  id: string;
  label: string;
  shortcut?: string;
  icon?: LucideIcon;
  disabled?: boolean;
  separator?: boolean;
  action?: () => void;
  submenu?: MenuCommand[];
}

function dispatch(event: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(event, { detail }));
}

export const MENU_BAR: { id: string; label: string; items: MenuCommand[] }[] = [
  {
    id: "file",
    label: "File",
    items: [
      {
        id: "file.newAgent",
        label: "New Agent",
        shortcut: "Ctrl+N",
        icon: FileCode2,
        action: () => dispatch("orchids:command", { id: "orchids.chat.new" }),
      },
      {
        id: "file.openFolder",
        label: "Open Folder",
        shortcut: "Ctrl+O",
        icon: FolderOpen,
        action: () => dispatch("orchids:open-folder"),
      },
      {
        id: "file.newTerminal",
        label: "New Terminal",
        shortcut: "Ctrl+Shift+`",
        icon: Terminal,
        action: () => dispatch("orchids:terminal-new"),
      },
      {
        id: "file.newBrowser",
        label: "New Browser",
        icon: Eye,
        action: () => dispatch("orchids:open-browser"),
      },
      {
        id: "file.openIde",
        label: "Open IDE",
        shortcut: "Ctrl+Shift+N",
        icon: PanelRight,
        action: () => dispatch("orchids:open-ide"),
      },
      { id: "sep-f1", label: "", separator: true },
      {
        id: "file.settings",
        label: "Preferences",
        shortcut: "Ctrl+,",
        icon: Settings,
        submenu: [
          {
            id: "file.settings.open",
            label: "Settings",
            shortcut: "Ctrl+,",
            action: () => dispatch("orchids:open-settings"),
          },
          {
            id: "file.settings.keys",
            label: "Keyboard Shortcuts",
            icon: Keyboard,
            action: () =>
              dispatch("orchids:open-settings", { section: "keyboard" }),
          },
        ],
      },
      { id: "sep-f2", label: "", separator: true },
      {
        id: "file.exit",
        label: "Exit",
        icon: LogOut,
        action: () => dispatch("orchids:exit"),
      },
    ],
  },
  {
    id: "edit",
    label: "Edit",
    items: [
      {
        id: "edit.undo",
        label: "Undo",
        shortcut: "Ctrl+Z",
        icon: Undo2,
        action: () => document.execCommand("undo"),
      },
      {
        id: "edit.redo",
        label: "Redo",
        shortcut: "Ctrl+Y",
        icon: Redo2,
        action: () => document.execCommand("redo"),
      },
      { id: "sep-e1", label: "", separator: true },
      {
        id: "edit.cut",
        label: "Cut",
        shortcut: "Ctrl+X",
        icon: Scissors,
        action: () => document.execCommand("cut"),
      },
      {
        id: "edit.copy",
        label: "Copy",
        shortcut: "Ctrl+C",
        icon: Copy,
        action: () => document.execCommand("copy"),
      },
      {
        id: "edit.paste",
        label: "Paste",
        shortcut: "Ctrl+V",
        icon: ClipboardPaste,
        action: () => document.execCommand("paste"),
      },
      { id: "sep-e2", label: "", separator: true },
      {
        id: "edit.find",
        label: "Find",
        shortcut: "Ctrl+F",
        icon: Search,
        action: () => dispatch("orchids:command", { id: "edit.find" }),
      },
      {
        id: "edit.replace",
        label: "Replace",
        shortcut: "Ctrl+H",
        icon: Replace,
        action: () => dispatch("orchids:command", { id: "edit.replace" }),
      },
    ],
  },
  {
    id: "selection",
    label: "Selection",
    items: [
      {
        id: "sel.all",
        label: "Select All",
        shortcut: "Ctrl+A",
        action: () => document.execCommand("selectAll"),
      },
      {
        id: "sel.expand",
        label: "Expand Selection",
        shortcut: "Shift+Alt+Right",
        disabled: true,
      },
      {
        id: "sel.shrink",
        label: "Shrink Selection",
        shortcut: "Shift+Alt+Left",
        disabled: true,
      },
      { id: "sep-s1", label: "", separator: true },
      {
        id: "sel.multi",
        label: "Add Cursor Above",
        shortcut: "Ctrl+Alt+Up",
        disabled: true,
      },
    ],
  },
  {
    id: "view",
    label: "View",
    items: [
      {
        id: "view.commandPalette",
        label: "Command Palette…",
        shortcut: "Ctrl+Shift+P",
        icon: Command,
        action: () =>
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "p",
              ctrlKey: true,
              shiftKey: true,
              bubbles: true,
            }),
          ),
      },
      { id: "sep-v1", label: "", separator: true },
      {
        id: "view.explorer",
        label: "Explorer",
        shortcut: "Ctrl+Shift+E",
        icon: PanelLeft,
        action: () => dispatch("orchids:view", { id: "explorer" }),
      },
      {
        id: "view.search",
        label: "Search",
        shortcut: "Ctrl+Shift+F",
        icon: Search,
        action: () => dispatch("orchids:view", { id: "search" }),
      },
      {
        id: "view.scm",
        label: "Source Control",
        shortcut: "Ctrl+Shift+G",
        action: () => dispatch("orchids:view", { id: "git" }),
      },
      { id: "sep-v2", label: "", separator: true },
      {
        id: "view.ai",
        label: "Toggle AI Panel",
        shortcut: "Ctrl+L",
        icon: PanelRight,
        action: () => dispatch("orchids:toggle-ai"),
      },
      {
        id: "view.terminal",
        label: "Toggle Panel",
        shortcut: "Ctrl+J",
        icon: PanelBottom,
        action: () => dispatch("orchids:toggle-panel"),
      },
    ],
  },
  {
    id: "go",
    label: "Go",
    items: [
      {
        id: "go.file",
        label: "Go to File…",
        shortcut: "Ctrl+P",
        icon: FileCode2,
        action: () =>
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "p",
              ctrlKey: true,
              bubbles: true,
            }),
          ),
      },
      {
        id: "go.symbol",
        label: "Go to Symbol in Editor…",
        shortcut: "Ctrl+Shift+O",
        icon: Hash,
        action: () => dispatch("orchids:command", { id: "go.symbol" }),
      },
      {
        id: "go.line",
        label: "Go to Line/Column…",
        shortcut: "Ctrl+G",
        action: () => dispatch("orchids:command", { id: "go.line" }),
      },
    ],
  },
  {
    id: "run",
    label: "Run",
    items: [
      {
        id: "run.start",
        label: "Start Debugging",
        shortcut: "F5",
        icon: Play,
        disabled: true,
      },
      {
        id: "run.without",
        label: "Run Without Debugging",
        shortcut: "Ctrl+F5",
        icon: Bug,
        disabled: true,
      },
      {
        id: "run.stop",
        label: "Stop",
        shortcut: "Shift+F5",
        disabled: true,
      },
    ],
  },
  {
    id: "terminal",
    label: "Terminal",
    items: [
      {
        id: "term.new",
        label: "New Terminal",
        shortcut: "Ctrl+Shift+`",
        icon: Terminal,
        action: () => dispatch("orchids:terminal-new"),
      },
      {
        id: "term.split",
        label: "Split Terminal",
        action: () => dispatch("orchids:terminal-split"),
      },
      { id: "sep-t1", label: "", separator: true },
      {
        id: "term.toggle",
        label: "Toggle Terminal",
        shortcut: "Ctrl+`",
        action: () => dispatch("orchids:toggle-panel"),
      },
    ],
  },
  {
    id: "help",
    label: "Help",
    items: [
      {
        id: "help.welcome",
        label: "Welcome",
        icon: HelpCircle,
        action: () => dispatch("orchids:show-welcome"),
      },
      {
        id: "help.keys",
        label: "Keyboard Shortcuts Reference",
        icon: Keyboard,
        action: () =>
          dispatch("orchids:open-settings", { section: "keyboard" }),
      },
      { id: "sep-h1", label: "", separator: true },
      {
        id: "help.about",
        label: "About Orchids",
        icon: Info,
        action: () =>
          dispatch("orchids:open-settings", { section: "about" }),
      },
    ],
  },
];
