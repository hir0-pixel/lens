import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "sonner";

export type AiProviderKind = "lens";

export interface AiProviderConfig {
  id: string;
  kind: AiProviderKind;
  name: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  organizationId?: string;
  defaultModelId?: string;
  priority: number;
  status: "unknown" | "connected" | "error" | "testing";
  lastTestedAt?: string;
  statusMessage?: string;
}

export interface AiModelInfo {
  id: string;
  providerId: string;
  label: string;
  contextWindow: number;
  vision: boolean;
  reasoning: boolean;
  favorite?: boolean;
}

interface ProviderStore {
  providers: AiProviderConfig[];
  models: AiModelInfo[];
  recentModelIds: string[];
  updateProvider: (id: string, partial: Partial<AiProviderConfig>) => void;
  toggleProvider: (id: string) => void;
  setApiKey: (id: string, apiKey: string) => void;
  testConnection: (id: string) => Promise<boolean>;
  toggleFavoriteModel: (id: string) => void;
  pushRecentModel: (id: string) => void;
  setDefaultModel: (providerId: string, modelId: string) => void;
}

const DEFAULT_PROVIDER: AiProviderConfig = {
  id: "lens",
  kind: "lens",
  name: "Lens Sovereign",
  enabled: true,
  apiKey: "",
  baseUrl: "Platform-managed",
  defaultModelId: "lens-default",
  priority: 0,
  status: "connected",
  statusMessage: "Managed by the sovereign platform",
};

const DEFAULT_MODEL: AiModelInfo = {
  id: "lens-default",
  providerId: "lens",
  label: "Lens Sovereign",
  contextWindow: 200000,
  vision: true,
  reasoning: true,
  favorite: true,
};

const DEFAULT_STATE = {
  providers: [DEFAULT_PROVIDER],
  models: [DEFAULT_MODEL],
  recentModelIds: [DEFAULT_MODEL.id],
};

function normalizeProviderState(input?: Partial<ProviderStore>) {
  const storedProvider = input?.providers?.find((provider) => provider.id === DEFAULT_PROVIDER.id);
  const storedModel = input?.models?.find((model) => model.id === DEFAULT_MODEL.id);

  return {
    providers: [{ ...DEFAULT_PROVIDER, ...storedProvider, enabled: true, apiKey: "", baseUrl: DEFAULT_PROVIDER.baseUrl }],
    models: [{ ...DEFAULT_MODEL, ...storedModel, providerId: DEFAULT_MODEL.providerId }],
    recentModelIds: [DEFAULT_MODEL.id],
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const useProviderStore = create<ProviderStore>()(
  persist(
    (set, get) => ({
      ...DEFAULT_STATE,

      updateProvider: (id, partial) =>
        set((state) => ({
          providers: state.providers.map((provider) =>
            provider.id === id
              ? {
                ...provider,
                ...partial,
                enabled: true,
                apiKey: "",
                baseUrl: DEFAULT_PROVIDER.baseUrl,
                statusMessage: "Managed by the sovereign platform",
              }
              : provider,
          ),
        })),

      toggleProvider: () =>
        set(() => ({
          providers: [DEFAULT_PROVIDER],
        })),

      setApiKey: () =>
        set(() => ({
          providers: [DEFAULT_PROVIDER],
        })),

      testConnection: async (id) => {
        set((state) => ({
          providers: state.providers.map((provider) =>
            provider.id === id
              ? { ...provider, status: "testing", statusMessage: "Checking platform routing..." }
              : provider,
          ),
        }));
        await delay(150);
        const provider = get().providers.find((entry) => entry.id === id) ?? DEFAULT_PROVIDER;
        set(() => ({
          providers: [{
            ...provider,
            enabled: true,
            apiKey: "",
            baseUrl: DEFAULT_PROVIDER.baseUrl,
            status: "connected",
            statusMessage: "Managed by the sovereign platform",
            lastTestedAt: new Date().toISOString(),
          }],
        }));
        toast.success(`${provider.name} is managed by the platform`);
        return true;
      },

      toggleFavoriteModel: (id) =>
        set((state) => ({
          models: state.models.map((model) =>
            model.id === id ? { ...model, favorite: !model.favorite } : model,
          ),
        })),

      pushRecentModel: () =>
        set(() => ({
          recentModelIds: [DEFAULT_MODEL.id],
        })),

      setDefaultModel: () =>
        set(() => ({
          providers: [DEFAULT_PROVIDER],
        })),
    }),
    {
      name: "lens-providers",
      partialize: (state) => normalizeProviderState(state),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizeProviderState(persistedState as Partial<ProviderStore>),
      }),
    },
  ),
);
