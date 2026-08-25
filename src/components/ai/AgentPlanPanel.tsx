import { useEffect, useState } from "react";
import { Check, ChevronDown, Circle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type PlanStepStatus = "done" | "in_progress" | "pending";

export interface PlanStep {
  id: string;
  label: string;
  status: PlanStepStatus;
}

interface AgentPlanPanelProps {
  steps: PlanStep[];
  /** Force open while agent is working */
  forceOpen?: boolean;
}

/**
 * Collapsible agent plan checklist — above the transcript.
 */
export function AgentPlanPanel({ steps, forceOpen }: AgentPlanPanelProps) {
  const allDone = steps.length > 0 && steps.every((s) => s.status === "done");
  const [open, setOpen] = useState(!allDone);

  useEffect(() => {
    if (forceOpen || !allDone) setOpen((v) => (v ? v : true));
    else setOpen((v) => (v ? false : v));
  }, [allDone, forceOpen, steps.length]);

  if (steps.length === 0) return null;

  const doneCount = steps.filter((s) => s.status === "done").length;

  return (
    <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-full items-center gap-2 px-3 text-left transition-colors duration-[var(--duration-instant)] hover:bg-[var(--bg-hover)]"
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-[var(--text-tertiary)] transition-transform duration-[var(--duration-fast)]",
            !open && "-rotate-90",
          )}
          strokeWidth={1.75}
        />
        <span className="type-caption-uppercase text-[var(--text-tertiary)]">
          Plan
        </span>
        <span className="type-caption tabular-nums text-[var(--text-tertiary)]">
          {doneCount}/{steps.length}
        </span>
      </button>

      {open && (
        <ul className="space-y-0.5 px-3 pb-2 animate-cursor-fade">
          {steps.map((step, i) => (
            <li
              key={step.id}
              className="flex items-start gap-2 rounded-[var(--radius-sm)] px-1 py-1 type-caption leading-[18px]"
            >
              <StepIcon status={step.status} />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  step.status === "done" && "text-[var(--text-tertiary)] line-through",
                  step.status === "in_progress" && "text-[var(--text-primary)]",
                  step.status === "pending" && "text-[var(--text-secondary)]",
                )}
                title={step.label}
              >
                <span className="tabular-nums text-[var(--text-tertiary)]">
                  {i + 1}.{" "}
                </span>
                {step.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StepIcon({ status }: { status: PlanStepStatus }) {
  if (status === "done") {
    return (
      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[var(--success)] text-[var(--text-on-accent)]">
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <Loader2
        className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-[var(--accent-primary)]"
        strokeWidth={2}
      />
    );
  }
  return (
    <Circle
      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]"
      strokeWidth={1.5}
    />
  );
}
