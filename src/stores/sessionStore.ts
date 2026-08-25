import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AIMode, ChatMessage, Model } from "@/lib/types";
import { MODELS } from "@/lib/mock-data";

export type SessionType = "agent-only" | "coding";

export interface PlanStep {
  id: string;
  label: string;
  status: "pending" | "in_progress" | "done";
}

export interface Session {
  id: string;
  /** Opaque server-issued conversation identity; never a local id or SSO session_ref. */
  conversationRef?: string;
  /** Cryptographically strong client metadata used only to make first-turn creation idempotent. */
  conversationCreationKey: string;
  title: string;
  repoId: string | null;
  type: SessionType;
  messages: ChatMessage[];
  openFiles: string[];
  plan: PlanStep[];
  mode: AIMode;
  modelId: string;
  createdAt: number;
  lastActiveAt: number;
  pinned?: boolean;
  /** True only when the user explicitly renamed the session (renameSession). Auto-derived titles are a prompt-content prefix and must never be persisted. */
  titleIsCustom?: boolean;
}

export interface Repository {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: number;
  sessions: string[];
}

export interface RecentProject {
  name: string;
  path: string;
  lastOpenedAt: number;
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function now() {
  return Date.now();
}

function normalizePathKey(path: string): string {
  return path.replace(/[/\\]+$/, "").toLowerCase();
}

function nameFromPath(path: string): string {
  const cleaned = path.replace(/[/\\]+$/, "");
  const parts = cleaned.split(/[/\\]/).filter(Boolean);
  const last = parts[parts.length - 1] ?? "Project";
  return last.replace(/^browser:\/\//i, "") || "Project";
}

interface SessionState {
  sessions: Record<string, Session>;
  repositories: Repository[];
  /** Currently scoped project; null + no session → welcome screen. */
  activeRepositoryId: string | null;
  recentProjects: RecentProject[];
  currentSessionId: string | null;
  /** Parallel multitask tabs (includes current). */
  activeSessionIds: string[];
  historyStack: string[];
  historyIndex: number;
  defaultModelId: string;
  /** True while layout animates agent-only → coding. */
  upgrading: boolean;

  currentSession: () => Session | null;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  /** True when neither a session nor a repo is active (show welcome). */
  shouldShowWelcome: () => boolean;

  createSession: (opts?: {
    repoId?: string | null;
    title?: string;
    activate?: boolean;
  }) => Session;
  setCurrentSession: (id: string | null, pushHistory?: boolean) => void;
  goBack: () => void;
  goForward: () => void;
  newChat: () => Session;
  openRepository: (repoId: string) => Session;
  /** Create or reactivate a repo by path, set active, open scoped session. */
  openFolderAsRepository: (path: string) => Session;
  renameRepository: (repoId: string, name: string) => void;
  removeRepository: (repoId: string) => void;
  touchRepository: (repoId: string) => void;
  setActiveRepository: (repoId: string | null) => void;
  pushRecentProject: (path: string, name?: string) => void;
  removeRecentProject: (path: string) => void;
  setSessionRepo: (sessionId: string, repoId: string | null) => void;
  setSessionMode: (sessionId: string, mode: AIMode) => void;
  setSessionModel: (sessionId: string, modelId: string) => void;
  setConversationRef: (sessionId: string, conversationRef: string) => void;
  setDefaultModel: (modelId: string) => void;
  appendMessage: (sessionId: string, message: ChatMessage) => void;
  setMessages: (sessionId: string, messages: ChatMessage[]) => void;
  setPlan: (sessionId: string, plan: PlanStep[]) => void;
  openFileInSession: (sessionId: string, path: string) => void;
  upgradeToCoding: (sessionId: string, reason?: string) => void;
  multitask: () => Session;
  closeSessionTab: (sessionId: string) => void;
  /** Close all sessions and clear active repo → welcome. */
  closeWorkspace: () => void;
  renameSession: (sessionId: string, title: string) => void;
  togglePinSession: (sessionId: string) => void;
  getModel: (session: Session) => Model;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: {},
      repositories: [],
      activeRepositoryId: null,
      recentProjects: [],
      currentSessionId: null,
      activeSessionIds: [],
      historyStack: [],
      historyIndex: -1,
      defaultModelId: MODELS[0]?.id ?? "composer-2.5-fast",
      upgrading: false,

      currentSession: () => {
        const id = get().currentSessionId;
        return id ? (get().sessions[id] ?? null) : null;
      },

      canGoBack: () => get().historyIndex > 0,
      canGoForward: () =>
        get().historyIndex >= 0 &&
        get().historyIndex < get().historyStack.length - 1,

      shouldShowWelcome: () =>
        get().currentSessionId === null && get().activeRepositoryId === null,

      createSession: (opts = {}) => {
        const id = uid("sess");
        const session: Session = {
          id,
          title: opts.title ?? "New chat",
          repoId: opts.repoId ?? null,
          type: "agent-only",
          messages: [],
          conversationCreationKey: crypto.randomUUID(),
          openFiles: [],
          plan: [],
          mode: "ask",
          modelId: get().defaultModelId,
          createdAt: now(),
          lastActiveAt: now(),
        };
        set((s) => {
          const repositories = s.repositories.map((r) =>
            r.id === session.repoId
              ? {
                  ...r,
                  lastOpenedAt: now(),
                  sessions: [...r.sessions, id],
                }
              : r,
          );
          return {
            sessions: { ...s.sessions, [id]: session },
            repositories,
          };
        });
        if (opts.activate !== false) {
          get().setCurrentSession(id, true);
        }
        return session;
      },

      setCurrentSession: (id, pushHistory = true) => {
        set((s) => {
          let historyStack = s.historyStack;
          let historyIndex = s.historyIndex;
          if (id && pushHistory) {
            historyStack = [
              ...s.historyStack.slice(0, s.historyIndex + 1),
              id,
            ].slice(-50);
            historyIndex = historyStack.length - 1;
          }
          const activeSessionIds =
            id && !s.activeSessionIds.includes(id)
              ? [...s.activeSessionIds, id]
              : s.activeSessionIds;
          const sessions = { ...s.sessions };
          if (id && sessions[id]) {
            sessions[id] = { ...sessions[id], lastActiveAt: now() };
          }
          return {
            currentSessionId: id,
            activeSessionIds,
            historyStack,
            historyIndex,
            sessions,
          };
        });
      },

      goBack: () => {
        const { historyIndex, historyStack } = get();
        if (historyIndex <= 0) return;
        const next = historyIndex - 1;
        const id = historyStack[next];
        set({
          historyIndex: next,
          currentSessionId: id,
        });
      },

      goForward: () => {
        const { historyIndex, historyStack } = get();
        if (historyIndex >= historyStack.length - 1) return;
        const next = historyIndex + 1;
        const id = historyStack[next];
        set({
          historyIndex: next,
          currentSessionId: id,
        });
      },

      newChat: () => {
        const active = get().activeRepositoryId;
        return get().createSession({
          repoId: active,
          title: "New chat",
        });
      },

      openRepository: (repoId) => {
        const repo = get().repositories.find((r) => r.id === repoId);
        if (!repo) return get().newChat();

        set({ activeRepositoryId: repoId });
        get().touchRepository(repoId);
        get().pushRecentProject(repo.path, repo.name);

        const lastId = repo.sessions[repo.sessions.length - 1];
        const existing = lastId ? get().sessions[lastId] : null;
        if (existing) {
          get().setCurrentSession(existing.id, true);
          return existing;
        }
        return get().createSession({
          repoId,
          title: `${repo.name} chat`,
        });
      },

      openFolderAsRepository: (path) => {
        const key = normalizePathKey(path);
        const existing = get().repositories.find(
          (r) => normalizePathKey(r.path) === key,
        );
        if (existing) {
          return get().openRepository(existing.id);
        }
        const id = uid("repo");
        const name = nameFromPath(path);
        const repo: Repository = {
          id,
          name,
          path,
          lastOpenedAt: now(),
          sessions: [],
        };
        set((s) => ({
          repositories: [repo, ...s.repositories],
          activeRepositoryId: id,
        }));
        get().pushRecentProject(path, name);
        return get().createSession({
          repoId: id,
          title: `${name} chat`,
        });
      },

      renameRepository: (repoId, name) => {
        set((s) => ({
          repositories: s.repositories.map((r) =>
            r.id === repoId ? { ...r, name: name.trim() || r.name } : r,
          ),
        }));
      },

      removeRepository: (repoId) => {
        set((s) => ({
          repositories: s.repositories.filter((r) => r.id !== repoId),
          activeRepositoryId:
            s.activeRepositoryId === repoId ? null : s.activeRepositoryId,
        }));
      },

      touchRepository: (repoId) => {
        set((s) => ({
          repositories: s.repositories.map((r) =>
            r.id === repoId ? { ...r, lastOpenedAt: now() } : r,
          ),
        }));
      },

      setActiveRepository: (repoId) => set({ activeRepositoryId: repoId }),

      pushRecentProject: (path, name) => {
        const key = normalizePathKey(path);
        const entry: RecentProject = {
          name: name ?? nameFromPath(path),
          path,
          lastOpenedAt: now(),
        };
        set((s) => ({
          recentProjects: [
            entry,
            ...s.recentProjects.filter(
              (r) => normalizePathKey(r.path) !== key,
            ),
          ].slice(0, 20),
        }));
      },

      removeRecentProject: (path) => {
        const key = normalizePathKey(path);
        set((s) => ({
          recentProjects: s.recentProjects.filter(
            (r) => normalizePathKey(r.path) !== key,
          ),
        }));
      },

      setSessionRepo: (sessionId, repoId) => {
        set((s) => {
          const sess = s.sessions[sessionId];
          if (!sess) return s;
          let repositories = s.repositories;
          if (repoId && !repositories.find((r) => r.id === repoId)?.sessions.includes(sessionId)) {
            repositories = repositories.map((r) =>
              r.id === repoId
                ? {
                    ...r,
                    lastOpenedAt: now(),
                    sessions: [...r.sessions, sessionId],
                  }
                : r,
            );
          }
          return {
            repositories,
            sessions: {
              ...s.sessions,
              [sessionId]: {
                ...sess,
                repoId,
                lastActiveAt: now(),
              },
            },
          };
        });
      },

      setSessionMode: (sessionId, mode) => {
        set((s) => {
          const sess = s.sessions[sessionId];
          if (!sess) return s;
          return {
            sessions: {
              ...s.sessions,
              [sessionId]: { ...sess, mode, lastActiveAt: now() },
            },
          };
        });
      },

      setSessionModel: (sessionId, modelId) => {
        set((s) => {
          const sess = s.sessions[sessionId];
          if (!sess) return s;
          return {
            defaultModelId: modelId,
            sessions: {
              ...s.sessions,
              [sessionId]: { ...sess, modelId, lastActiveAt: now() },
            },
          };
        });
      },

      setDefaultModel: (modelId) => set({ defaultModelId: modelId }),

      setConversationRef: (sessionId, conversationRef) => {
        if (!conversationRef || conversationRef.length > 256) return;
        set((s) => {
          const sess = s.sessions[sessionId];
          if (!sess) return s;
          return { sessions: { ...s.sessions, [sessionId]: { ...sess, conversationRef, lastActiveAt: now() } } };
        });
      },

      appendMessage: (sessionId, message) => {
        set((s) => {
          const sess = s.sessions[sessionId];
          if (!sess) return s;
          const title =
            sess.title === "New chat" && message.role === "user"
              ? message.content.slice(0, 48) || sess.title
              : sess.title;
          return {
            sessions: {
              ...s.sessions,
              [sessionId]: {
                ...sess,
                title,
                messages: [...sess.messages, message],
                lastActiveAt: now(),
              },
            },
          };
        });
      },

      setMessages: (sessionId, messages) => {
        set((s) => {
          const sess = s.sessions[sessionId];
          if (!sess) return s;
          return {
            sessions: {
              ...s.sessions,
              [sessionId]: { ...sess, messages, lastActiveAt: now() },
            },
          };
        });
      },

      setPlan: (sessionId, plan) => {
        set((s) => {
          const sess = s.sessions[sessionId];
          if (!sess) return s;
          return {
            sessions: {
              ...s.sessions,
              [sessionId]: { ...sess, plan, lastActiveAt: now() },
            },
          };
        });
      },

      openFileInSession: (sessionId, path) => {
        set((s) => {
          const sess = s.sessions[sessionId];
          if (!sess) return s;
          const openFiles = sess.openFiles.includes(path)
            ? sess.openFiles
            : [...sess.openFiles, path];
          return {
            sessions: {
              ...s.sessions,
              [sessionId]: {
                ...sess,
                openFiles,
                type: "coding",
                lastActiveAt: now(),
              },
            },
            upgrading: sess.type === "agent-only",
          };
        });
        window.setTimeout(() => set({ upgrading: false }), 320);
      },

      upgradeToCoding: (sessionId) => {
        const sess = get().sessions[sessionId];
        if (!sess || sess.type === "coding") return;
        set((s) => ({
          upgrading: true,
          sessions: {
            ...s.sessions,
            [sessionId]: {
              ...sess,
              type: "coding",
              lastActiveAt: now(),
            },
          },
        }));
        window.setTimeout(() => set({ upgrading: false }), 320);
      },

      multitask: () => {
        const current = get().currentSession();
        return get().createSession({
          repoId: current?.repoId ?? null,
          title: "Multitask",
          activate: true,
        });
      },

      closeSessionTab: (sessionId) => {
        set((s) => {
          const activeSessionIds = s.activeSessionIds.filter(
            (id) => id !== sessionId,
          );
          let currentSessionId = s.currentSessionId;
          if (currentSessionId === sessionId) {
            currentSessionId =
              activeSessionIds[activeSessionIds.length - 1] ?? null;
          }
          // Closing everything returns to welcome
          const clearWorkspace = activeSessionIds.length === 0;
          return {
            activeSessionIds,
            currentSessionId,
            ...(clearWorkspace ? { activeRepositoryId: null } : {}),
          };
        });
      },

      closeWorkspace: () => {
        set({
          currentSessionId: null,
          activeSessionIds: [],
          activeRepositoryId: null,
          historyStack: [],
          historyIndex: -1,
        });
      },

      renameSession: (sessionId, title) => {
        set((s) => {
          const sess = s.sessions[sessionId];
          if (!sess) return s;
          return {
            sessions: {
              ...s.sessions,
              [sessionId]: { ...sess, title, titleIsCustom: true },
            },
          };
        });
      },

      togglePinSession: (sessionId) => {
        set((s) => {
          const sess = s.sessions[sessionId];
          if (!sess) return s;
          return {
            sessions: {
              ...s.sessions,
              [sessionId]: { ...sess, pinned: !sess.pinned },
            },
          };
        });
      },

      getModel: (session) =>
        MODELS.find((m) => m.id === session.modelId) ?? MODELS[0],
    }),
    {
      name: "lens-session-v2",
      partialize: (s) => ({
        // Chat content (prompts, assistant output, citations) must never land
        // in localStorage: strip `messages` from every persisted session.
        // Durable, encrypted server-side conversation history (see
        // orchestrator-service/src/durableConversationHistory.ts) is what
        // grounds follow-ups across restarts now — the client only needs
        // session metadata to rebuild the workspace shell, not the transcript.
        // The auto-generated title is a 48-character prefix of the first
        // user message (see appendMessage) — content, not metadata — so it
        // is reset unless the user explicitly renamed the session.
        sessions: Object.fromEntries(
          Object.entries(s.sessions).map(([id, session]) => [
            id,
            { ...session, messages: [], title: session.titleIsCustom ? session.title : "New chat" },
          ]),
        ),
        repositories: s.repositories,
        activeRepositoryId: s.activeRepositoryId,
        recentProjects: s.recentProjects,
        currentSessionId: s.currentSessionId,
        activeSessionIds: s.activeSessionIds,
        historyStack: s.historyStack,
        historyIndex: s.historyIndex,
        defaultModelId: s.defaultModelId,
      }),
    },
  ),
);

/** Relative time label from epoch ms ("1d", "3d", "7d", "now"). */
export function relativeFrom(ts: number, nowMs = Date.now()): string {
  const diff = Math.max(0, nowMs - ts);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}
