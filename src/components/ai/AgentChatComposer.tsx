import { useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ClipboardList,
  Gauge,
  Hand,
  Paperclip,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Attachment, Model } from "@/lib/types";
import { useAutoGrowTextarea } from "./hooks/useAutoGrowTextarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ApplyPolicy = "ask" | "auto" | "plan" | "full";
export type EffortLevel = "low" | "medium" | "extra-high";

const APPLY_OPTIONS: {
  id: ApplyPolicy;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}[] = [
  {
    id: "ask",
    label: "Ask before changes",
    hint: "Ask before file changes.",
    icon: Hand,
  },
  {
    id: "auto",
    label: "Edit automatically",
    hint: "Edit files automatically.",
    icon: ShieldCheck,
  },
  {
    id: "plan",
    label: "Plan mode",
    hint: "Plan before editing.",
    icon: ClipboardList,
  },
  {
    id: "full",
    label: "Full access",
    hint: "Run with fewer confirmations.",
    icon: ShieldAlert,
  },
];

const EFFORT_OPTIONS: { id: EffortLevel; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "extra-high", label: "Extra high" },
];

interface AgentChatComposerProps {
  text: string;
  onTextChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  sending: boolean;
  placeholder: string;
  models: Model[];
  activeModel: Model;
  onModelChange: (model: Model) => void;
  attachments?: Attachment[];
  onRemoveAttachment?: (id: string) => void;
  onAttachFiles?: () => void;
  onAddContext?: () => void;
  applyPolicy?: ApplyPolicy;
  onApplyPolicyChange?: (policy: ApplyPolicy) => void;
  effort?: EffortLevel;
  onEffortChange?: (effort: EffortLevel) => void;
  fileInput?: React.ReactNode;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export function AgentChatComposer({
  text,
  onTextChange,
  onSubmit,
  onStop,
  sending,
  placeholder,
  models,
  activeModel,
  onModelChange,
  attachments = [],
  onRemoveAttachment,
  onAttachFiles,
  onAddContext,
  applyPolicy: applyPolicyProp,
  onApplyPolicyChange,
  effort: effortProp,
  onEffortChange,
  fileInput,
  textareaRef,
}: AgentChatComposerProps) {
  const { ref: innerRef, adjust } = useAutoGrowTextarea(200);
  const [localPolicy, setLocalPolicy] = useState<ApplyPolicy>("ask");
  const [localEffort, setLocalEffort] = useState<EffortLevel>("low");
  const applyPolicy = applyPolicyProp ?? localPolicy;
  const effort = effortProp ?? localEffort;
  const canSend = text.trim().length > 0 || attachments.length > 0;
  const applyOption =
    APPLY_OPTIONS.find((o) => o.id === applyPolicy) ?? APPLY_OPTIONS[0];
  const ApplyIcon = applyOption.icon;
  const effortLabel =
    EFFORT_OPTIONS.find((o) => o.id === effort)?.label ?? "Low";

  function setPolicy(next: ApplyPolicy) {
    setLocalPolicy(next);
    onApplyPolicyChange?.(next);
  }

  function setEffort(next: EffortLevel) {
    setLocalEffort(next);
    onEffortChange?.(next);
  }

  return (
    <div className="rounded-2xl border border-transparent bg-[var(--bg-surface)] shadow-xl transition-all">
      {fileInput}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3.5 pt-3">
          {attachments.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1 rounded-md bg-[var(--bg-hover)] px-2 py-1 text-[11px] text-[var(--text-secondary)]"
            >
              <Paperclip className="h-3 w-3" strokeWidth={1.5} />
              <span className="max-w-[140px] truncate">{a.name}</span>
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() => onRemoveAttachment?.(a.id)}
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            </span>
          ))}
        </div>
      )}

      <textarea
        ref={(el) => {
          innerRef.current = el;
          if (textareaRef) {
            (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current =
              el;
          }
        }}
        value={text}
        onChange={(e) => {
          onTextChange(e.target.value);
          adjust();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (sending) return;
            onSubmit();
          }
        }}
        rows={1}
        placeholder={placeholder}
        className="max-h-[200px] min-h-[48px] w-full resize-none bg-transparent px-4 pt-3.5 text-[14px] leading-[1.45] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
      />

      <div className="flex items-center gap-0.5 px-2.5 pb-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              aria-label="Add"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onClick={onAttachFiles}>
              <Paperclip className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} />
              Attach files…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onAddContext}>
              <Search className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} />
              Add context…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              <ApplyIcon className="h-3.5 w-3.5 text-[var(--text-secondary)]" strokeWidth={1.6} />
              <span className="max-w-[160px] truncate">{applyOption.label}</span>
              <ChevronDown className="h-3 w-3 text-[var(--text-tertiary)]" strokeWidth={2} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="top"
            sideOffset={8}
            className="w-[280px] rounded-xl border-[var(--border-default)] bg-[var(--bg-overlay)] p-1.5 text-[var(--text-primary)] shadow-[var(--shadow-lg)]"
          >
            {APPLY_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const selected = applyPolicy === opt.id;
              return (
                <DropdownMenuItem
                  key={opt.id}
                  onClick={() => setPolicy(opt.id)}
                  className={cn(
                    "items-start gap-2.5 rounded-lg px-2.5 py-2 text-[var(--text-primary)] focus:bg-[var(--bg-hover)] focus:text-[var(--text-primary)]",
                    selected && "bg-[var(--bg-active)]",
                  )}
                >
                  <Icon
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-primary)]"
                    strokeWidth={1.6}
                  />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block text-[13.5px]">{opt.label}</span>
                    <span className="mt-0.5 block text-[12px] text-[var(--text-secondary)]">
                      {opt.hint}
                    </span>
                  </span>
                  {selected && (
                    <Check
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-primary)]"
                      strokeWidth={2}
                    />
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="min-w-0 flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-8 max-w-[180px] items-center gap-1.5 rounded-full px-2 text-[12.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              <span className="truncate">{activeModel.label}</span>
              <ChevronDown className="h-3 w-3 text-[var(--text-tertiary)]" strokeWidth={2} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {models.map((m) => (
              <DropdownMenuItem
                key={m.id}
                onClick={() => onModelChange(m)}
                className={cn(
                  "focus:bg-[var(--bg-hover)] focus:text-[var(--text-primary)]",
                  m.id === activeModel.id && "bg-[var(--bg-active)] text-[var(--text-primary)]",
                )}
              >
                {m.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-[12.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              <Gauge className="h-3.5 w-3.5 text-[var(--text-tertiary)]" strokeWidth={1.6} />
              <span>{effortLabel}</span>
              <ChevronDown className="h-3 w-3 text-[var(--text-tertiary)]" strokeWidth={2} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {EFFORT_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={opt.id}
                onClick={() => setEffort(opt.id)}
                className={cn(
                  "focus:bg-[var(--bg-hover)] focus:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
                  effort === opt.id && "bg-[var(--bg-hover)]",
                )}
              >
                {opt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          onClick={sending ? onStop : onSubmit}
          disabled={!sending && !canSend}
          className={cn(
            "ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
            sending
              ? "bg-[#ef4444] text-white hover:bg-[#dc2626]"
              : canSend
                ? "bg-[var(--accent-primary)] text-[var(--text-on-accent)] hover:bg-[var(--accent-primary-hover)]"
                : "bg-[var(--bg-active)] text-[var(--text-disabled)]",
          )}
          aria-label={sending ? "Stop" : "Send"}
        >
          {sending ? (
            <Square className="h-3 w-3 fill-current" />
          ) : (
            <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
          )}
        </button>
      </div>
    </div>
  );
}
