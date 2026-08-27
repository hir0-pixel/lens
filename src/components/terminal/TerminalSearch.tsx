import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, X } from "@/components/icons/tabler";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTerminalStore } from "@/stores/terminalStore";
import { getActiveTerminal } from "@/components/terminal/utils/terminalRegistry";

export function TerminalSearch() {
  const search = useTerminalStore((s) => s.search);
  const setSearch = useTerminalStore((s) => s.setSearch);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (search.open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [search.open]);

  if (!search.open) return null;

  function runFind(direction: "next" | "prev") {
    const handle = getActiveTerminal(activeSessionId);
    if (!handle || !search.query) return;
    const opts = { caseSensitive: search.caseSensitive, regex: search.regex };
    if (direction === "next") handle.findNext(search.query, opts);
    else handle.findPrevious(search.query, opts);
  }

  return (
    <div
      className="flex items-center gap-1 border-b border-white/5 bg-surface-2 px-2 py-1"
      role="search"
      aria-label="Terminal search"
    >
      <Input
        ref={inputRef}
        value={search.query}
        onChange={(e) => setSearch({ query: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter") runFind(e.shiftKey ? "prev" : "next");
          if (e.key === "Escape") setSearch({ open: false, query: "" });
        }}
        placeholder="Find in terminal…"
        className="h-7 flex-1 border-white/10 bg-surface-1 type-caption"
        aria-label="Search query"
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => runFind("prev")}
        aria-label="Find previous"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => runFind("next")}
        aria-label="Find next"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => setSearch({ open: false, query: "" })}
        aria-label="Close search"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
