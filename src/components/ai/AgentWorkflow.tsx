import {
  Brain,
  Check,
  ChevronRight,
  CircleDashed,
  FileCode2,
  FilePenLine,
  FolderSearch,
  GitBranch,
  Loader2,
  Search,
  Terminal,
  X,
} from "@/components/icons/tabler";
import { cn } from "../../lib/utils";
import type { ToolCallCategory, ToolCallRecord } from "../../lib/types";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { Badge } from "../ui/badge";
import { Progress } from "../ui/progress";

const CATEGORY_META: Record<
  ToolCallCategory,
  { icon: React.ComponentType<{ className?: string }>; label: string }
> = {
  thinking: { icon: Brain, label: "Thinking" },
  read: { icon: FileCode2, label: "Reading file" },
  write: { icon: FilePenLine, label: "Writing file" },
  edit: { icon: FilePenLine, label: "Editing file" },
  terminal: { icon: Terminal, label: "Running terminal" },
  search: { icon: Search, label: "Searching workspace" },
  git: { icon: GitBranch, label: "Git operation" },
  generic: { icon: CircleDashed, label: "Tool" },
};

function inferCategory(name: string): ToolCallCategory {
  if (name.includes("think")) return "thinking";
  if (name.includes("read") || name === "write_file") return name.includes("write") ? "write" : "read";
  if (name.includes("edit")) return "edit";
  if (name.includes("run") || name.includes("terminal")) return "terminal";
  if (name.includes("search") || name.includes("grep")) return "search";
  if (name.includes("git")) return "git";
  return "generic";
}

function ToolActionRow({ call }: { call: ToolCallRecord }) {
  const category = call.category ?? inferCategory(call.name);
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;

  return (
    <AccordionItem value={call.id} className="border-white/5">
      <AccordionTrigger className="gap-2 px-3 py-2 hover:bg-[var(--bg-hover)] hover:no-underline [&[data-state=open]>svg.chevron]:rotate-90">
        <div className="flex flex-1 items-center gap-2 text-left">
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
              call.status === "running" && "bg-[var(--bg-hover)] text-[var(--accent-primary)]",
              call.status === "done" && "bg-[var(--success-muted)] text-[var(--success)]",
              call.status === "error" && "bg-[var(--error-muted)] text-[var(--error)]",
            )}
          >
            {call.status === "running" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Icon className="h-3.5 w-3.5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="type-caption font-medium text-[var(--text-secondary)]">{meta.label}</span>
              <span className="truncate type-code text-[var(--text-tertiary)]">{call.name}</span>
            </div>
            <div className="truncate type-caption text-[var(--text-disabled)]">{call.detail}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {call.timestamp && (
              <span className="type-caption tabular-nums text-[var(--text-disabled)]">{call.timestamp}</span>
            )}
            {call.durationMs != null && call.status === "done" && (
              <Badge variant="secondary" className="h-5 px-1.5 type-caption font-normal">
                {(call.durationMs / 1000).toFixed(1)}s
              </Badge>
            )}
            {call.status === "done" && <Check className="h-3 w-3 text-[var(--success)]" />}
            {call.status === "error" && <X className="h-3 w-3 text-[var(--error)]" />}
          </div>
        </div>
        <ChevronRight className="chevron h-3.5 w-3.5 shrink-0 text-[var(--text-disabled)] transition-transform duration-[var(--duration-fast)] ease-[var(--ease-standard)]" />
      </AccordionTrigger>
      <AccordionContent className="px-3 pb-3">
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2.5 type-code leading-relaxed text-[var(--text-secondary)]">
          {call.expandedContent ?? call.detail}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

interface AgentWorkflowProps {
  calls: ToolCallRecord[];
  thinking?: boolean;
}

export function AgentWorkflow({ calls, thinking }: AgentWorkflowProps) {
  const running = calls.some((c) => c.status === "running");
  const done = calls.filter((c) => c.status === "done").length;
  const progress = calls.length ? (done / calls.length) * 100 : 0;

  if (thinking && calls.length === 0) {
    return (
      <div className="animate-fade-in overflow-hidden rounded-lg border border-[var(--border-default)] bg-surface-1">
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--bg-hover)]">
            <Brain className="h-4 w-4 animate-pulse text-[var(--accent-primary)]" />
          </span>
          <div className="flex-1">
            <div className="type-caption font-medium text-[var(--text-secondary)]">Thinking…</div>
            <div className="type-caption text-[var(--text-disabled)]">Planning next steps</div>
          </div>
          <span className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </span>
        </div>
      </div>
    );
  }

  if (calls.length === 0) return null;

  return (
    <div className="animate-fade-up overflow-hidden rounded-lg border border-[var(--border-default)] bg-surface-1">
      <div className="border-b border-[var(--border-subtle)] px-3 py-2">
        <div className="flex items-center gap-2">
          <FolderSearch className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
          <span className="type-caption font-medium text-[var(--text-secondary)]">
            {running ? "Agent is working…" : "Completed actions"}
          </span>
          <span className="ml-auto type-caption tabular-nums text-[var(--text-tertiary)]">
            {done}/{calls.length}
          </span>
        </div>
        {running && (
          <Progress value={progress} className="mt-2 h-1 bg-surface-3" />
        )}
      </div>
      <Accordion type="multiple" defaultValue={calls.map((c) => c.id)} className="divide-y divide-white/5">
        {calls.map((call) => (
          <ToolActionRow key={call.id} call={call} />
        ))}
      </Accordion>
    </div>
  );
}

export function ThinkingIndicator({
  label = "Working",
}: {
  label?: string;
}) {
  return (
    <div className="flex items-center gap-1 type-caption text-[var(--text-tertiary)] animate-cursor-fade">
      <span>{label}</span>
      <ChevronRight className="h-3 w-3" strokeWidth={2} />
    </div>
  );
}
