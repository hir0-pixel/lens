import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Regex,
  Replace,
  Search,
  WholeWord,
  X,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  searchWorkspace,
  type SearchFileGroup,
  type SearchOptions,
} from "@/shared/search/searchService";
import { useCommandStore } from "@/features/command-palette/commandStore";

function MatchLine({
  text,
  matchStart,
  matchLength,
  line,
  onOpen,
}: {
  text: string;
  matchStart: number;
  matchLength: number;
  line: number;
  onOpen: () => void;
}) {
  const before = text.slice(0, matchStart);
  const match = text.slice(matchStart, matchStart + matchLength);
  const after = text.slice(matchStart + matchLength);

  return (
    <button
      onClick={onOpen}
      className="flex w-full items-start gap-2 rounded-sm px-2 py-0.5 text-left font-mono text-[12px] hover:bg-white/5"
    >
      <span className="w-8 shrink-0 select-none text-right tabular-nums text-zinc-600">
        {line}
      </span>
      <span className="min-w-0 flex-1 truncate text-zinc-400">
        {before}
        <span className="rounded-sm bg-accent/30 text-accent-200">{match}</span>
        {after}
      </span>
    </button>
  );
}

function FileGroup({
  group,
  defaultOpen = true,
}: {
  group: SearchFileGroup;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[12px] hover:bg-white/[0.03]">
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
        )}
        <FileCode2 className="h-3.5 w-3.5 text-sky-400" />
        <span className="truncate font-medium text-zinc-200">
          {group.file.split("/").pop()}
        </span>
        <span className="truncate font-mono text-[11px] text-zinc-600">{group.file}</span>
        <span className="ml-auto shrink-0 rounded-full bg-white/5 px-1.5 text-[10px] tabular-nums text-zinc-500">
          {group.matches.length}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-l border-white/5 ml-4 mb-1">
          {group.matches.map((m, i) => (
            <MatchLine
              key={`${m.line}-${m.column}-${i}`}
              text={m.text}
              matchStart={m.matchStart}
              matchLength={m.matchLength}
              line={m.line}
              onOpen={() =>
                window.dispatchEvent(
                  new CustomEvent("orchids:open-file", {
                    detail: { path: m.file, line: m.line },
                  }),
                )
              }
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function GlobalSearchPanel() {
  const overlay = useCommandStore((s) => s.overlay);
  const close = useCommandStore((s) => s.close);
  const pushSearchHistory = useCommandStore((s) => s.pushSearchHistory);
  const searchHistory = useCommandStore((s) => s.searchHistory);
  const initialQuery = useCommandStore((s) => s.query);

  const [query, setQuery] = useState("");
  const [replace, setReplace] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("**/node_modules/**,**/dist/**");
  const [results, setResults] = useState<SearchFileGroup[]>([]);
  const [pending, startTransition] = useTransition();
  const [replaceCount, setReplaceCount] = useState(0);

  const open = overlay === "search";

  useEffect(() => {
    if (open) {
      setQuery(initialQuery || "");
    }
  }, [open, initialQuery]);

  const options: SearchOptions = useMemo(
    () => ({
      query,
      caseSensitive,
      wholeWord,
      regex: useRegex,
      include: include || undefined,
      exclude: exclude || undefined,
    }),
    [query, caseSensitive, wholeWord, useRegex, include, exclude],
  );

  const runSearch = useCallback(
    (opts: SearchOptions) => {
      startTransition(() => {
        const groups = searchWorkspace(opts);
        setResults(groups);
        if (opts.query.trim()) pushSearchHistory(opts.query.trim());
      });
    },
    [pushSearchHistory],
  );

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => runSearch(options), 180);
    return () => window.clearTimeout(handle);
  }, [options, open, runSearch]);

  const totalMatches = results.reduce((n, g) => n + g.matches.length, 0);

  function handleReplaceAll() {
    if (!query.trim()) return;
    setReplaceCount(totalMatches);
    // Mock replace — dispatches event for future editor integration
    window.dispatchEvent(
      new CustomEvent("orchids:replace-all", {
        detail: { query, replace, options },
      }),
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent
        className={cn(
          "top-[8%] flex h-[min(720px,80vh)] w-full translate-y-0 flex-col gap-0 overflow-hidden border-white/10 bg-surface-1 p-0 shadow-float-pop",
          "sm:max-w-[720px]",
          "[&>button]:hidden",
        )}
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Search in workspace</DialogTitle>

        <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
          <div className="flex items-center gap-2 text-[13px] font-medium text-zinc-200">
            <Search className="h-4 w-4 text-accent" />
            Search
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={close}
            aria-label="Close search"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2 border-b border-white/5 p-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                className="h-9 border-white/10 bg-surface-2 pr-24 text-[13px]"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") runSearch(options);
                }}
                aria-label="Search query"
              />
              <div className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5">
                <ToggleIcon
                  active={caseSensitive}
                  onClick={() => setCaseSensitive((v) => !v)}
                  label="Match Case"
                >
                  <CaseSensitive className="h-3.5 w-3.5" />
                </ToggleIcon>
                <ToggleIcon
                  active={wholeWord}
                  onClick={() => setWholeWord((v) => !v)}
                  label="Match Whole Word"
                >
                  <WholeWord className="h-3.5 w-3.5" />
                </ToggleIcon>
                <ToggleIcon
                  active={useRegex}
                  onClick={() => setUseRegex((v) => !v)}
                  label="Use Regular Expression"
                >
                  <Regex className="h-3.5 w-3.5" />
                </ToggleIcon>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-9 w-9", showReplace && "bg-white/10")}
              onClick={() => setShowReplace((v) => !v)}
              aria-label="Toggle replace"
            >
              <Replace className="h-4 w-4" />
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Search history">
                  <History className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-1">
                {searchHistory.length === 0 ? (
                  <div className="px-2 py-3 text-center text-[12px] text-zinc-600">
                    No recent searches
                  </div>
                ) : (
                  searchHistory.map((q) => (
                    <button
                      key={q}
                      onClick={() => setQuery(q)}
                      className="flex w-full rounded-md px-2 py-1.5 text-left text-[12px] text-zinc-300 hover:bg-white/5"
                    >
                      {q}
                    </button>
                  ))
                )}
              </PopoverContent>
            </Popover>
          </div>

          {showReplace && (
            <div className="flex gap-2">
              <Input
                value={replace}
                onChange={(e) => setReplace(e.target.value)}
                placeholder="Replace"
                className="h-9 flex-1 border-white/10 bg-surface-2 text-[13px]"
                aria-label="Replace with"
              />
              <Button
                size="sm"
                variant="secondary"
                className="h-9"
                onClick={handleReplaceAll}
                disabled={!query.trim() || totalMatches === 0}
              >
                Replace All
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="mb-1 text-[10px] uppercase tracking-wide text-zinc-600">
                files to include
              </Label>
              <Input
                value={include}
                onChange={(e) => setInclude(e.target.value)}
                placeholder="e.g. src/**/*.tsx"
                className="h-8 border-white/10 bg-surface-2 font-mono text-[11px]"
              />
            </div>
            <div>
              <Label className="mb-1 text-[10px] uppercase tracking-wide text-zinc-600">
                files to exclude
              </Label>
              <Input
                value={exclude}
                onChange={(e) => setExclude(e.target.value)}
                placeholder="e.g. **/node_modules/**"
                className="h-8 border-white/10 bg-surface-2 font-mono text-[11px]"
              />
            </div>
          </div>
        </div>

        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-white/5 px-3 text-[11px] text-zinc-500">
          {pending ? (
            <span className="animate-pulse">Searching…</span>
          ) : query.trim() ? (
            <span>
              {totalMatches} result{totalMatches !== 1 ? "s" : ""} in {results.length} file
              {results.length !== 1 ? "s" : ""}
            </span>
          ) : (
            <span>Type to search the workspace</span>
          )}
          {replaceCount > 0 && (
            <span className="text-emerald-400">Replaced {replaceCount} occurrence(s)</span>
          )}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-1" role="tree" aria-label="Search results">
            {results.map((group) => (
              <FileGroup key={group.file} group={group} />
            ))}
            {!pending && query.trim() && results.length === 0 && (
              <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">
                No results found for &ldquo;{query}&rdquo;
              </div>
            )}
            {!pending && !query.trim() && (
              <div className="px-4 py-12 text-center">
                <p className="text-[13px] text-foreground/80">Search the workspace</p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Use match options below · <kbd className="wb-kbd">Enter</kbd> to search
                </p>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="flex items-center gap-3 border-t border-white/5 px-3 py-1.5 text-[10px] text-zinc-600">
          <label className="flex items-center gap-1.5">
            <Checkbox
              checked={caseSensitive}
              onCheckedChange={(v) => setCaseSensitive(v === true)}
              className="h-3.5 w-3.5"
            />
            Case
          </label>
          <label className="flex items-center gap-1.5">
            <Checkbox
              checked={wholeWord}
              onCheckedChange={(v) => setWholeWord(v === true)}
              className="h-3.5 w-3.5"
            />
            Word
          </label>
          <label className="flex items-center gap-1.5">
            <Checkbox
              checked={useRegex}
              onCheckedChange={(v) => setUseRegex(v === true)}
              className="h-3.5 w-3.5"
            />
            Regex
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ToggleIcon({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:bg-white/10 hover:text-zinc-200",
        active && "bg-accent/15 text-accent",
      )}
    >
      {children}
    </button>
  );
}
