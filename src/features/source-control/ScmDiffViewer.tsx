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
          line.type === "add" && "bg-emerald-500/10",
          line.type === "delete" && "bg-red-500/10",
          line.type === "modify" && "bg-amber-500/10",
        )}
      >
        <span className="w-8 shrink-0 select-none border-r border-white/5 px-1 text-right text-zinc-600">
          {line.oldLineNumber ?? ""}
        </span>
        <span className="w-8 shrink-0 select-none border-r border-white/5 px-1 text-right text-zinc-600">
          {line.newLineNumber ?? ""}
        </span>
        <span
          className={cn(
            "w-4 shrink-0 select-none text-center",
            line.type === "add" && "text-emerald-400",
            line.type === "delete" && "text-red-400",
            line.type === "modify" && "text-amber-400",
          )}
        >
          {line.type === "add" ? "+" : line.type === "delete" ? "−" : " "}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 whitespace-pre-wrap break-all px-2",
            line.type === "add" && "text-emerald-300",
            line.type === "delete" && "text-red-300 line-through opacity-80",
            line.type === "context" && "text-zinc-400",
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
        <div key={idx} className="grid grid-cols-2 border-b border-white/[0.03]">
          <div
            className={cn(
              "flex font-mono text-[11px] leading-5",
              row.left?.type === "delete" && "bg-red-500/10",
              row.left?.type === "modify" && "bg-amber-500/10",
            )}
          >
            <span className="w-8 shrink-0 select-none border-r border-white/5 px-1 text-right text-zinc-600">
              {row.left?.oldLineNumber ?? ""}
            </span>
            <span className="w-4 shrink-0 text-center text-red-400">
              {row.left?.type === "delete" ? "−" : " "}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 whitespace-pre-wrap break-all px-1",
                row.left?.type === "delete" && "text-red-300",
                (!row.left || row.left.type === "context") && "text-zinc-500",
              )}
            >
              {row.left?.content ?? ""}
            </span>
          </div>
          <div
            className={cn(
              "flex border-l border-white/5 font-mono text-[11px] leading-5",
              row.right?.type === "add" && "bg-emerald-500/10",
              row.right?.type === "modify" && "bg-amber-500/10",
            )}
          >
            <span className="w-8 shrink-0 select-none border-r border-white/5 px-1 text-right text-zinc-600">
              {row.right?.newLineNumber ?? ""}
            </span>
            <span className="w-4 shrink-0 text-center text-emerald-400">
              {row.right?.type === "add" ? "+" : " "}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 whitespace-pre-wrap break-all px-1",
                row.right?.type === "add" && "text-emerald-300",
                (!row.right || row.right.type === "context") && "text-zinc-500",
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
        className="w-full bg-white/[0.02] py-1 text-center font-mono text-[10px] text-zinc-600 hover:bg-white/5 hover:text-zinc-400"
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
        className="w-full py-0.5 text-center text-[10px] text-zinc-600 hover:text-zinc-400"
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
    <div className="flex h-full min-h-0 flex-col border-t border-white/5 bg-surface-0">
      <div className="sticky top-0 z-10 flex h-8 shrink-0 items-center gap-2 border-b border-white/5 bg-surface-1 px-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300">
          {fallback.path}
        </span>
        <span className="font-mono text-[10px] text-emerald-400">+{fallback.additions}</span>
        <span className="font-mono text-[10px] text-red-400">−{fallback.deletions}</span>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-6 w-6", diffMode === "side-by-side" && "bg-white/10")}
          onClick={() => setDiffMode("side-by-side")}
          aria-label="Side by side"
        >
          <Columns2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-6 w-6", diffMode === "inline" && "bg-white/10")}
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
            <div className="sticky top-0 z-[1] bg-sky-500/10 px-2 py-0.5 font-mono text-[10px] text-sky-400">
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
