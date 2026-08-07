import { useState } from "react";
import {
  Check,
  ChevronRight,
  FileCode2,
  GitCompareArrows,
  X,
} from "lucide-react";
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
  md: "text-zinc-400",
};

function DiffLineRow({ line }: { line: DiffFileChange["lines"][0] }) {
  return (
    <div
      className={cn(
        "flex font-mono text-[11px] leading-5",
        line.type === "add" && "bg-emerald-500/10",
        line.type === "delete" && "bg-red-500/10",
        line.type === "modify" && "bg-amber-500/10",
      )}
    >
      <span className="w-8 shrink-0 select-none border-r border-white/5 px-1 text-right text-zinc-600">
        {line.newLineNumber ?? line.oldLineNumber ?? ""}
      </span>
      <span
        className={cn(
          "w-4 shrink-0 select-none text-center",
          line.type === "add" && "text-emerald-400",
          line.type === "delete" && "text-red-400",
          line.type === "modify" && "text-amber-400",
        )}
      >
        {line.type === "add" ? "+" : line.type === "delete" ? "−" : line.type === "modify" ? "~" : " "}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 whitespace-pre px-2",
          line.type === "add" && "text-emerald-300",
          line.type === "delete" && "text-red-300 line-through opacity-80",
          line.type === "modify" && "text-amber-200",
          line.type === "context" && "text-zinc-400",
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
    <div className="overflow-hidden rounded-lg border border-white/10 bg-surface-1 animate-fade-up">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-white/5"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-zinc-500 transition-transform",
            open && "rotate-90",
          )}
        />
        <GitCompareArrows className="h-3.5 w-3.5 text-accent" />
        <span className="text-[12px] font-medium text-zinc-300">Review changes</span>
        <span className="ml-auto text-[11px] text-zinc-500">
          {files.length} file{files.length !== 1 ? "s" : ""}
          {pendingCount > 0 && ` · ${pendingCount} pending`}
        </span>
      </button>

      {open && (
        <div className="border-t border-white/10">
          <div className="flex items-center gap-1.5 border-b border-white/5 px-2.5 py-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={acceptAll}
              className="h-7 gap-1 px-2 text-[11px] text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
            >
              <Check className="h-3 w-3" />
              Accept all
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={rejectAll}
              className="h-7 gap-1 px-2 text-[11px] text-red-400 hover:bg-red-500/10 hover:text-red-300"
            >
              <X className="h-3 w-3" />
              Reject all
            </Button>
          </div>

          <div className="flex max-h-64">
            <div className="w-[38%] shrink-0 border-r border-white/5">
              <ScrollArea className="h-full max-h-64">
                {files.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => setSelectedPath(file.path)}
                    className={cn(
                      "flex w-full items-start gap-2 border-b border-white/5 px-2.5 py-2 text-left transition-colors hover:bg-white/5",
                      activeFile?.path === file.path && "bg-white/[0.04]",
                      file.status === "accepted" && "opacity-60",
                      file.status === "rejected" && "opacity-40",
                    )}
                  >
                    <FileCode2
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0",
                        LANG_COLORS[file.language] ?? "text-zinc-400",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[11px] text-zinc-200">
                        {file.path.split("/").pop()}
                      </div>
                      <div className="truncate text-[10px] text-zinc-600">{file.path}</div>
                    </div>
                    <span className="flex shrink-0 flex-col items-end font-mono text-[10px]">
                      <span className="text-emerald-400">+{file.additions}</span>
                      <span className="text-red-400">−{file.deletions}</span>
                    </span>
                  </button>
                ))}
              </ScrollArea>
            </div>

            <div className="min-w-0 flex-1">
              {activeFile && (
                <>
                  <div className="flex items-center justify-between border-b border-white/5 px-2.5 py-1.5">
                    <span className="truncate font-mono text-[11px] text-zinc-400">
                      {activeFile.path}
                    </span>
                    {activeFile.status === "pending" && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => accept(activeFile.path)}
                          className="h-6 px-2 text-[10px] text-emerald-400 hover:bg-emerald-500/10"
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => reject(activeFile.path)}
                          className="h-6 px-2 text-[10px] text-red-400 hover:bg-red-500/10"
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                    {activeFile.status === "accepted" && (
                      <span className="text-[10px] text-emerald-400">Accepted</span>
                    )}
                    {activeFile.status === "rejected" && (
                      <span className="text-[10px] text-red-400">Rejected</span>
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
