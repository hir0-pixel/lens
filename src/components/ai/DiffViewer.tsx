import { useState } from "react";
import {
  Check,
  ChevronRight,
  FileCode2,
  GitCompareArrows,
  X,
} from "@/components/icons/tabler";
import { cn } from "../../lib/utils";
import type { DiffFileChange, FileEdit } from "../../lib/types";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { MOCK_DIFF } from "./mock-data";

interface DiffViewerProps {
  edits?: FileEdit[];
  diffFiles?: DiffFileChange[];
  onAccept?: (path: string) => void;
  onReject?: (path: string) => void;
  onAcceptAll?: () => void;
  onRejectAll?: () => void;
}

const LANG_COLORS: Record<string, string> = {
  tsx: "text-sky-400",
  ts: "text-sky-400",
  css: "text-pink-400",
  py: "text-yellow-300",
  js: "text-amber-300",
  json: "text-lime-400",
  md: "text-[var(--text-tertiary)]",
};

function DiffLineRow({ line }: { line: DiffFileChange["lines"][0] }) {
  return (
    <div
      className={cn(
        "flex type-code leading-5",
        line.type === "add" && "bg-[var(--success-muted)]",
        line.type === "delete" && "bg-[var(--error-muted)]",
        line.type === "modify" && "bg-[var(--warning)]/10",
      )}
    >
      <span className="w-8 shrink-0 select-none border-r border-[var(--border-subtle)] px-1 text-right text-[var(--text-disabled)]">
        {line.newLineNumber ?? line.oldLineNumber ?? ""}
      </span>
      <span
        className={cn(
          "w-4 shrink-0 select-none text-center",
          line.type === "add" && "text-[var(--success)]",
          line.type === "delete" && "text-[var(--error)]",
          line.type === "modify" && "text-[var(--warning)]",
        )}
      >
        {line.type === "add" ? "+" : line.type === "delete" ? "−" : line.type === "modify" ? "~" : " "}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 whitespace-pre px-2",
          line.type === "add" && "text-[var(--success)]",
          line.type === "delete" && "text-[var(--error)] line-through opacity-80",
          line.type === "modify" && "text-[var(--warning)]",
          line.type === "context" && "text-[var(--text-secondary)]",
        )}
      >
        {line.content || " "}
      </span>
    </div>
  );
}

export function DiffViewer({
  edits,
  diffFiles: externalDiff,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
}: DiffViewerProps) {
  const [open, setOpen] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<Record<string, DiffFileChange["status"]>>({});

  const diffFiles: DiffFileChange[] =
    externalDiff ??
    (edits?.map((e) => ({
      path: e.path,
      language: e.language,
      additions: e.additions,
      deletions: e.deletions,
      status: "pending" as const,
      lines: MOCK_DIFF.find((d) => d.path === e.path)?.lines ?? [
        { type: "add" as const, content: e.summary, newLineNumber: 1 },
      ],
    })) ??
      MOCK_DIFF);

  const files = diffFiles.map((f) => ({
    ...f,
    status: localStatus[f.path] ?? f.status ?? "pending",
  }));

  const activeFile = files.find((f) => f.path === selectedPath) ?? files[0];
  const pendingCount = files.filter((f) => f.status === "pending").length;

  function accept(path: string) {
    setLocalStatus((s) => ({ ...s, [path]: "accepted" }));
    onAccept?.(path);
  }

  function reject(path: string) {
    setLocalStatus((s) => ({ ...s, [path]: "rejected" }));
    onReject?.(path);
  }

  function acceptAll() {
    const next: Record<string, DiffFileChange["status"]> = {};
    files.forEach((f) => {
      next[f.path] = "accepted";
    });
    setLocalStatus(next);
    onAcceptAll?.();
  }

  function rejectAll() {
    const next: Record<string, DiffFileChange["status"]> = {};
    files.forEach((f) => {
      next[f.path] = "rejected";
    });
    setLocalStatus(next);
    onRejectAll?.();
  }

  if (files.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-surface-1 animate-fade-up">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-[var(--text-tertiary)] transition-transform duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
            open && "rotate-90",
          )}
        />
        <GitCompareArrows className="h-3.5 w-3.5 text-accent" />
        <span className="type-caption font-medium text-[var(--text-secondary)]">Review changes</span>
        <span className="ml-auto type-caption text-[var(--text-tertiary)]">
          {files.length} file{files.length !== 1 ? "s" : ""}
          {pendingCount > 0 && ` · ${pendingCount} pending`}
        </span>
      </button>

      {open && (
        <div className="border-t border-[var(--border-default)]">
          <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-2.5 py-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={acceptAll}
              className="h-7 gap-1 px-2 type-caption text-[var(--success)] hover:bg-[var(--success-muted)] hover:text-[var(--success)]"
            >
              <Check className="h-3 w-3" />
              Accept all
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={rejectAll}
              className="h-7 gap-1 px-2 type-caption text-[var(--error)] hover:bg-[var(--error-muted)] hover:text-[var(--error)]"
            >
              <X className="h-3 w-3" />
              Reject all
            </Button>
          </div>

          <div className="flex max-h-64">
            <div className="w-[38%] shrink-0 border-r border-[var(--border-subtle)]">
              <ScrollArea className="h-full max-h-64">
                {files.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => setSelectedPath(file.path)}
                    className={cn(
                      "flex w-full items-start gap-2 border-b border-[var(--border-subtle)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]",
                      activeFile?.path === file.path && "bg-[var(--bg-selected)]",
                      file.status === "accepted" && "opacity-60",
                      file.status === "rejected" && "opacity-40",
                    )}
                  >
                    <FileCode2
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0",
                        LANG_COLORS[file.language] ?? "text-[var(--text-tertiary)]",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate type-code text-[var(--text-primary)]">
                        {file.path.split("/").pop()}
                      </div>
                      <div className="truncate type-caption text-[var(--text-disabled)]">{file.path}</div>
                    </div>
                    <span className="flex shrink-0 flex-col items-end type-code">
                      <span className="text-[var(--success)]">+{file.additions}</span>
                      <span className="text-[var(--error)]">−{file.deletions}</span>
                    </span>
                  </button>
                ))}
              </ScrollArea>
            </div>

            <div className="min-w-0 flex-1">
              {activeFile && (
                <>
                  <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-2.5 py-1.5">
                    <span className="truncate type-code text-[var(--text-tertiary)]">
                      {activeFile.path}
                    </span>
                    {activeFile.status === "pending" && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => accept(activeFile.path)}
                          className="h-6 px-2 type-caption text-[var(--success)] hover:bg-[var(--success-muted)]"
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => reject(activeFile.path)}
                          className="h-6 px-2 type-caption text-[var(--error)] hover:bg-[var(--error-muted)]"
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                    {activeFile.status === "accepted" && (
                      <span className="type-caption text-[var(--success)]">Accepted</span>
                    )}
                    {activeFile.status === "rejected" && (
                      <span className="type-caption text-[var(--error)]">Rejected</span>
                    )}
                  </div>
                  <ScrollArea className="max-h-52">
                    {activeFile.lines.map((line, i) => (
                      <DiffLineRow key={i} line={line} />
                    ))}
                  </ScrollArea>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
