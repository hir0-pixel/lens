import { useState } from "react";
import { Check, Loader2, Plug, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SettingsSectionHeader,
} from "../SettingControls";
import { useProviderStore, type AiProviderConfig } from "@/stores/providerStore";
import { cn } from "@/lib/utils";
import { PROVIDER_COLORS } from "@/shared/design-system";

const KIND_COLOR = PROVIDER_COLORS;

function ProviderCard({ provider }: { provider: AiProviderConfig }) {
  const updateProvider = useProviderStore((s) => s.updateProvider);
  const toggleProvider = useProviderStore((s) => s.toggleProvider);
  const testConnection = useProviderStore((s) => s.testConnection);
  const models = useProviderStore((s) =>
    s.models.filter((m) => m.providerId === provider.id),
  );
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold text-white"
          style={{ background: KIND_COLOR[provider.kind] ?? "#71717A" }}
        >
          {provider.name.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-zinc-100">{provider.name}</span>
            <Badge
              variant="secondary"
              className={cn(
                "h-5 text-[10px] font-normal",
                provider.status === "connected" && "bg-emerald-500/15 text-emerald-400",
                provider.status === "error" && "bg-red-500/15 text-red-400",
                provider.status === "testing" && "bg-amber-500/15 text-amber-400",
              )}
            >
              {provider.status}
            </Badge>
          </div>
          <p className="text-[11px] text-zinc-500">{provider.baseUrl}</p>
        </div>
        <Switch
          checked={provider.enabled}
          onCheckedChange={() => toggleProvider(provider.id)}
          aria-label={`Enable ${provider.name}`}
        />
      </div>

      <div className="mt-3 space-y-2.5 border-t border-white/5 pt-3">
        {provider.kind !== "orchids" && (
          <div>
            <label className="mb-1 block text-[11px] text-zinc-500">API Key</label>
            <div className="flex gap-2">
              <Input
                type={showKey ? "text" : "password"}
                value={provider.apiKey}
                onChange={(e) =>
                  updateProvider(provider.id, { apiKey: e.target.value })
                }
                placeholder="sk-…"
                className="h-8 flex-1 border-white/10 bg-surface-2 font-mono text-[12px]"
              />
              <Button
                variant="secondary"
                size="sm"
                className="h-8"
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? "Hide" : "Show"}
              </Button>
            </div>
          </div>
        )}
        <div>
          <label className="mb-1 block text-[11px] text-zinc-500">Base URL</label>
          <Input
            value={provider.baseUrl}
            onChange={(e) =>
              updateProvider(provider.id, { baseUrl: e.target.value })
            }
            className="h-8 border-white/10 bg-surface-2 font-mono text-[12px]"
          />
        </div>
        {(provider.kind === "openai" || provider.kind === "azure") && (
          <div>
            <label className="mb-1 block text-[11px] text-zinc-500">
              Organization ID
            </label>
            <Input
              value={provider.organizationId ?? ""}
              onChange={(e) =>
                updateProvider(provider.id, { organizationId: e.target.value })
              }
              className="h-8 border-white/10 bg-surface-2 font-mono text-[12px]"
              placeholder="org-…"
            />
          </div>
        )}
        {models.length > 0 && (
          <div>
            <label className="mb-1 block text-[11px] text-zinc-500">
              Default model
            </label>
            <Select
              value={provider.defaultModelId ?? models[0].id}
              onValueChange={(v) =>
                updateProvider(provider.id, { defaultModelId: v })
              }
            >
              <SelectTrigger className="h-8 border-white/10 bg-surface-2 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-[12px]">
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-zinc-600">
            Priority {provider.priority}
            {provider.statusMessage ? ` · ${provider.statusMessage}` : ""}
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 gap-1.5 text-[11px]"
            disabled={provider.status === "testing"}
            onClick={() => void testConnection(provider.id)}
          >
            {provider.status === "testing" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : provider.status === "connected" ? (
              <Check className="h-3 w-3 text-emerald-400" />
            ) : (
              <Plug className="h-3 w-3" />
            )}
            Test connection
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ProvidersSettingsPage() {
  const providers = useProviderStore((s) =>
    [...s.providers].sort((a, b) => a.priority - b.priority),
  );

  return (
    <div>
      <SettingsSectionHeader
        title="Providers"
        description="Connect OpenAI, Anthropic, Gemini, OpenRouter, Ollama, Azure, or custom endpoints."
      />
      <div className="space-y-3">
        {providers.map((p) => (
          <ProviderCard key={p.id} provider={p} />
        ))}
      </div>
    </div>
  );
}

export function ModelsSettingsPage() {
  const models = useProviderStore((s) => s.models);
  const recentModelIds = useProviderStore((s) => s.recentModelIds);
  const toggleFavoriteModel = useProviderStore((s) => s.toggleFavoriteModel);
  const providers = useProviderStore((s) => s.providers);
  const [query, setQuery] = useState("");

  const filtered = models.filter((m) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
  });

  const byProvider = providers
    .map((p) => ({
      provider: p,
      models: filtered.filter((m) => m.providerId === p.id),
    }))
    .filter((g) => g.models.length > 0);

  return (
    <div>
      <SettingsSectionHeader
        title="Models"
        description="Browse models by provider. Star favorites for quick access."
      />
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search models…"
        className="mb-4 h-9 border-white/10 bg-surface-2 text-[13px]"
      />

      {recentModelIds.length > 0 && !query && (
        <div className="mb-4">
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Recent
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {recentModelIds.map((id) => {
              const m = models.find((x) => x.id === id);
              if (!m) return null;
              return (
                <Badge key={id} variant="secondary" className="h-6 font-normal">
                  {m.label}
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {byProvider.map(({ provider, models: group }) => (
          <div key={provider.id}>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              {provider.name}
            </h3>
            <div className="overflow-hidden rounded-lg border border-white/10 divide-y divide-white/5">
              {group.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03]"
                >
                  <button
                    type="button"
                    onClick={() => toggleFavoriteModel(m.id)}
                    className="text-zinc-500 hover:text-accent"
                    aria-label={m.favorite ? "Unfavorite" : "Favorite"}
                  >
                    <Star
                      className={cn(
                        "h-3.5 w-3.5",
                        m.favorite && "fill-accent text-accent",
                      )}
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-zinc-200">{m.label}</div>
                    <div className="font-mono text-[10px] text-zinc-600">{m.id}</div>
                  </div>
                  <span className="text-[10px] tabular-nums text-zinc-500">
                    {(m.contextWindow / 1000).toFixed(0)}K
                  </span>
                  {m.vision && (
                    <Badge variant="secondary" className="h-5 text-[9px]">
                      Vision
                    </Badge>
                  )}
                  {m.reasoning && (
                    <Badge variant="secondary" className="h-5 text-[9px] text-accent">
                      Reasoning
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
