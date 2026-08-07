import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Automation {
  id: string;
  name: string;
  trigger: string;
  prompt: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

interface AutomationState {
  items: Automation[];
  add: (input: Pick<Automation, "name" | "trigger" | "prompt">) => Automation;
  update: (id: string, patch: Partial<Automation>) => void;
  remove: (id: string) => void;
  toggle: (id: string) => void;
}

function uid() {
  return `auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export const useAutomationStore = create<AutomationState>()(
  persist(
    (set, get) => ({
      items: [],

      add: (input) => {
        const item: Automation = {
          id: uid(),
          name: input.name.trim() || "Untitled automation",
          trigger: input.trigger.trim() || "Manual",
          prompt: input.prompt.trim(),
          enabled: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({ items: [item, ...s.items] }));
        return item;
      },

      update: (id, patch) => {
        set((s) => ({
          items: s.items.map((a) =>
            a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a,
          ),
        }));
      },

      remove: (id) => {
        set((s) => ({ items: s.items.filter((a) => a.id !== id) }));
      },

      toggle: (id) => {
        const a = get().items.find((x) => x.id === id);
        if (!a) return;
        get().update(id, { enabled: !a.enabled });
      },
    }),
    { name: "orchids-automations-v1" },
  ),
);
