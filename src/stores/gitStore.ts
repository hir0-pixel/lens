import { toast } from "sonner";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  MOCK_BRANCHES,
  MOCK_CHANGES,
  MOCK_COMMITS,
  MOCK_CONFLICTS,
  MOCK_DIFFS,
  MOCK_REPOS,
  RECENT_MESSAGES,
} from "@/features/source-control/mock-data";
import type {
  DiffViewMode,
  GitBranch,
  GitChange,
  GitCommit,
  GitFileDiff,
  GitOperation,
  GitRepository,
  MergeConflict,
} from "@/features/source-control/types";

interface GitState {
  repositories: GitRepository[];
  activeRepoId: string;
  branches: GitBranch[];
  changes: GitChange[];
  commits: GitCommit[];
  conflicts: MergeConflict[];
  selectedDiffPath: string | null;
  diffMode: DiffViewMode;
  showHistory: boolean;
  showConflicts: boolean;
  operation: GitOperation;
  lastFetchAt: string | null;
  commitMessage: string;
  commitDescription: string;
  amend: boolean;
  signOff: boolean;
  recentMessages: string[];
  favoriteBranches: string[];

  // Derived helpers via getters in selectors
  getCurrentBranch: () => GitBranch | undefined;
  getStaged: () => GitChange[];
  getUnstaged: () => GitChange[];
  getConflicts: () => GitChange[];
  getUntracked: () => GitChange[];
  getDiff: (path: string) => GitFileDiff | null;

  setActiveRepo: (id: string) => void;
  setCommitMessage: (msg: string) => void;
  setCommitDescription: (desc: string) => void;
  setAmend: (v: boolean) => void;
  setSignOff: (v: boolean) => void;
  setDiffMode: (mode: DiffViewMode) => void;
  selectDiff: (path: string | null) => void;
  setShowHistory: (v: boolean) => void;
  setShowConflicts: (v: boolean) => void;

