import { useState } from "react";
import { Check, Loader2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProviderStore, type AiProviderConfig } from "@/stores/providerStore";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { SettingsSectionHeader } from "../SettingControls";
import { PROVIDER_COLORS } from "@/shared/design-system";
import { useAuthStore } from "@/shared/bff-auth/store";
import { getBffAuthClient } from "@/shared/bff-auth";
import { useModelCatalogStore } from "@/stores/modelCatalogStore";

const KIND_COLOR = PROVIDER_COLORS;

function ProviderCard({ provider }: { provider: AiProviderConfig }) {
  const testConnection = useProviderStore((state) => state.testConnection);
  const models = useProviderStore(useShallow((state) =>
    state.models.filter((model) => model.providerId === provider.id),
  ));

  return (
    <Card className="gap-0 rounded-lg bg-surface-0/40 p-4 ring-[var(--border-default)]">
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-semibold text-white"
          style={{ background: KIND_COLOR[provider.kind] ?? "var(--text-tertiary)" }}
        >
          {provider.name.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="type-caption font-medium text-[var(--text-primary)]">{provider.name}</span>
            <Badge
              variant="secondary"
              className={cn(
                "h-5 type-caption font-normal",
                provider.status === "connected" && "bg-[var(--success-muted)] text-[var(--success)]",
                provider.status === "error" && "bg-[var(--error-muted)] text-[var(--error)]",
                provider.status === "testing" && "bg-[var(--bg-hover)] text-[var(--warning)]",
              )}
            >
              {provider.status}
            </Badge>
          </div>
          <p className="type-caption text-[var(--text-tertiary)]">{provider.baseUrl}</p>
        </div>
      </div>

      <div className="mt-3 space-y-3 border-t border-[var(--border-subtle)] pt-3">
        <div>
          <Label className="mb-1 block type-caption font-normal text-[var(--text-tertiary)]">Routing</Label>
          <div className="rounded-md border border-[var(--border-default)] bg-surface-2 px-3 py-2 type-caption text-[var(--text-secondary)]">
            Credentials, provider routing, and model access are managed by the sovereign platform deployment.
          </div>
        </div>
        {models.length > 0 && (
          <div>
            <Label className="mb-1 block type-caption font-normal text-[var(--text-tertiary)]">
              Default model
            </Label>
            <div className="rounded-md border border-[var(--border-default)] bg-surface-2 px-3 py-2 type-caption text-[var(--text-secondary)]">
              {models[0].label}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between pt-1">
          <span className="type-caption text-[var(--text-tertiary)]">
            Priority {provider.priority}
            {provider.statusMessage ? ` · ${provider.statusMessage}` : ""}
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 gap-1.5 type-caption"
            disabled={provider.status === "testing"}
            onClick={() => void testConnection(provider.id)}
          >
            {provider.status === "testing" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3 text-[var(--success)]" />
            )}
            Verify routing
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function ProvidersSettingsPage() {
  const providers = useProviderStore(useShallow((state) =>
    [...state.providers].sort((a, b) => a.priority - b.priority),
  ));
  const administrator = useAuthStore((state) => state.session?.administrator === true);
  const refreshCatalog = useModelCatalogStore((state) => state.refresh);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [allowlist, setAllowlist] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function submitOnboard() {
    const client = getBffAuthClient();
    if (!client) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await client.onboardProvider({
        baseUrl,
        apiKey,
        tlsWorkloadRef: "workload:runtime-adapter",
        allowedModels: allowlist.split(",").map((value) => value.trim()).filter(Boolean),
        capabilities: ["generate", "stream"],
        timeoutMs: 120_000,
        maxConcurrency: 8,
        idempotencyKey: crypto.randomUUID(),
      });
      setApiKey("");
      setMessage(`Provider ${result.id} is ${result.status}.`);
      await refreshCatalog();
    } catch {
      setApiKey("");
      setMessage("Onboarding failed. The key was not stored in the browser.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SettingsSectionHeader
        title="Providers"
        description="Review the provider surface exposed by this sovereign deployment."
      />
      <div className="space-y-3">
        {providers.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} />
        ))}
      </div>
      {administrator && (
        <Card className="mt-4 gap-0 rounded-lg bg-surface-0/40 p-4 ring-[var(--border-default)]">
          <p className="type-caption font-medium text-[var(--text-primary)]">Register an internal model gateway</p>
          <p className="mt-1 type-caption text-[var(--text-tertiary)]">The API key is sent once over the authenticated BFF and is never written to browser storage.</p>
          <div className="mt-3 space-y-2">
            <Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://models.company.internal/v1" className="h-9 border-[var(--border-default)] bg-surface-2 type-caption" />
            <Input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Provider API key" className="h-9 border-[var(--border-default)] bg-surface-2 type-caption" />
            <Input value={allowlist} onChange={(event) => setAllowlist(event.target.value)} placeholder="allowed model ids, comma-separated" className="h-9 border-[var(--border-default)] bg-surface-2 type-caption" />
            <Button size="sm" disabled={busy || !baseUrl || !apiKey || !allowlist} onClick={() => void submitOnboard()}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Register provider"}
            </Button>
            {message && <p className="type-caption text-[var(--text-tertiary)]">{message}</p>}
          </div>
        </Card>
      )}
    </div>
  );
}

export function ModelsSettingsPage() {
  const models = useProviderStore((state) => state.models);
  const recentModelIds = useProviderStore((state) => state.recentModelIds);
  const toggleFavoriteModel = useProviderStore((state) => state.toggleFavoriteModel);
  const providers = useProviderStore((state) => state.providers);
  const query = "";

  const filtered = models.filter((model) => {
    if (!query.trim()) return true;
    const lowered = query.toLowerCase();
    return model.label.toLowerCase().includes(lowered) || model.id.toLowerCase().includes(lowered);
  });

  const byProvider = providers
    .map((provider) => ({
      provider,
      models: filtered.filter((model) => model.providerId === provider.id),
    }))
    .filter((group) => group.models.length > 0);

  return (
    <div>
      <SettingsSectionHeader
        title="Models"
        description="Browse the model surface exposed by this sovereign deployment."
      />
      <Input
        value={query}
        readOnly
        placeholder="Search is locked to deployment-provided models"
        className="mb-4 h-9 border-[var(--border-default)] bg-surface-2 type-caption"
      />

      {recentModelIds.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 type-caption-uppercase text-[var(--text-tertiary)]">
            Recent
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {recentModelIds.map((id) => {
              const model = models.find((entry) => entry.id === id);
              if (!model) return null;
              return (
                <Badge key={id} variant="secondary" className="h-6 font-normal">
                  {model.label}
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {byProvider.map(({ provider, models: groupedModels }) => (
          <div key={provider.id}>
            <h3 className="mb-2 type-caption-uppercase text-[var(--text-tertiary)]">
              {provider.name}
            </h3>
            <div className="overflow-hidden divide-y divide-white/5 rounded-lg border border-[var(--border-default)]">
              {groupedModels.map((model) => (
                <div
                  key={model.id}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-hover)]"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => toggleFavoriteModel(model.id)}
                    className="text-[var(--text-tertiary)] hover:bg-transparent hover:text-accent"
                    aria-label={model.favorite ? "Unfavorite" : "Favorite"}
                  >
                    <Star
                      className={cn(
                        "h-3.5 w-3.5",
                        model.favorite && "fill-accent text-accent",
                      )}
                    />
                  </Button>
                  <div className="min-w-0 flex-1">
                    <div className="type-caption text-[var(--text-primary)]">{model.label}</div>
                    <div className="type-code text-[var(--text-tertiary)]">{model.id}</div>
                  </div>
                  <span className="type-caption tabular-nums text-[var(--text-tertiary)]">
                    {(model.contextWindow / 1000).toFixed(0)}K
                  </span>
                  {model.vision && (
                    <Badge variant="secondary" className="h-5 text-[9px]">
                      Vision
                    </Badge>
                  )}
                  {model.reasoning && (
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
