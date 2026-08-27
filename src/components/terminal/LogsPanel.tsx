import { FileText } from "@/components/icons/tabler";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkbenchEmptyState } from "@/components/ui/WorkbenchEmptyState";
import { MOCK_LOGS } from "./mock-data";

const LEVEL_COLORS = {
  info: "text-info",
  warn: "text-warning",
  error: "text-error",
  debug: "text-muted-foreground",
};

export function LogsPanel() {
  if (MOCK_LOGS.length === 0) {
    return (
      <WorkbenchEmptyState
        icon={FileText}
        title="No logs yet"
        description="Application and extension logs will stream here."
        compact
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-7 shrink-0 items-center border-b border-border px-2.5 type-caption text-muted-foreground">
        Application logs
      </div>
      <ScrollArea className="flex-1">
        <div className="p-1" role="log" aria-label="Application logs">
          {MOCK_LOGS.map((entry) => (
            <div
              key={entry.id}
              className="flex gap-2 border-b border-border/50 px-2 py-1 type-code transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)] hover:bg-secondary"
            >
              <span className="shrink-0 tabular-nums text-muted-foreground/70">
                {entry.timestamp}
              </span>
              <span
                className={cn("w-10 shrink-0 uppercase", LEVEL_COLORS[entry.level])}
              >
                {entry.level}
              </span>
              <span className="w-20 shrink-0 text-muted-foreground">
                {entry.source}
              </span>
              <span className="min-w-0 text-foreground/80">{entry.message}</span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
