import { memo, useMemo, useState } from "react";
import { Columns2, Rows2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useGitStore } from "@/stores/gitStore";
import type { DiffLine, GitFileDiff } from "./types";

function DiffLineRow({
  line,
  mode,
}: {
  line: DiffLine;
  mode: "side-by-side" | "inline";
}) {
  if (mode === "inline") {
    return (
      <div
        className={cn(
          "flex font-mono text-[11px] leading-5",
          line.type === "add" && "bg-[var(--success-muted)]",
          line.type === "delete" && "bg-[var(--error-muted)]",
          line.type === "modify" && "bg-[var(--bg-hover)]",
        )}
      >
        <span className="w-8 shrink-0 select-none border-r border-[var(--border-subtle)] px-1 text-right text-[var(--text-tertiary)]">
          {line.oldLineNumber ?? ""}
        </span>
        <span className="w-8 shrink-0 select-none border-r border-[var(--border-subtle)] px-1 text-right text-[var(--text-tertiary)]">
          {line.newLineNumber ?? ""}
        </span>
        <span
          className={cn(
            "w-4 shrink-0 select-none text-center",
            line.type === "add" && "text-[var(--success)]",
            line.type === "delete" && "text-[var(--error)]",
            line.type === "modify" && "text-[var(--warning)]",
          )}
        >
          {line.type === "add" ? "+" : line.type === "delete" ? "−" : " "}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 whitespace-pre-wrap break-all px-2",
            line.type === "add" && "text-[var(--success)]",
            line.type === "delete" && "text-[var(--error)] line-through opacity-80",
            line.type === "context" && "text-[var(--text-secondary)]",
          )}
        >
          {line.content || " "}
        </span>
      </div>
    );
  }

  // Side-by-side: render as single row spanning both conceptually via paired columns in parent
  return null;
}

function SideBySideHunk({ lines }: { lines: DiffLine[] }) {
  const rows = useMemo(() => {
    const result: Array<{ left?: DiffLine; right?: DiffLine }> = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.type === "context" || line.type === "modify") {
        result.push({ left: line, right: line });
        i++;
      } else if (line.type === "delete") {
        const next = lines[i + 1];
        if (next?.type === "add") {
          result.push({ left: line, right: next });
          i += 2;
        } else {
          result.push({ left: line });
          i++;
        }
      } else if (line.type === "add") {
        result.push({ right: line });
        i++;
      } else {
        i++;
      }
    }
    return result;
  }, [lines]);

  return (
    <>
      {rows.map((row, idx) => (
        <div key={idx} className="grid grid-cols-2 border-b border-[var(--border-subtle)]">
          <div
            className={cn(
              "flex font-mono text-[11px] leading-5",
              row.left?.type === "delete" && "bg-[var(--error-muted)]",
              row.left?.type === "modify" && "bg-[var(--bg-hover)]",
            )}
          >
            <span className="w-8 shrink-0 select-none border-r border-[var(--border-subtle)] px-1 text-right text-[var(--text-tertiary)]">
              {row.left?.oldLineNumber ?? ""}
            </span>
            <span className="w-4 shrink-0 text-center text-[var(--error)]">
              {row.left?.type === "delete" ? "−" : " "}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 whitespace-pre-wrap break-all px-1",
                row.left?.type === "delete" && "text-[var(--error)]",
                (!row.left || row.left.type === "context") && "text-[var(--text-tertiary)]",
              )}
            >
              {row.left?.content ?? ""}
            </span>
          </div>
          <div
            className={cn(
              "flex border-l border-[var(--border-subtle)] font-mono text-[11px] leading-5",
              row.right?.type === "add" && "bg-[var(--success-muted)]",
              row.right?.type === "modify" && "bg-[var(--bg-hover)]",
            )}
          >
            <span className="w-8 shrink-0 select-none border-r border-[var(--border-subtle)] px-1 text-right text-[var(--text-tertiary)]">
              {row.right?.newLineNumber ?? ""}
            </span>
            <span className="w-4 shrink-0 text-center text-[var(--success)]">
              {row.right?.type === "add" ? "+" : " "}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 whitespace-pre-wrap break-all px-1",
                row.right?.type === "add" && "text-[var(--success)]",
                (!row.right || row.right.type === "context") && "text-[var(--text-tertiary)]",
              )}
            >
              {row.right?.content ?? ""}
            </span>
          </div>
        </div>
      ))}
    </>
  );
}

