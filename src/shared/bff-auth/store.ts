import { create } from "zustand";
import { getBffAuthClient } from "./index";
import type { AuthSessionInfo } from "./client";

export type AuthStatus = "checking" | "authenticated" | "unauthenticated" | "error";

interface AuthState {
  status: AuthStatus;
  session: AuthSessionInfo | null;
  check: () => Promise<void>;
  clear: () => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set) => ({
  status: "checking",
  session: null,

  check: async () => {
    const client = getBffAuthClient();
    if (!client) {
      set({ status: "unauthenticated", session: null });
      return;
    }
    try {
      const session = await client.getSession();
      set({
        status: session.authenticated ? "authenticated" : "unauthenticated",
        session,
      });
    } catch {
      set({ status: "error", session: null });
    }
  },

  clear: () => set({ status: "unauthenticated", session: null }),

  logout: async () => {
    const client = getBffAuthClient();
    if (!client) {
      set({ status: "unauthenticated", session: null });
      return;
    }
    try {
      await client.logout();
    } finally {
      set({ status: "unauthenticated", session: null });
    }
  },
}));