  stage: (id: string) => void;
  unstage: (id: string) => void;
  stageAll: () => void;
  unstageAll: () => void;
  discard: (id: string) => void;
  commit: () => Promise<boolean>;
  checkoutBranch: (name: string) => Promise<void>;
  createBranch: (name: string) => Promise<void>;
  renameBranch: (oldName: string, newName: string) => void;
  deleteBranch: (name: string) => void;
  toggleFavoriteBranch: (name: string) => void;
  fetchRemote: () => Promise<void>;
  pull: () => Promise<void>;
  push: (force?: boolean) => Promise<void>;
  sync: () => Promise<void>;
  resolveConflict: (id: string, resolution: MergeConflict["resolved"]) => void;
  applyTemplate: (message: string) => void;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const useGitStore = create<GitState>()(
  persist(
    (set, get) => ({
      repositories: MOCK_REPOS,
      activeRepoId: MOCK_REPOS[0].id,
      branches: MOCK_BRANCHES.map((b) => ({ ...b })),
      changes: MOCK_CHANGES.map((c) => ({ ...c })),
      commits: MOCK_COMMITS,
      conflicts: MOCK_CONFLICTS.map((c) => ({ ...c })),
      selectedDiffPath: null,
      diffMode: "side-by-side",
      showHistory: false,
      showConflicts: false,
      operation: "idle",
      lastFetchAt: "2 min ago",
      commitMessage: "",
      commitDescription: "",
      amend: false,
      signOff: false,
      recentMessages: RECENT_MESSAGES,
      favoriteBranches: ["main", "feat/source-control"],

      getCurrentBranch: () => get().branches.find((b) => b.current),
      getStaged: () =>
        get().changes.filter((c) => c.staged && c.status !== "conflict" && c.status !== "untracked"),
      getUnstaged: () =>
        get().changes.filter(
          (c) =>
            !c.staged &&
            c.status !== "conflict" &&
            c.status !== "untracked" &&
            c.status !== "ignored",
        ),
      getConflicts: () => get().changes.filter((c) => c.status === "conflict"),
      getUntracked: () => get().changes.filter((c) => c.status === "untracked"),
      getDiff: (path) => MOCK_DIFFS[path] ?? null,

      setActiveRepo: (id) => set({ activeRepoId: id }),
      setCommitMessage: (commitMessage) => set({ commitMessage }),
      setCommitDescription: (commitDescription) => set({ commitDescription }),
      setAmend: (amend) => set({ amend }),
      setSignOff: (signOff) => set({ signOff }),
      setDiffMode: (diffMode) => set({ diffMode }),
      selectDiff: (selectedDiffPath) => set({ selectedDiffPath, showHistory: false }),
      setShowHistory: (showHistory) =>
        set({ showHistory, selectedDiffPath: showHistory ? null : get().selectedDiffPath }),
      setShowConflicts: (showConflicts) => set({ showConflicts }),

      stage: (id) =>
        set((s) => ({
          changes: s.changes.map((c) => (c.id === id ? { ...c, staged: true } : c)),
        })),
      unstage: (id) =>
        set((s) => ({
          changes: s.changes.map((c) => (c.id === id ? { ...c, staged: false } : c)),
        })),
      stageAll: () =>
        set((s) => ({
          changes: s.changes.map((c) =>
            c.status === "conflict" ? c : { ...c, staged: true },
          ),
        })),
      unstageAll: () =>
        set((s) => ({
          changes: s.changes.map((c) => ({ ...c, staged: false })),
        })),
      discard: (id) => {
        set((s) => ({ changes: s.changes.filter((c) => c.id !== id) }));
        toast.message("Changes discarded");
      },

      commit: async () => {
        const state = get();
        const staged = state.getStaged();
        if (!state.commitMessage.trim()) {
          toast.error("Commit message is required");
          return false;
        }
        if (staged.length === 0 && !state.amend) {
          toast.error("No staged changes to commit");
          return false;
        }

        set({ operation: "committing" });
        await delay(700);

        const msg = state.commitMessage.trim();
        const desc = state.commitDescription.trim();
        const finalMessage = state.signOff
          ? `${msg}${desc ? `\n\n${desc}` : ""}\n\nSigned-off-by: Maryam <maryam@lens.app>`
          : msg;

        const newCommit: GitCommit = {
          id: `cm-${Date.now()}`,
          hash: Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2),
          shortHash: Math.random().toString(16).slice(2, 9),
          message: finalMessage.split("\n")[0],
          description: desc || undefined,
          author: "Maryam",
          email: "maryam@lens.app",
          avatarColor: "#FCAA26",
          timestamp: new Date().toISOString(),
          relativeTime: "just now",
          filesChanged: staged.length || 1,
          additions: staged.reduce((n, c) => n + c.additions, 0),
          deletions: staged.reduce((n, c) => n + c.deletions, 0),
          refs: ["HEAD"],
        };

        set((s) => ({
          commits: [newCommit, ...s.commits],
          changes: s.changes.filter((c) => !c.staged),
          commitMessage: "",
          commitDescription: "",
          amend: false,
          operation: "idle",
          recentMessages: [msg, ...s.recentMessages.filter((m) => m !== msg)].slice(0, 10),
          branches: s.branches.map((b) =>
            b.current ? { ...b, ahead: b.ahead + 1 } : b,
          ),
        }));

        toast.success("Commit created", { description: newCommit.shortHash });
        return true;
      },

      checkoutBranch: async (name) => {
        set({ operation: "checking-out" });
        await delay(500);
        set((s) => ({
          branches: s.branches.map((b) => ({ ...b, current: b.name === name })),
          operation: "idle",
        }));
        toast.success(`Switched to branch '${name}'`);
      },

      createBranch: async (name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        if (get().branches.some((b) => b.name === trimmed)) {
          toast.error("Branch already exists");
          return;
        }
        set({ operation: "checking-out" });
        await delay(400);
        set((s) => ({
          branches: [
            {
              name: trimmed,
              current: true,
              ahead: 0,
              behind: 0,
              lastCommitAt: "just now",
            },
            ...s.branches.map((b) => ({ ...b, current: false })),
          ],
          operation: "idle",
        }));
        toast.success(`Created and switched to '${trimmed}'`);
      },

      renameBranch: (oldName, newName) => {
        set((s) => ({
          branches: s.branches.map((b) =>
            b.name === oldName ? { ...b, name: newName } : b,
          ),
          favoriteBranches: s.favoriteBranches.map((n) =>
            n === oldName ? newName : n,
          ),
        }));
        toast.success(`Renamed to '${newName}'`);
      },

      deleteBranch: (name) => {
        const branch = get().branches.find((b) => b.name === name);
        if (branch?.current) {
          toast.error("Cannot delete the current branch");
          return;
        }
        set((s) => ({
          branches: s.branches.filter((b) => b.name !== name),
          favoriteBranches: s.favoriteBranches.filter((n) => n !== name),
        }));
        toast.success(`Deleted branch '${name}'`);
      },

      toggleFavoriteBranch: (name) =>
        set((s) => ({
          favoriteBranches: s.favoriteBranches.includes(name)
            ? s.favoriteBranches.filter((n) => n !== name)
            : [...s.favoriteBranches, name],
        })),

      fetchRemote: async () => {
        set({ operation: "fetching" });
        await delay(800);
        set({ operation: "idle", lastFetchAt: "just now" });
        toast.success("Fetch completed");
      },

      pull: async () => {
        const branch = get().getCurrentBranch();
        set({ operation: "pulling" });
        await delay(900);
        if (branch && branch.behind > 0) {
          set((s) => ({
            branches: s.branches.map((b) =>
              b.current ? { ...b, behind: 0 } : b,
            ),
            operation: "idle",
            lastFetchAt: "just now",
          }));
          toast.success("Pull completed", { description: "Already up to date with remote changes applied" });
        } else {
          set({ operation: "idle", lastFetchAt: "just now" });
          toast.success("Already up to date");
        }
      },

      push: async (force = false) => {
        set({ operation: "pushing" });
        await delay(1000);
        set((s) => ({
          branches: s.branches.map((b) =>
            b.current ? { ...b, ahead: 0 } : b,
          ),
          operation: "idle",
        }));
        toast.success(force ? "Force push completed" : "Push completed");
      },

      sync: async () => {
        set({ operation: "syncing" });
        await delay(600);
        await get().pull();
        set({ operation: "syncing" });
        await delay(400);
        await get().push();
        set({ operation: "idle" });
        toast.success("Sync completed");
      },

      resolveConflict: (id, resolution) => {
        set((s) => ({
          conflicts: s.conflicts.map((c) =>
            c.id === id ? { ...c, resolved: resolution } : c,
          ),
          changes:
            resolution && resolution !== null
              ? s.changes.map((ch) =>
                  ch.path === s.conflicts.find((c) => c.id === id)?.path
                    ? { ...ch, status: "modified" as const, staged: true }
                    : ch,
                )
              : s.changes,
        }));
        if (resolution) toast.success(`Conflict resolved (${resolution})`);
      },

      applyTemplate: (message) => set({ commitMessage: message }),
    }),
    {
      name: "lens-git",
      partialize: (s) => ({
        activeRepoId: s.activeRepoId,
        diffMode: s.diffMode,
        favoriteBranches: s.favoriteBranches,
        recentMessages: s.recentMessages,
        amend: s.amend,
        signOff: s.signOff,
      }),
    },
  ),
);
