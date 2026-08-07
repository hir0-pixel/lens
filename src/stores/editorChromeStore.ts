import { create } from "zustand";

interface EditorChromeState {
  activePath: string | null;
  language: string;
  line: number;
  column: number;
  encoding: string;
  dirtyPaths: Set<string>;
  setCursor: (line: number, column: number) => void;
  setActivePath: (path: string | null, language?: string) => void;
  markDirty: (path: string, dirty: boolean) => void;
  isDirty: (path: string) => boolean;
}

function langFromPath(path: string | null): string {
  if (!path) return "Plain Text";
  if (path.endsWith(".tsx") || path.endsWith(".ts")) return "TypeScript";
  if (path.endsWith(".json")) return "JSON";
  if (path.endsWith(".css")) return "CSS";
  if (path.endsWith(".md")) return "Markdown";
  if (path.endsWith(".html")) return "HTML";
  return "Plain Text";
}

export const useEditorChromeStore = create<EditorChromeState>((set, get) => ({
  activePath: "src/App.tsx",
  language: "TypeScript",
  line: 1,
  column: 1,
  encoding: "UTF-8",
  dirtyPaths: new Set(),
  setCursor: (line, column) => set({ line, column }),
  setActivePath: (path, language) => {
    const nextLang = language ?? langFromPath(path);
    const cur = get();
    if (cur.activePath === path && cur.language === nextLang) return;
    set({ activePath: path, language: nextLang });
  },
  markDirty: (path, dirty) =>
    set((state) => {
      const has = state.dirtyPaths.has(path);
      if (dirty === has) return state;
      const next = new Set(state.dirtyPaths);
      if (dirty) next.add(path);
      else next.delete(path);
      return { dirtyPaths: next };
    }),
  isDirty: (path) => get().dirtyPaths.has(path),
}));
