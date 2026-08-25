import {
  FolderOpen,
  Keyboard,
  Sparkles,
} from "lucide-react";
import type { Project } from "../../lib/types";
import { KEYBOARD_SHORTCUTS, SUGGESTED_PROMPTS } from "./mock-data";

interface EmptyStateProps {
  onPromptSelect: (prompt: string) => void;
  recentWorkspaces?: Project[];
  onWorkspaceSelect?: (project: Project) => void;
}

/**
 * Agent empty state — animated enter, dense prompt list.
 */
export function EmptyState({
  onPromptSelect,
  recentWorkspaces = [],
  onWorkspaceSelect,
}: EmptyStateProps) {
  return (
    <div className="lens-empty-enter flex h-full flex-col px-3 py-4">
      <div className="mx-auto flex w-full max-w-[480px] flex-col">
        <div className="lens-empty-icon mb-3 flex h-16 w-16 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--accent-primary-muted)]">
          <Sparkles
            className="h-7 w-7 text-[var(--accent-primary)]"
            strokeWidth={1.5}
          />
        </div>
        <h2 className="mb-1 type-title-sm text-[var(--text-primary)]">
          Start an agent session
        </h2>
        <p className="mb-1 type-body-md text-[var(--text-secondary)]">
          Ask questions, edit code, or run multi-step agent tasks in this workspace.
        </p>
        <p className="mb-4 type-caption text-[var(--text-tertiary)]">
          Tip: use @ to attach files, folders, terminals, or past sessions.
        </p>

        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onPromptSelect(SUGGESTED_PROMPTS[0]?.prompt ?? "Explain this codebase")}
          >
            Try a prompt
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() =>
              onPromptSelect(
                SUGGESTED_PROMPTS[1]?.prompt ??
                  "Plan and implement the next feature",
              )
            }
          >
            Start agent
          </button>
        </div>

        <div className="mb-3 flex flex-col gap-0.5">
          {SUGGESTED_PROMPTS.slice(0, 4).map((item) => (
            <button
              key={item.id}
              type="button"
              title={item.prompt}
              onClick={() => onPromptSelect(item.prompt)}
              className="rounded-[var(--radius-sm)] px-2 py-1.5 text-left type-caption text-[var(--text-secondary)] transition-colors duration-[var(--duration-instant)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
            >
              <span className="block truncate">{item.label}</span>
            </button>
          ))}
        </div>

        {recentWorkspaces.length > 0 && onWorkspaceSelect && (
          <div className="mb-3">
            <div className="mb-1 flex items-center gap-1.5 px-2 type-caption-uppercase text-[var(--text-tertiary)]">
              <FolderOpen className="h-3 w-3" strokeWidth={1.5} />
              Recent
            </div>
            {recentWorkspaces.slice(0, 3).map((ws) => (
              <button
                key={ws.id}
                type="button"
                title={ws.name}
                onClick={() => onWorkspaceSelect?.(ws)}
                className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-left transition-colors duration-[var(--duration-instant)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: ws.color }}
                />
                <span className="min-w-0 flex-1 truncate type-caption text-[var(--text-primary)]">
                  {ws.name}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-auto border-t border-[var(--border-subtle)] pt-2">
          <div className="mb-1 flex items-center gap-1 px-2 type-caption text-[var(--text-tertiary)]">
            <Keyboard className="h-3 w-3" strokeWidth={1.5} />
            Shortcuts
          </div>
          {KEYBOARD_SHORTCUTS.slice(0, 4).map((s) => (
            <div
              key={s.keys}
              className="flex items-center justify-between px-2 py-0.5 type-caption text-[var(--text-tertiary)]"
            >
              <span className="truncate" title={s.action}>
                {s.action}
              </span>
              <kbd className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--bg-hover)] px-1.5 py-0.5 font-[family-name:var(--font-mono)] type-caption tabular-nums">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
