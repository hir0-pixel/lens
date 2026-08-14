import { create } from "zustand";
import type { ChatMessage } from "@/lib/types";

interface ConversationState {
  messagesByProject: Record<string, ChatMessage[]>;
  getMessages: (projectId: string) => ChatMessage[];
  setMessages: (projectId: string, messages: ChatMessage[]) => void;
  clearMessages: (projectId: string) => void;
}

/** Protected conversation content is memory-only; the server owns durable history. */
export const useConversationStore = create<ConversationState>((set, get) => ({
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
}));