function CollapsibleContext({ lines }: { lines: DiffLine[] }) {
  const [expanded, setExpanded] = useState(false);
  if (lines.length <= 4) {
    return (
      <>
        {lines.map((line, i) => (
          <DiffLineRow key={i} line={line} mode="inline" />
        ))}
      </>
    );
  }
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="w-full bg-surface-0/40 py-1 text-center font-mono text-[10px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
      >
        ··· {lines.length} unchanged lines ···
      </button>
    );
  }
  return (
    <>
      {lines.map((line, i) => (
        <DiffLineRow key={i} line={line} mode="inline" />
      ))}
      <button
        type="button"
        onClick={() => setExpanded(false)}
        className="w-full py-0.5 text-center text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
      >
        Collapse
      </button>
    </>
  );
}

function ScmDiffViewerComponent() {
  const path = useGitStore((s) => s.selectedDiffPath);
  const diffMode = useGitStore((s) => s.diffMode);
  const setDiffMode = useGitStore((s) => s.setDiffMode);
  const selectDiff = useGitStore((s) => s.selectDiff);
  const getDiff = useGitStore((s) => s.getDiff);
  const changes = useGitStore((s) => s.changes);

  const diff: GitFileDiff | null = path ? getDiff(path) : null;

  if (!path) return null;

  const fallback: GitFileDiff = diff ?? {
    path,
    language: "tsx",
    status: "modified",
    additions: changes.find((c) => c.path === path)?.additions ?? 0,
    deletions: changes.find((c) => c.path === path)?.deletions ?? 0,
    hunks: [
      {
        header: "@@ mock diff @@",
        lines: [
          { type: "context", content: `// Diff preview for ${path}`, oldLineNumber: 1, newLineNumber: 1 },
          { type: "delete", content: "// previous version", oldLineNumber: 2 },
          { type: "add", content: "// updated version", newLineNumber: 2 },
        ],
      },
    ],
  };

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-[var(--border-subtle)] bg-surface-0">
      <div className="sticky top-0 z-10 flex h-8 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-surface-1 px-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-secondary)]">
          {fallback.path}
        </span>
        <span className="font-mono text-[10px] text-[var(--success)]">+{fallback.additions}</span>
        <span className="font-mono text-[10px] text-[var(--error)]">−{fallback.deletions}</span>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-6 w-6", diffMode === "side-by-side" && "bg-[var(--bg-hover)]")}
          onClick={() => setDiffMode("side-by-side")}
          aria-label="Side by side"
        >
          <Columns2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-6 w-6", diffMode === "inline" && "bg-[var(--bg-hover)]")}
          onClick={() => setDiffMode("inline")}
          aria-label="Inline diff"
        >
          <Rows2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => selectDiff(null)}
          aria-label="Close diff"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {fallback.hunks.map((hunk, hi) => (
          <div key={hi} className="mb-2">
            <div className="sticky top-0 z-[1] bg-[var(--bg-hover)] px-2 py-0.5 font-mono text-[10px] text-[var(--info)]">
              {hunk.header}
            </div>
            {diffMode === "side-by-side" ? (
              <SideBySideHunk lines={hunk.lines} />
            ) : (
              (() => {
                const chunks: Array<{ kind: "ctx" | "chg"; lines: DiffLine[] }> = [];
                let buf: DiffLine[] = [];
                let kind: "ctx" | "chg" = "ctx";
                for (const line of hunk.lines) {
                  const k = line.type === "context" ? "ctx" : "chg";
                  if (k !== kind && buf.length) {
                    chunks.push({ kind, lines: buf });
                    buf = [];
                  }
                  kind = k;
                  buf.push(line);
                }
                if (buf.length) chunks.push({ kind, lines: buf });
                return chunks.map((chunk, ci) =>
                  chunk.kind === "ctx" ? (
                    <CollapsibleContext key={ci} lines={chunk.lines} />
                  ) : (
                    <div key={ci}>
                      {chunk.lines.map((line, li) => (
                        <DiffLineRow key={li} line={line} mode="inline" />
                      ))}
                    </div>
                  ),
                );
              })()
            )}
          </div>
        ))}
      </ScrollArea>
    </div>
  );
}

export const ScmDiffViewer = memo(ScmDiffViewerComponent);
