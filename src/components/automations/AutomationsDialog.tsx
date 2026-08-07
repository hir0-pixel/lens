import { useState } from "react";
import { Plus, Trash2, Workflow } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { useAutomationStore } from "@/stores/automationStore";

interface AutomationsDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Real Automations CRUD — empty state when none, list + create/edit/delete.
 */
export default function AutomationsDialog({
  open,
  onClose,
}: AutomationsDialogProps) {
  const items = useAutomationStore((s) => s.items);
  const add = useAutomationStore((s) => s.add);
  const remove = useAutomationStore((s) => s.remove);
  const toggle = useAutomationStore((s) => s.toggle);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("");
  const [prompt, setPrompt] = useState("");

  function resetForm() {
    setCreating(false);
    setName("");
    setTrigger("");
    setPrompt("");
  }

  function submitCreate() {
    if (!name.trim() && !prompt.trim()) return;
    add({
      name: name.trim() || "Untitled automation",
      trigger: trigger.trim() || "Manual",
      prompt: prompt.trim(),
    });
    resetForm();
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        resetForm();
        onClose();
      }}
      title="Automations"
      subtitle="Recurring prompts and triggers"
      size="md"
    >
      <div className="flex flex-col gap-3 p-1">
        {!creating ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="btn-primary inline-flex h-9 w-full items-center justify-center gap-2 text-[13px]"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            New Automation
          </button>
        ) : (
          <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-canvas)] px-2 text-[13px] text-[var(--text-primary)]"
              autoFocus
            />
            <input
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              placeholder="Trigger (e.g. On save, Daily 2am)"
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-canvas)] px-2 text-[13px] text-[var(--text-primary)]"
            />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Prompt the agent should run…"
              rows={3}
              className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-canvas)] px-2 py-1.5 text-[13px] text-[var(--text-primary)]"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={submitCreate}
                className="btn-primary h-8 flex-1 text-[12px]"
              >
                Create
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="btn-secondary h-8 flex-1 text-[12px]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {items.length === 0 && !creating ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Workflow
              className="h-8 w-8 text-[var(--text-tertiary)]"
              strokeWidth={1.25}
            />
            <p className="text-[13px] text-[var(--text-secondary)]">
              No automations yet
            </p>
            <p className="max-w-xs text-[12px] text-[var(--text-tertiary)]">
              Create one to run recurring agent prompts on a trigger.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {items.map((a) => (
              <li
                key={a.id}
                className={cn(
                  "flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] px-3 py-2.5",
                  "bg-[var(--bg-surface)]",
                )}
              >
                <Workflow
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-tertiary)]"
                  strokeWidth={1.5}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                    {a.name}
                  </div>
                  <div className="truncate text-[12px] text-[var(--text-tertiary)]">
                    {a.trigger}
                  </div>
                  {a.prompt && (
                    <div className="mt-1 line-clamp-2 text-[11px] text-[var(--text-secondary)]">
                      {a.prompt}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px]",
                    a.enabled
                      ? "bg-[var(--success-muted)] text-[var(--success)]"
                      : "bg-[var(--bg-hover)] text-[var(--text-tertiary)]",
                  )}
                  onClick={() => toggle(a.id)}
                  title={a.enabled ? "Disable" : "Enable"}
                >
                  {a.enabled ? "On" : "Off"}
                </button>
                <button
                  type="button"
                  className="btn-ghost h-7 w-7 shrink-0 text-[var(--text-tertiary)]"
                  aria-label={`Delete ${a.name}`}
                  onClick={() => remove(a.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
