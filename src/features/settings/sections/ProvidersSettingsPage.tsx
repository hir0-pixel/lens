import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useProviderStore, type AiProviderConfig } from "@/stores/providerStore";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { SettingsSectionHeader } from "../SettingControls";
import { PROVIDER_COLORS } from "@/shared/design-system";
import { useAuthStore } from "@/shared/bff-auth/store";
import { getBffAuthClient } from "@/shared/bff-auth";
import { useModelCatalogStore } from "@/stores/modelCatalogStore";
import { chunkDocumentText, sha256Digest, slugDocumentRef } from "../ingestionPaste";
import type { IngestionMeta } from "@/shared/bff-auth/client";

const KIND_COLOR = PROVIDER_COLORS;

function ProviderCard({ provider }: { provider: AiProviderConfig }) {
  const testConnection = useProviderStore((state) => state.testConnection);
  const models = useProviderStore(useShallow((state) =>
    state.models.filter((model) => model.providerId === provider.id),
  ));

  return (
    <Card className="gap-0 rounded-lg border border-[var(--border-default)] bg-surface-0/40 p-4">
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
          <p className="type-caption text-[var(--text-tertiary)]">Sovereign platform routing</p>
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
  const subject = useAuthStore((state) => state.session?.subject);
  const adminSubjectsConfigured = useAuthStore((state) => state.session?.adminSubjectsConfigured === true);
  const refreshCatalog = useModelCatalogStore((state) => state.refresh);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [allowlist, setAllowlist] = useState("");
  const [adapterType, setAdapterType] = useState<"openai-compatible">("openai-compatible");
  const [providerIdHint, setProviderIdHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    void useAuthStore.getState().check();
  }, []);

  async function submitOnboard() {
    const client = getBffAuthClient();
    if (!client) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await client.onboardProvider({
        adapterType,
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
      setMessage(
        result.status === "unhealthy"
          ? `Provider ${result.id} is unhealthy: no allowlisted model id was in the provider catalog. Use ids the catalog actually returns (for Google, try gemini-2.5-flash or gemini-*). Gemini 2.0 Flash is shut down.`
          : `Provider ${result.id} is ${result.status}${providerIdHint ? ` (note: ${providerIdHint})` : ""}.`,
      );
      await refreshCatalog();
    } catch (error) {
      setApiKey("");
      const record = error && typeof error === "object" ? error as { detail?: unknown; status?: unknown; code?: unknown; name?: unknown } : {};
      const detail = typeof record.detail === "string" ? record.detail : typeof record.code === "string" ? record.code : undefined;
      const status = typeof record.status === "number" ? record.status : undefined;
      const hint =
        detail === "INVALID_ARGUMENT"
          ? " The BFF rejected the URL or payload (sovereign profile blocks public Google/OpenAI hosts)."
          : detail === "INVALID_KEY"
            ? " The provider rejected the key."
            : detail === "PROVIDER_UNAVAILABLE"
              ? " The BFF could not reach the provider catalog (check base URL, network, or key)."
              : detail === "FORBIDDEN" || detail === "UNAUTHENTICATED" || detail === "CSRF_REJECTED" || detail === "AUTH_REQUIRED"
                ? " Sign in again as an administrator and retry."
                : detail
                  ? ` ${detail}.`
                  : status
                    ? ` HTTP ${status}.`
                    : "";
      setMessage(`Onboarding failed.${hint} The key was not stored in the browser.`);
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
      <p className="mb-3 type-caption text-[var(--text-tertiary)]">
        Signed in as {subject ?? "(no subject)"}.
        {administrator
          ? " Administrator: yes."
          : adminSubjectsConfigured
            ? " Administrator: no — this subject is not in ADMIN_SUBJECTS."
            : " Administrator: no — this BFF did not load ADMIN_SUBJECTS."}
      </p>
      <div className="space-y-3">
        {providers.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} />
        ))}
      </div>
      {administrator && (
        <Card className="mt-4 gap-0 rounded-lg border border-[var(--border-default)] bg-surface-0/40 p-4">
          <p className="type-caption font-medium text-[var(--text-primary)]">Register an internal model gateway</p>
          <p className="mt-1 type-caption text-[var(--text-tertiary)]">Always use openai-compatible. Change only the base URL and key — development demo and later internal gateway use the same adapter.</p>
          <div className="mt-3 space-y-2">
            <div>
              <Label htmlFor="provider-adapter" className="mb-1 block type-caption font-normal text-[var(--text-tertiary)]">Adapter type</Label>
              <select
                id="provider-adapter"
                aria-label="Adapter type"
                value={adapterType}
                onChange={(event) => setAdapterType(event.target.value as "openai-compatible")}
                className="h-9 w-full rounded-md border border-[var(--border-default)] bg-surface-2 px-2 type-caption text-[var(--text-primary)]"
              >
                <option value="openai-compatible">openai-compatible</option>
              </select>
            </div>
            <div>
              <Label htmlFor="provider-id-hint" className="mb-1 block type-caption font-normal text-[var(--text-tertiary)]">Provider id</Label>
              <Input id="provider-id-hint" value={providerIdHint} onChange={(event) => setProviderIdHint(event.target.value)} placeholder="internal-gateway" className="h-9 border-[var(--border-default)] bg-surface-2 type-caption" />
              <p className="mt-1 type-caption text-[var(--text-tertiary)]">Used only as a local note. The BFF returns the canonical id after register.</p>
            </div>
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
      {administrator && <CorpusPasteCard />}
    </div>
  );
}

function CorpusPasteCard() {
  const [meta, setMeta] = useState<IngestionMeta | null>(null);
  const [metaError, setMetaError] = useState<string>();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [corpusRef, setCorpusRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    const client = getBffAuthClient();
    if (!client) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await client.getIngestionMeta();
        if (cancelled) return;
        setMeta(next);
        setCorpusRef(next.corpora[0] ?? "");
        setMetaError(undefined);
      } catch (error) {
        if (cancelled) return;
        const detail = error && typeof error === "object" && "detail" in error && typeof (error as { detail?: unknown }).detail === "string"
          ? (error as { detail: string }).detail
          : undefined;
        setMeta(null);
        setMetaError(
          detail === "FORBIDDEN" || detail === "UNAUTHENTICATED"
            ? "Administrator session required for ingestion."
            : "Ingestion is not enabled on this BFF (merge bff-rag.env with INGESTION_ENABLED=true and restart).",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function publishDocument() {
    const client = getBffAuthClient();
    if (!client || !meta || !corpusRef || !body.trim()) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const documentRef = slugDocumentRef(title || "pasted-document");
      const version = `v${Date.now()}`;
      const versionRef = `${documentRef}@${version}`;
      const chunks = chunkDocumentText(body, { ...meta.chunking, documentRef });
      if (chunks.length === 0) {
        setMessage("Document text is empty after chunking.");
        return;
      }
      const prepared = await Promise.all(
        chunks.map(async (chunk) => ({
          ...chunk,
          contentDigest: await sha256Digest(chunk.text),
        })),
      );
      const contentDigest = await sha256Digest(body);
      const renditionDigest = await sha256Digest(`rendition:${versionRef}`);
      const aclDigest = await sha256Digest(`acl:${documentRef}`);
      const result = await client.submitIngestionJob(corpusRef, {
        sourceId: "admin-paste",
        documentRef,
        version,
        versionRef,
        contentDigest,
        aclDigest,
        classificationRef: "internal",
        parse: {
          status: "accepted",
          renditionDigest,
          chunks: prepared,
        },
        ragProfileVersion: meta.ragProfileVersion,
        ragProfileDigest: meta.ragProfileDigest,
      });
      setMessage(
        result.state === "COMMITTED" || result.state === "PUBLISHED"
          ? `Published ${documentRef} (${prepared.length} chunk${prepared.length === 1 ? "" : "s"}). Ask about it in chat.`
          : `Ingestion job ${result.jobId}: ${result.state}/${result.stage}.`,
      );
      setBody("");
    } catch (error) {
      const detail = error && typeof error === "object" && "detail" in error && typeof (error as { detail?: unknown }).detail === "string"
        ? (error as { detail: string }).detail
        : undefined;
      setMessage(
        detail === "STALE_AUTHORITY"
          ? "RAG profile changed — refresh this page and retry."
          : detail
            ? `Ingest failed: ${detail}.`
            : "Ingest failed. Confirm INGESTION_ENABLED and that you are signed in as an admin.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4 gap-0 rounded-lg bg-surface-0/40 p-4 ring-[var(--border-default)]">
      <p className="type-caption font-medium text-[var(--text-primary)]">Paste company documents</p>
      <p className="mt-1 type-caption text-[var(--text-tertiary)]">
        Publishes into the company RAG corpus via the admin ingestion API. Ask mode then answers from published chunks.
      </p>
      {metaError ? (
        <p className="mt-3 type-caption text-[var(--text-tertiary)]">{metaError}</p>
      ) : !meta ? (
        <p className="mt-3 type-caption text-[var(--text-tertiary)]">Loading ingestion profile…</p>
      ) : (
        <div className="mt-3 space-y-2">
          <div>
            <Label htmlFor="ingest-corpus" className="mb-1 block type-caption font-normal text-[var(--text-tertiary)]">Corpus</Label>
            <select
              id="ingest-corpus"
              aria-label="Corpus"
              value={corpusRef}
              onChange={(event) => setCorpusRef(event.target.value)}
              className="h-9 w-full rounded-md border border-[var(--border-default)] bg-surface-2 px-2 type-caption text-[var(--text-primary)]"
            >
              {meta.corpora.map((corpus) => (
                <option key={corpus} value={corpus}>{corpus}</option>
              ))}
            </select>
          </div>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Document title (optional)"
            className="h-9 border-[var(--border-default)] bg-surface-2 type-caption"
          />
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Paste policy, manual, or notes here…"
            className="min-h-36 border-[var(--border-default)] bg-surface-2 type-caption"
          />
          <Button size="sm" disabled={busy || !body.trim() || !corpusRef} onClick={() => void publishDocument()}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Publish to corpus"}
          </Button>
          {message && <p className="type-caption text-[var(--text-tertiary)]">{message}</p>}
        </div>
      )}
    </Card>
  );
}

export function ModelsSettingsPage() {
  const models = useModelCatalogStore((state) => state.models);
  const status = useModelCatalogStore((state) => state.status);
  const errorMessage = useModelCatalogStore((state) => state.errorMessage);
  const refresh = useModelCatalogStore((state) => state.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div>
      <SettingsSectionHeader
        title="Models"
        description="Approved models from the live BFF catalog after provider register."
      />
      {status === "loading" || status === "idle" ? (
        <p className="type-caption text-[var(--text-tertiary)]">Loading approved models…</p>
      ) : null}
      {status === "error" ? (
        <p className="type-caption text-[var(--text-tertiary)]">{errorMessage ?? "Could not load approved models."}</p>
      ) : null}
      {status === "empty" ? (
        <p className="type-caption text-[var(--text-tertiary)]">No approved models. Register a provider, then return here.</p>
      ) : null}
      {status === "ready" ? (
        <div className="overflow-hidden divide-y divide-white/5 rounded-lg border border-[var(--border-default)]">
          {models.map((model) => (
            <div key={model.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="type-caption text-[var(--text-primary)]">{model.label}</div>
                <div className="type-code text-[var(--text-tertiary)]">{model.id}</div>
              </div>
              <Badge variant="secondary" className="h-5 font-normal">
                {model.available === false ? "Unavailable" : "Available"}
              </Badge>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
