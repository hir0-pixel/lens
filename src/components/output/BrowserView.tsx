import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Crosshair,
  Loader2,
  Lock,
  RefreshCw,
  Star,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { detectDevServerUrl } from "@/features/projects/detectDevServer";
import { DisabledControl } from "@/components/ui/DisabledControl";

interface BrowserViewProps {
  selectMode: boolean;
  onToggleSelectMode: () => void;
  initialUrl?: string | null;
}

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  return `http://${t}`;
}

export default function BrowserView({
  selectMode: _selectMode,
  onToggleSelectMode: _onToggleSelectMode,
  initialUrl,
}: BrowserViewProps) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [committed, setCommitted] = useState(initialUrl ?? "");
  const [loading, setLoading] = useState(false);
  const [probed, setProbed] = useState(Boolean(initialUrl));
  const historyRef = useRef<string[]>([]);
  const [histIndex, setHistIndex] = useState(-1);

  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (probed || initialUrl) return;
    let cancelled = false;
    void detectDevServerUrl().then((found) => {
      if (cancelled) return;
      setProbed(true);
      if (found) commitNavigate(found, true);
      else {
        window.requestAnimationFrame(() => urlInputRef.current?.focus());
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl, probed]);

  function commitNavigate(target: string, replace = false) {
    const next = normalizeUrl(target);
    setUrl(next);
    setCommitted(next);
    if (!next) return;
    if (replace || histIndex < 0) {
      historyRef.current = [next];
      setHistIndex(0);
    } else {
      const truncated = historyRef.current.slice(0, histIndex + 1);
      if (truncated[truncated.length - 1] !== next) {
        truncated.push(next);
      }
      historyRef.current = truncated;
      setHistIndex(truncated.length - 1);
    }
    setLoading(true);
    window.setTimeout(() => setLoading(false), 800);
  }

  function navigate(next?: string) {
    commitNavigate(next ?? url, false);
  }

  function goBack() {
    if (histIndex <= 0) return;
    const i = histIndex - 1;
    setHistIndex(i);
    const target = historyRef.current[i];
    setUrl(target);
    setCommitted(target);
    setLoading(true);
    window.setTimeout(() => setLoading(false), 400);
  }

  function goForward() {
    if (histIndex >= historyRef.current.length - 1) return;
    const i = histIndex + 1;
    setHistIndex(i);
    const target = historyRef.current[i];
    setUrl(target);
    setCommitted(target);
    setLoading(true);
    window.setTimeout(() => setLoading(false), 400);
  }

  const canBack = histIndex > 0;
  const canForward = histIndex >= 0 && histIndex < historyRef.current.length - 1;

  return (
    <div className="flex h-full flex-col bg-[var(--bg-base)]">
      <div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5">
        <button
          type="button"
          disabled={!canBack}
          onClick={goBack}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded",
            canBack
              ? "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              : "cursor-not-allowed text-[var(--text-tertiary)] opacity-50",
          )}
          aria-label="Back"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={!canForward}
          onClick={goForward}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded",
            canForward
              ? "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              : "cursor-not-allowed text-[var(--text-tertiary)] opacity-50",
          )}
          aria-label="Forward"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => (loading ? setLoading(false) : navigate(committed))}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          aria-label="Reload"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] px-3 py-1">
          <Lock className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
          <input
            ref={urlInputRef}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && navigate()}
            placeholder="Enter a URL"
            className="w-full bg-transparent type-code text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          />
        </div>

        <DisabledControl
          reason="Bookmarks require a synced account — coming soon"
          className="flex h-6 w-6 items-center justify-center rounded"
          aria-label="Bookmark"
        >
          <Star className="h-3.5 w-3.5" />
        </DisabledControl>

        <DisabledControl
          reason="Element picker needs agent edit mode — coming soon"
          className="flex h-7 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--bg-hover)] px-2.5 type-caption font-medium text-[var(--text-secondary)]"
          aria-label="Select to Edit"
        >
          <Crosshair className="h-3.5 w-3.5" />
          Select
        </DisabledControl>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--bg-surface)]">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--bg-surface)]/60">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-primary)]" />
          </div>
        )}

        {committed ? (
          <iframe
            title="Embedded browser"
            src={committed}
            className="h-full w-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="type-nav text-[var(--text-primary)]">
              No page loaded
            </p>
            <p className="max-w-sm type-caption text-[var(--text-tertiary)]">
              Type a URL above and press Enter. If a local dev server is
              running, Lens will open it automatically when available.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
