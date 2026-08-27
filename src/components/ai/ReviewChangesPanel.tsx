import { useState } from "react";
import {
  Check,
  ChevronRight,
  FileCode2,
  GitCompareArrows,
  X,
} from "@/components/icons/tabler";
import { cn } from "@/lib/utils";
import type { DiffFileChange } from "@/lib/types";
import { MOCK_DIFF } from "./mock-data";

interface ReviewChangesPanelProps {
  files?: DiffFileChange[];
  onAccept?: (path: string) => void;
  onReject?: (path: string) => void;
}

/**
 * Persistent session ledger of agent file changes — above composer / below plan.
 */
export function ReviewChangesPanel({
  files: external,
  onAccept,
  onReject,
}: ReviewChangesPanelProps) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, DiffFileChange["status"]>>(
    {},
  );

  const files = (external ?? MOCK_DIFF).map((f) => ({
    ...f,
    status: status[f.path] ?? f.status ?? "pending",
  }));

  if (files.length === 0) return null;

  const pending = files.filter((f) => f.status === "pending").length;

  function accept(path: string) {
    setStatus((s) => ({ ...s, [path]: "accepted" }));
    onAccept?.(path);
  }
  function reject(path: string) {
    setStatus((s) => ({ ...s, [path]: "rejected" }));
    onReject?.(path);
  }
  function acceptAll() {
    const next: Record<string, DiffFileChange["status"]> = {};
    files.forEach((f) => {
      next[f.path] = "accepted";
    });
    setStatus(next);
  }
  function rejectAll() {
    const next: Record<string, DiffFileChange["status"]> = {};
    files.forEach((f) => {
      next[f.path] = "rejected";
    });
    setStatus(next);
  }

  return (
    <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-full items-center gap-2 px-3 text-left transition-colors duration-[var(--duration-instant)] hover:bg-[var(--bg-hover)]"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-[var(--text-tertiary)] transition-transform duration-[var(--duration-fast)]",
            open && "rotate-90",
          )}
        />
        <GitCompareArrows
          className="h-3.5 w-3.5 text-[var(--accent-primary)]"
          strokeWidth={1.5}
        />
        <span className="type-caption font-medium text-[var(--text-primary)]">
          Review changes
        </span>
        <span className="ml-auto tabular-nums type-caption text-[var(--text-tertiary)]">
          {files.length} files
          {pending > 0 ? ` · ${pending} pending` : ""}
        </span>
      </button>

      {open && (
        <div className="animate-cursor-fade">
          <div className="sticky top-0 z-[1] flex items-center gap-2 border-y border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5">
            <button
              type="button"
              onClick={acceptAll}
              className="btn-ghost h-7 gap-1 type-caption text-[var(--success)] hover:bg-[var(--success-muted)]"
            >
              <Check className="h-3 w-3" />
              Accept all
            </button>
            <button
              type="button"
              onClick={rejectAll}
              className="btn-ghost h-7 gap-1 type-caption text-[var(--error)] hover:bg-[var(--error-muted)]"
            >
              <X className="h-3 w-3" />
              Reject all
            </button>
          </div>

          <ul className="max-h-48 overflow-y-auto">
            {files.map((file) => {
              const name = file.path.split("/").pop() ?? file.path;
              const isExp = expanded === file.path;
              return (
                <li
                  key={file.path}
                  className={cn(
                    "group border-b border-[var(--border-subtle)] last:border-0",
                    file.status !== "pending" && "opacity-60",
                  )}
                >
                  <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--bg-hover)]">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() =>
                        setExpanded((p) => (p === file.path ? null : file.path))
                      }
                    >
                      <ChevronRight
                        className={cn(
                          "h-3 w-3 shrink-0 text-[var(--text-tertiary)] transition-transform duration-[var(--duration-fast)]",
                          isExp && "rotate-90",
                        )}
                      />
                      <FileCode2 className="h-3.5 w-3.5 shrink-0 text-[var(--info)]" />
                      <span
                        className="min-w-0 flex-1 truncate type-code text-[var(--text-primary)]"
                        title={file.path}
                      >
                        {name}
                      </span>
                      <span className="shrink-0 type-code tabular-nums text-[var(--success)]">
                        +{file.additions}
                      </span>
                      <span className="shrink-0 type-code tabular-nums text-[var(--error)]">
                        −{file.deletions}
                      </span>
                    </button>
                    {file.status === "pending" && (
                      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-[var(--duration-instant)] group-hover:opacity-100">
                        <button
                          type="button"
                          className="btn-ghost h-6 w-6 text-[var(--success)]"
                          aria-label={`Accept ${name}`}
                          onClick={() => accept(file.path)}
                        >
                          <Check className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          className="btn-ghost h-6 w-6 text-[var(--error)]"
                          aria-label={`Reject ${name}`}
                          onClick={() => reject(file.path)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                  {isExp && (
                    <pre className="max-h-32 overflow-auto border-t border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 type-code leading-5 text-[var(--text-secondary)]">
                      {file.lines.slice(0, 12).map((line, i) => (
                        <div
                          key={i}
                          className={cn(
                            line.type === "add" && "bg-[var(--success-muted)] text-[var(--success)]",
                            line.type === "delete" && "bg-[var(--error-muted)] text-[var(--error)]",
                          )}
                        >
                          {line.type === "add" ? "+" : line.type === "delete" ? "−" : " "}
                          {line.content}
                        </div>
                      ))}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
