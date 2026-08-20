import type {
  ClosedSessionRecord,
  ShellType,
  SplitPane,
  TerminalSearchState,
  TerminalSession,
} from "@/components/terminal/types";
import { defaultShellForPlatform } from "@/components/terminal/utils/mockShell";
import { create } from "zustand";
import { persist } from "zustand/middleware";

let sessionCounter = 0;

function createSessionId(): string {
  sessionCounter += 1;
  return `term-${Date.now()}-${sessionCounter}`;
}

function createLeaf(sessionId: string): SplitPane {
  return { id: `pane-${sessionId}`, type: "leaf", sessionId };
}

function createDefaultSession(cwd = "~"): TerminalSession {
  const id = createSessionId();
  const shell = defaultShellForPlatform();
  return {
    id,
    title: shell === "powershell" ? "PowerShell" : "bash",
    cwd,
    shell,
    pinned: false,
    history: [],
    scrollPosition: 0,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    connectionKind: "local",
    status: "running",
    generation: 0,
  };
}

function findPaneBySession(root: SplitPane, sessionId: string): SplitPane | null {
  if (root.type === "leaf") {
    return root.sessionId === sessionId ? root : null;
  }
  return (
    findPaneBySession(root.first!, sessionId) ??
    findPaneBySession(root.second!, sessionId)
  );
}

function replacePane(root: SplitPane, paneId: string, replacement: SplitPane): SplitPane {
  if (root.id === paneId) return replacement;
  if (root.type === "split") {
    return {
      ...root,
      first: replacePane(root.first!, paneId, replacement),
      second: replacePane(root.second!, paneId, replacement),
    };
  }
  return root;
}

interface TerminalStore {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  splitRoot: SplitPane | null;
  focusedPaneId: string | null;
  search: TerminalSearchState;
  closedSessions: ClosedSessionRecord[];
  defaultCwd: string;

  createSession: (opts?: Partial<Pick<TerminalSession, "title" | "cwd" | "shell">>) => string;
  closeSession: (id: string) => void;
  duplicateSession: (id: string) => string;
  renameSession: (id: string, title: string) => void;
  pinSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  setFocusedPane: (paneId: string) => void;
  updateSession: (id: string, patch: Partial<TerminalSession>) => void;
  setCwd: (id: string, cwd: string) => void;
  setShell: (id: string, shell: ShellType) => void;
  appendHistory: (id: string, command: string) => void;
  killSession: (id: string) => void;
  restartSession: (id: string) => void;
  splitSession: (sessionId: string, direction: "horizontal" | "vertical") => string;
  setSearch: (patch: Partial<TerminalSearchState>) => void;
  setDefaultCwd: (cwd: string) => void;
  reopenSession: (recordId: string) => string | null;
}

function initStore(): Pick<
  TerminalStore,
  "sessions" | "activeSessionId" | "splitRoot" | "focusedPaneId"
> {
  const session = createDefaultSession();
  const leaf = createLeaf(session.id);
  return {
    sessions: [session],
    activeSessionId: session.id,
    splitRoot: leaf,
    focusedPaneId: leaf.id,
  };
}

