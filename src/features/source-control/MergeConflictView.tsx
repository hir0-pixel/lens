import { ArrowLeftRight, Check, GitMerge, X } from "@/components/icons/tabler";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useGitStore } from "@/stores/gitStore";
import { cn } from "@/lib/utils";

export function MergeConflictView() {
  const conflicts = useGitStore((s) => s.conflicts);
  const resolveConflict = useGitStore((s) => s.resolveConflict);
  const setShowConflicts = useGitStore((s) => s.setShowConflicts);
  const unresolved = conflicts.filter((c) => !c.resolved);

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-[var(--border-subtle)] bg-surface-0">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-surface-1 px-2">
        <GitMerge className="h-3.5 w-3.5 text-[var(--error)]" />
        <span className="type-caption font-medium text-[var(--text-primary)]">Merge Conflicts</span>
        <Badge variant="secondary" className="h-4 px-1.5 type-caption">
          {unresolved.length} remaining
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-6 w-6"
          onClick={() => setShowConflicts(false)}
          aria-label="Close conflicts"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-2">
          {conflicts.map((conflict, index) => (
            <div
              key={conflict.id}
              className={cn(
                "overflow-hidden rounded-lg border border-[var(--border-default)]",
                conflict.resolved && "opacity-60",
              )}
            >
              <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-surface-1 px-2.5 py-1.5">
                <span className="type-code text-[var(--text-secondary)]">{conflict.path}</span>
                <span className="type-caption text-[var(--text-tertiary)]">
                  {index + 1}/{conflicts.length}
                </span>
                {conflict.resolved && (
                  <Badge className="ml-auto h-4 bg-[var(--success-muted)] type-caption text-[var(--success)]">
                    Resolved ({conflict.resolved})
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 divide-x divide-white/5">
                <div>
                  <div className="bg-[var(--bg-hover)] px-2 py-1 type-caption font-medium text-[var(--info)]">
                    Current · {conflict.currentLabel}
                  </div>
                  <pre className="whitespace-pre-wrap p-2 type-code leading-relaxed text-[var(--text-secondary)]">
                    {conflict.currentContent}
                  </pre>
                </div>
                <div>
                  <div className="bg-[var(--success-muted)] px-2 py-1 type-caption font-medium text-[var(--success)]">
                    Incoming · {conflict.incomingLabel}
                  </div>
                  <pre className="whitespace-pre-wrap p-2 type-code leading-relaxed text-[var(--text-secondary)]">
                    {conflict.incomingContent}
                  </pre>
                </div>
              </div>

              {!conflict.resolved && (
                <div className="flex flex-wrap gap-1 border-t border-[var(--border-subtle)] bg-surface-1 p-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 gap-1 type-caption"
                    onClick={() => resolveConflict(conflict.id, "current")}
                  >
                    <Check className="h-3 w-3" />
                    Accept Current
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 gap-1 type-caption"
                    onClick={() => resolveConflict(conflict.id, "incoming")}
                  >
                    <Check className="h-3 w-3" />
                    Accept Incoming
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 gap-1 type-caption"
                    onClick={() => resolveConflict(conflict.id, "both")}
                  >
                    <ArrowLeftRight className="h-3 w-3" />
                    Accept Both
                  </Button>
                </div>
              )}
            </div>
          ))}

          {conflicts.length === 0 && (
            <div className="py-10 text-center type-caption text-[var(--text-tertiary)]">
              No merge conflicts
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
