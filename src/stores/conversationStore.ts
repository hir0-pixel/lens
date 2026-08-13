import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatMessage } from "@/lib/types";

interface ConversationState {
  messagesByProject: Record<string, ChatMessage[]>;
  getMessages: (projectId: string) => ChatMessage[];
  setMessages: (projectId: string, messages: ChatMessage[]) => void;
  clearMessages: (projectId: string) => void;
}

/** Persist AI threads per project (bounded). */
export const useConversationStore = create<ConversationState>()(
  persist(
    (set, get) => ({
      messagesByProject: {},
      getMessages: (projectId) => get().messagesByProject[projectId] ?? [],
      setMessages: (projectId, messages) =>
        set((s) => ({
          messagesByProject: {
            ...s.messagesByProject,
            [projectId]: messages.slice(-200),
          },
        })),
      clearMessages: (projectId) =>
        set((s) => {
          const next = { ...s.messagesByProject };
          delete next[projectId];
          return { messagesByProject: next };
        }),
    }),
    {
      name: "lens-conversations-v2",
      partialize: (s) => ({ messagesByProject: s.messagesByProject }),
    },
  ),
);
