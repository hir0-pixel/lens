import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "sonner";
import { isPlausibleApiKey, redactProviderForLog } from "@/shared/security/sanitize";
import { logger } from "@/shared/diagnostics/logger";

export type AiProviderKind =
  | "lens"
  | "openai"
  | "anthropic"
  | "google"
  | "openrouter"
  | "ollama"
  | "azure"
  | "custom";

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

const DEFAULT_PROVIDERS: AiProviderConfig[] = [
  {
    id: "lens",
    kind: "lens",
    name: "Lens",
    enabled: true,
    apiKey: "",
    baseUrl: "https://api.lens.app/v1",
    defaultModelId: "lens-default",
    priority: 0,
    status: "connected",
  },
  {
    id: "openai",
    kind: "openai",
    name: "OpenAI",
    enabled: true,
    apiKey: "sk-••••••••••••8f2a",
    baseUrl: "https://api.openai.com/v1",
    organizationId: "",
    defaultModelId: "gpt-5.1",
    priority: 1,
    status: "connected",
  },
  {
    id: "anthropic",
    kind: "anthropic",
    name: "Anthropic",
    enabled: true,
    apiKey: "sk-ant-••••••••",
    baseUrl: "https://api.anthropic.com",
    defaultModelId: "claude-sonnet-4.5",
    priority: 2,
    status: "connected",
  },
  {
    id: "google",
    kind: "google",
    name: "Google Gemini",
    enabled: false,
    apiKey: "",
    baseUrl: "https://generativelanguage.googleapis.com/v1",
    defaultModelId: "gemini-2.5-pro",
    priority: 3,
    status: "unknown",
  },
  {
    id: "openrouter",
    kind: "openrouter",
    name: "OpenRouter",
    enabled: false,
    apiKey: "",
    baseUrl: "https://openrouter.ai/api/v1",
    priority: 4,
    status: "unknown",
  },
  {
    id: "ollama",
    kind: "ollama",
    name: "Ollama",
    enabled: false,
    apiKey: "",
    baseUrl: "http://localhost:11434",
    defaultModelId: "llama3.2",
    priority: 5,
    status: "unknown",
  },
  {
    id: "azure",
    kind: "azure",
    name: "Azure OpenAI",
    enabled: false,
    apiKey: "",
    baseUrl: "https://YOUR_RESOURCE.openai.azure.com",
    priority: 6,
    status: "unknown",
  },
  {
    id: "custom",
    kind: "custom",
    name: "Custom OpenAI-compatible",
    enabled: false,
    apiKey: "",
    baseUrl: "http://localhost:8080/v1",
    priority: 7,
    status: "unknown",
  },
];

const DEFAULT_MODELS: AiModelInfo[] = [
  { id: "lens-default", providerId: "lens", label: "Lens Default", contextWindow: 200000, vision: true, reasoning: true, favorite: true },
  { id: "gpt-5.1", providerId: "openai", label: "GPT-5.1", contextWindow: 128000, vision: true, reasoning: true, favorite: true },
  { id: "gpt-4o", providerId: "openai", label: "GPT-4o", contextWindow: 128000, vision: true, reasoning: false },
  { id: "claude-opus-4.5", providerId: "anthropic", label: "Claude Opus 4.5", contextWindow: 200000, vision: true, reasoning: true },
  { id: "claude-sonnet-4.5", providerId: "anthropic", label: "Claude Sonnet 4.5", contextWindow: 200000, vision: true, reasoning: true, favorite: true },
  { id: "gemini-2.5-pro", providerId: "google", label: "Gemini 2.5 Pro", contextWindow: 1000000, vision: true, reasoning: true },
  { id: "gemini-2.5-flash", providerId: "google", label: "Gemini 2.5 Flash", contextWindow: 1000000, vision: true, reasoning: false },
  { id: "llama3.2", providerId: "ollama", label: "Llama 3.2", contextWindow: 128000, vision: false, reasoning: false },
];

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

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const useProviderStore = create<ProviderStore>()(
  persist(
    (set, get) => ({
      providers: DEFAULT_PROVIDERS,
      models: DEFAULT_MODELS,
      recentModelIds: ["lens-default", "claude-sonnet-4.5", "gpt-5.1"],

      updateProvider: (id, partial) =>
        set((s) => ({
          providers: s.providers.map((p) => (p.id === id ? { ...p, ...partial } : p)),
        })),

      toggleProvider: (id) =>
        set((s) => ({
          providers: s.providers.map((p) =>
            p.id === id ? { ...p, enabled: !p.enabled } : p,
          ),
        })),

      setApiKey: (id, apiKey) => get().updateProvider(id, { apiKey }),

      testConnection: async (id) => {
        get().updateProvider(id, { status: "testing", statusMessage: "Testing…" });
        await delay(900);
        const provider = get().providers.find((p) => p.id === id);
        const ok =
          provider?.kind === "lens" ||
          provider?.kind === "ollama" ||
          Boolean(
            provider &&
              isPlausibleApiKey(provider.apiKey, provider.kind),
          );

        logger.info("provider.test", {
          provider: provider
            ? redactProviderForLog(provider)
            : { id },
          ok,
        });

        get().updateProvider(id, {
          status: ok ? "connected" : "error",
          statusMessage: ok ? "Connection successful" : "Invalid or missing API key",
          lastTestedAt: new Date().toISOString(),
          enabled: ok ? true : provider?.enabled,
        });

        if (ok) toast.success(`${provider?.name} connected`);
        else toast.error(`${provider?.name} connection failed`);
        return ok;
      },

      toggleFavoriteModel: (id) =>
        set((s) => ({
          models: s.models.map((m) =>
            m.id === id ? { ...m, favorite: !m.favorite } : m,
          ),
        })),

      pushRecentModel: (id) =>
        set((s) => ({
          recentModelIds: [id, ...s.recentModelIds.filter((x) => x !== id)].slice(0, 8),
        })),

      setDefaultModel: (providerId, modelId) =>
        get().updateProvider(providerId, { defaultModelId: modelId }),
    }),
    {
      name: "lens-providers",
      partialize: (s) => ({
        providers: s.providers,
        models: s.models,
        recentModelIds: s.recentModelIds,
      }),
    },
  ),
);
