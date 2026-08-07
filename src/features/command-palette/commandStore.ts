import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PaletteMode =
  | "commands"
  | "files"
  | "symbols"
  | "workspace-symbols"
  | "goto-line";

export type OverlayKind = "palette" | "search" | null;

interface CommandPaletteState {
  overlay: OverlayKind;
  paletteMode: PaletteMode;
  query: string;
  recentCommandIds: string[];
  pinnedCommandIds: string[];
  recentFilePaths: string[];
  pinnedFilePaths: string[];
  searchHistory: string[];
  lastOpenedFile: string | null;

  openCommands: () => void;
  openQuickOpen: () => void;
  openSymbols: () => void;
  openWorkspaceSymbols: () => void;
  openGotoLine: () => void;
  openSearch: (initialQuery?: string) => void;
  close: () => void;
  setQuery: (query: string) => void;
  setPaletteMode: (mode: PaletteMode) => void;
  pushRecentCommand: (id: string) => void;
  togglePinnedCommand: (id: string) => void;
  pushRecentFile: (path: string) => void;
  togglePinnedFile: (path: string) => void;
  pushSearchHistory: (query: string) => void;
  setLastOpenedFile: (path: string | null) => void;
}

export const useCommandStore = create<CommandPaletteState>()(
  persist(
    (set, get) => ({
      overlay: null,
      paletteMode: "commands",
      query: "",
      recentCommandIds: [],
      pinnedCommandIds: ["workbench.action.toggleAiPanel", "workbench.action.toggleBottomPanel"],
      recentFilePaths: ["src/App.tsx", "src/components/CashFlowChart.tsx", "package.json"],
      pinnedFilePaths: ["src/App.tsx"],
      searchHistory: ["SavingsGoals", "accent", "Sidebar"],
      lastOpenedFile: "src/App.tsx",

      openCommands: () =>
        set({ overlay: "palette", paletteMode: "commands", query: ">" }),
      openQuickOpen: () =>
        set({ overlay: "palette", paletteMode: "files", query: "" }),
      openSymbols: () =>
        set({ overlay: "palette", paletteMode: "symbols", query: "@" }),
      openWorkspaceSymbols: () =>
        set({ overlay: "palette", paletteMode: "workspace-symbols", query: "#" }),
      openGotoLine: () =>
        set({ overlay: "palette", paletteMode: "goto-line", query: ":" }),
      openSearch: (initialQuery = "") =>
        set({ overlay: "search", query: initialQuery }),
      close: () => set({ overlay: null, query: "" }),
      setQuery: (query) => set({ query }),
      setPaletteMode: (paletteMode) => set({ paletteMode }),
      pushRecentCommand: (id) =>
        set({
          recentCommandIds: [id, ...get().recentCommandIds.filter((x) => x !== id)].slice(0, 20),
        }),
      togglePinnedCommand: (id) => {
        const pinned = get().pinnedCommandIds;
        set({
          pinnedCommandIds: pinned.includes(id)
            ? pinned.filter((x) => x !== id)
            : [...pinned, id],
        });
      },
      pushRecentFile: (path) =>
        set({
          recentFilePaths: [path, ...get().recentFilePaths.filter((x) => x !== path)].slice(0, 20),
          lastOpenedFile: path,
        }),
      togglePinnedFile: (path) => {
        const pinned = get().pinnedFilePaths;
        set({
          pinnedFilePaths: pinned.includes(path)
            ? pinned.filter((x) => x !== path)
            : [...pinned, path],
        });
      },
      pushSearchHistory: (query) => {
        if (!query.trim()) return;
        set({
          searchHistory: [query, ...get().searchHistory.filter((x) => x !== query)].slice(0, 20),
        });
      },
      setLastOpenedFile: (path) => set({ lastOpenedFile: path }),
    }),
    {
      name: "orchids-command-palette",
      partialize: (s) => ({
        recentCommandIds: s.recentCommandIds,
        pinnedCommandIds: s.pinnedCommandIds,
        recentFilePaths: s.recentFilePaths,
        pinnedFilePaths: s.pinnedFilePaths,
        searchHistory: s.searchHistory,
        lastOpenedFile: s.lastOpenedFile,
      }),
    },
  ),
);

/** Infer palette mode from query prefix (Cursor/VS Code behavior). */
export function inferModeFromQuery(query: string): PaletteMode {
  if (query.startsWith(">")) return "commands";
  if (query.startsWith("@")) return "symbols";
  if (query.startsWith("#")) return "workspace-symbols";
  if (query.startsWith(":")) return "goto-line";
  return "files";
}

export function stripModePrefix(query: string, mode: PaletteMode): string {
  switch (mode) {
    case "commands":
      return query.replace(/^>/, "").trimStart();
    case "symbols":
      return query.replace(/^@/, "").trimStart();
    case "workspace-symbols":
      return query.replace(/^#/, "").trimStart();
    case "goto-line":
      return query.replace(/^:/, "").trimStart();
    default:
      return query;
  }
}
