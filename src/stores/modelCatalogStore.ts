import { create } from "zustand";
import { getBffAuthClient } from "@/shared/bff-auth";
import type { Model } from "@/lib/types";

export type CatalogStatus = "idle" | "loading" | "ready" | "empty" | "error";

interface ModelCatalogState {
  status: CatalogStatus;
  models: Model[];
  errorMessage?: string;
  refresh: () => Promise<void>;
}

export const useModelCatalogStore = create<ModelCatalogState>()((set) => ({
  status: "idle",
  models: [],
  refresh: async () => {
    set({ status: "loading", errorMessage: undefined });
    const client = getBffAuthClient();
    if (!client) {
      set({ status: "error", models: [], errorMessage: "Catalog is unavailable." });
      return;
    }
    try {
      const listed = await client.listModels();
      const models: Model[] = listed.map((row) => ({
        id: row.modelRef,
        label: row.label,
        provider: "lens",
        available: row.available,
      }));
      set({
        models,
        status: models.length === 0 ? "empty" : "ready",
      });
    } catch {
      set({ status: "error", models: [], errorMessage: "Could not load approved models." });
    }
  },
}));
