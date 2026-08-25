import { useState } from "react";
import { Plus, Trash2, Workflow } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAutomationStore } from "@/stores/automationStore";

interface AutomationsDialogProps {
  open: boolean;
  onClose: () => void;
}

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
          <Button onClick={() => setCreating(true)} className="w-full type-caption">
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            New Automation
          </Button>
        ) : (
          <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
            <FieldGroup className="gap-3">
              <Field className="gap-1.5">
                <FieldLabel htmlFor="automation-name">Name</FieldLabel>
                <Input
                  id="automation-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name"
                  autoFocus
                />
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="automation-trigger">Trigger</FieldLabel>
                <Input
                  id="automation-trigger"
                  value={trigger}
                  onChange={(e) => setTrigger(e.target.value)}
                  placeholder="On save, Daily 2am"
                />
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="automation-prompt">Prompt</FieldLabel>
                <Textarea
                  id="automation-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Prompt the agent should run..."
                  rows={3}
                />
              </Field>
            </FieldGroup>
            <div className="mt-3 flex gap-2">
              <Button onClick={submitCreate} size="sm" className="flex-1 type-caption">
                Create
              </Button>
              <Button onClick={resetForm} variant="secondary" size="sm" className="flex-1 type-caption">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {items.length === 0 && !creating ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Workflow className="h-8 w-8 text-[var(--text-tertiary)]" strokeWidth={1.25} />
            <p className="type-caption text-[var(--text-secondary)]">No automations yet</p>
            <p className="max-w-xs type-caption text-[var(--text-tertiary)]">
              Create one to run recurring agent prompts on a trigger.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {items.map((automation) => (
              <li
                key={automation.id}
                className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5"
              >
                <Workflow className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-tertiary)]" strokeWidth={1.5} />
                <div className="min-w-0 flex-1">
                  <div className="truncate type-caption font-medium text-[var(--text-primary)]">
                    {automation.name}
                  </div>
                  <div className="truncate type-caption text-[var(--text-tertiary)]">
                    {automation.trigger}
                  </div>
                  {automation.prompt && (
                    <div className="mt-1 line-clamp-2 type-caption text-[var(--text-secondary)]">
                      {automation.prompt}
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  variant={automation.enabled ? "default" : "secondary"}
                  size="xs"
                  className={cn(
                    "shrink-0 rounded-full type-caption",
                    automation.enabled && "bg-[var(--success-muted)] text-[var(--success)] hover:bg-[var(--success-muted)]",
                  )}
                  onClick={() => toggle(automation.id)}
                  title={automation.enabled ? "Disable" : "Enable"}
                >
                  {automation.enabled ? "On" : "Off"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 text-[var(--text-tertiary)]"
                  aria-label={`Delete ${automation.name}`}
                  onClick={() => remove(automation.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
