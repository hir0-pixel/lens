import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useGitStore } from "@/stores/gitStore";
import { cn } from "@/lib/utils";

export function CommitHistory() {
  const commits = useGitStore((s) => s.commits);
  const setShowHistory = useGitStore((s) => s.setShowHistory);
  const [query, setQuery] = useState("");
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return commits.filter((c) => {
      if (authorFilter && c.author !== authorFilter) return false;
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        c.message.toLowerCase().includes(q) ||
        c.shortHash.includes(q) ||
        c.author.toLowerCase().includes(q)
      );
    });
  }, [commits, query, authorFilter]);

  const authors = useMemo(
    () => Array.from(new Set(commits.map((c) => c.author))),
    [commits],
  );

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-white/5 bg-surface-0">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-white/5 bg-surface-1 px-2">
        <span className="text-[12px] font-medium text-zinc-200">History</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-6 w-6"
          onClick={() => setShowHistory(false)}
          aria-label="Close history"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="border-b border-white/5 p-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commits…"
            className="h-8 border-white/10 bg-surface-2 pl-7 text-[12px]"
            aria-label="Search commits"
          />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setAuthorFilter(null)}
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px]",
              !authorFilter ? "bg-accent/20 text-accent" : "bg-white/5 text-zinc-500",
            )}
          >
            All
          </button>
          {authors.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAuthorFilter(a)}
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px]",
                authorFilter === a ? "bg-accent/20 text-accent" : "bg-white/5 text-zinc-500",
              )}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-1">
          {filtered.map((commit) => (
            <Collapsible key={commit.id}>
              <CollapsibleTrigger className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-white/[0.04]">
                <Avatar className="mt-0.5 h-6 w-6">
                  <AvatarFallback
                    className="text-[10px] font-semibold text-surface-0"
                    style={{ backgroundColor: commit.avatarColor }}
                  >
                    {commit.author.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] text-zinc-200">{commit.message}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-600">
                    <span className="font-mono text-zinc-500">{commit.shortHash}</span>
                    <span>{commit.author}</span>
                    <span>·</span>
                    <span>{commit.relativeTime}</span>
                    {commit.refs?.map((ref: string) => (
                      <span
                        key={ref}
                        className="rounded bg-accent/15 px-1 text-[9px] text-accent"
                      >
                        {ref}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="shrink-0 text-right font-mono text-[10px]">
                  <div className="text-emerald-400">+{commit.additions}</div>
                  <div className="text-red-400">−{commit.deletions}</div>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="ml-10 mb-2 rounded-md border border-white/5 bg-surface-1 p-2 text-[11px] text-zinc-400">
                  {commit.description && (
                    <p className="mb-2 whitespace-pre-wrap">{commit.description}</p>
                  )}
                  <div className="flex gap-3 text-[10px] text-zinc-600">
                    <span>{commit.filesChanged} files</span>
                    <span className="font-mono">{commit.hash.slice(0, 16)}…</span>
                    <span>{commit.email}</span>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
          {filtered.length === 0 && (
            <div className="py-8 text-center text-[12px] text-zinc-600">No commits found</div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
