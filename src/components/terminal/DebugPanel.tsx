import { Bug, Play } from "@/components/icons/tabler";

/**
 * Debug console — Start Debugging disabled until a debug adapter is wired.
 */
export function DebugPanel() {
  return (
    <div className="flex h-full flex-col bg-[var(--ds-panel)] type-caption text-[var(--ds-fg)]">
      <div className="flex h-[28px] shrink-0 items-center gap-2 border-b border-[var(--ds-border)] px-2">
        <button
          type="button"
          disabled
          title="No debug adapter configured for this workspace"
          className="flex cursor-not-allowed items-center gap-1 rounded-[2px] px-1.5 py-0.5 type-caption text-[var(--ds-fg-muted)] opacity-50"
        >
          <Play className="h-3.5 w-3.5 text-[var(--ds-success)]" strokeWidth={1.5} />
          Start Debugging
        </button>
        <span className="type-caption text-[var(--ds-fg-muted)] opacity-50">
          F5
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-[var(--ds-fg-muted)]">
        <Bug className="h-8 w-8 opacity-40" strokeWidth={1.25} />
        <p className="type-caption">
          Debug console will show runtime output when a debug adapter is
          configured for this project.
        </p>
      </div>
    </div>
  );
}
