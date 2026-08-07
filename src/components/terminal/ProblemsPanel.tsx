import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkbenchEmptyState } from "@/components/ui/WorkbenchEmptyState";
import { MOCK_PROBLEMS } from "./mock-data";
import type { ProblemSeverity } from "./types";

const SEVERITY_META: Record<
  ProblemSeverity,
  { icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  error: { icon: AlertCircle, color: "text-error" },
  warning: { icon: AlertTriangle, color: "text-warning" },
  info: { icon: Info, color: "text-info" },
};

export function ProblemsPanel() {
  const problems = MOCK_PROBLEMS;
  const errors = problems.filter((p) => p.severity === "error").length;
  const warnings = problems.filter((p) => p.severity === "warning").length;

  if (problems.length === 0) {
    return (
      <WorkbenchEmptyState
        icon={CheckCircle2}
        title="No problems detected"
        description="Errors and warnings from the language service will appear here."
        compact
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-7 shrink-0 items-center gap-3 border-b border-border px-2.5 text-[11px] text-muted-foreground">
        <span>
          <span className="text-error">{errors}</span> errors
        </span>
        <span>
          <span className="text-warning">{warnings}</span> warnings
        </span>
      </div>
      <ScrollArea className="flex-1">
        <table className="w-full text-left text-[12px]" role="grid" aria-label="Problems">
          <thead className="sticky top-0 bg-surface-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-1.5" scope="col" />
              <th className="px-2 py-1.5" scope="col">
                Message
              </th>
              <th className="px-2 py-1.5" scope="col">
                File
              </th>
              <th className="w-16 px-2 py-1.5" scope="col">
                Line
              </th>
              <th className="w-24 px-2 py-1.5" scope="col">
                Source
              </th>
            </tr>
          </thead>
          <tbody>
            {problems.map((problem) => {
              const meta = SEVERITY_META[problem.severity];
              const Icon = meta.icon;
              return (
                <tr
                  key={problem.id}
                  className="border-b border-border transition-colors duration-150 hover:bg-secondary"
                  tabIndex={0}
                  role="row"
                >
                  <td className="px-2 py-1.5">
                    <Icon
                      className={cn("h-3.5 w-3.5", meta.color)}
                      aria-label={problem.severity}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-foreground/90">
                    {problem.message}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                    {problem.file}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                    {problem.line}:{problem.column}
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground/80">
                    {problem.source}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}