export const useTerminalStore = create<TerminalStore>()(
  persist(
    (set, get) => ({
      ...initStore(),
      search: { open: false, query: "", caseSensitive: false, regex: false },
      closedSessions: [],
      defaultCwd: "~",

      createSession: (opts) => {
        const session = createDefaultSession(opts?.cwd ?? get().defaultCwd);
        if (opts?.title) session.title = opts.title;
        if (opts?.shell) session.shell = opts.shell;
        const leaf = createLeaf(session.id);

        set((state) => ({
          sessions: [...state.sessions, session],
          activeSessionId: session.id,
          splitRoot: state.splitRoot ?? leaf,
          focusedPaneId: leaf.id,
        }));

        return session.id;
      },

      closeSession: (id) => {
        set((state) => {
          const closing = state.sessions.find((s) => s.id === id);
          const remaining = state.sessions.filter((s) => s.id !== id);

          const closedRecord: ClosedSessionRecord | null = closing
            ? {
                id: closing.id,
                title: closing.title,
                cwd: closing.cwd,
                shell: closing.shell,
                closedAt: Date.now(),
              }
            : null;

          let splitRoot = state.splitRoot;
          if (splitRoot) {
            const pane = findPaneBySession(splitRoot, id);
            if (pane && remaining.length > 0) {
              const fallback = remaining[0];
              splitRoot = replacePane(splitRoot, pane.id, createLeaf(fallback.id));
            } else if (remaining.length === 0) {
              splitRoot = null;
            }
          }

          const nextActive = remaining.find((s) => s.id === state.activeSessionId)
            ? state.activeSessionId
            : remaining[0]?.id ?? null;

          return {
            sessions: remaining,
            activeSessionId: nextActive,
            splitRoot,
            closedSessions: closedRecord
              ? [closedRecord, ...state.closedSessions].slice(0, 20)
              : state.closedSessions,
          };
        });
      },

      duplicateSession: (id) => {
        const source = get().sessions.find((s) => s.id === id);
        if (!source) return get().createSession();
        return get().createSession({
          title: `${source.title} (copy)`,
          cwd: source.cwd,
          shell: source.shell,
        });
      },

      renameSession: (id, title) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, title, lastActiveAt: Date.now() } : s,
          ),
        }));
      },

      pinSession: (id) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, pinned: !s.pinned } : s,
          ),
        }));
      },

      setActiveSession: (id) => {
        set((state) => ({
          activeSessionId: id,
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, lastActiveAt: Date.now() } : s,
          ),
        }));
      },

      setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),

  updateSession: (id, patch) => {
    set((state) => {
      const current = state.sessions.find((s) => s.id === id);
      if (!current) return state;
      let changed = false;
      for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
        if (current[key] !== patch[key]) {
          changed = true;
          break;
        }
      }
      if (!changed) return state;
      return {
        sessions: state.sessions.map((s) =>
          s.id === id ? { ...s, ...patch, lastActiveAt: Date.now() } : s,
        ),
      };
    });
  },

      setCwd: (id, cwd) => get().updateSession(id, { cwd }),
      setShell: (id, shell) => get().updateSession(id, { shell }),

      appendHistory: (id, command) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id
              ? { ...s, history: [...s.history, command].slice(-500) }
              : s,
          ),
        }));
      },

      killSession: (id) => {
        get().updateSession(id, { status: "killed", exitCode: 1 });
      },

      restartSession: (id) => {
        get().updateSession(id, {
          status: "running",
          exitCode: undefined,
          generation: (get().sessions.find((s) => s.id === id)?.generation ?? 0) + 1,
        });
      },

      splitSession: (sessionId, direction) => {
        const state = get();
        const pane = state.splitRoot ? findPaneBySession(state.splitRoot, sessionId) : null;
        const newId = get().createSession({
          cwd: state.sessions.find((s) => s.id === sessionId)?.cwd,
          shell: state.sessions.find((s) => s.id === sessionId)?.shell,
        });

        if (!pane || !state.splitRoot) return newId;

        const newLeaf = createLeaf(newId);
        const splitPane: SplitPane = {
          id: `split-${Date.now()}`,
          type: "split",
          direction,
          first: { ...pane, sessionId: pane.sessionId },
          second: newLeaf,
          firstSize: 50,
        };

        set({
          splitRoot: replacePane(state.splitRoot, pane.id, splitPane),
          focusedPaneId: newLeaf.id,
          activeSessionId: newId,
        });

        return newId;
      },

      setSearch: (patch) => set((state) => ({ search: { ...state.search, ...patch } })),

      setDefaultCwd: (cwd) => set({ defaultCwd: cwd }),

      reopenSession: (recordId) => {
        const record = get().closedSessions.find((r) => r.id === recordId);
        if (!record) return null;
        const id = get().createSession({
          title: record.title,
          cwd: record.cwd,
          shell: record.shell,
        });
        set((state) => ({
          closedSessions: state.closedSessions.filter((r) => r.id !== recordId),
        }));
        return id;
      },
    }),
    {
      name: "lens-terminal",
      partialize: (state) => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
        closedSessions: state.closedSessions.slice(0, 10),
        defaultCwd: state.defaultCwd,
      }),
    },
  ),
);
