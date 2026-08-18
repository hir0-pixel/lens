import { useState } from "react";
import {
  ArrowUp,
  ChevronDown,
  Gauge,
  Paperclip,
  Plus,
  Search,
  Square,
  Timer,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Attachment, Model } from "@/lib/types";
import { ProviderDot } from "@/shared/design-system/ProviderDot";
import { useAutoGrowTextarea } from "./hooks/useAutoGrowTextarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ApplyPolicy = "ask" | "always" | "plan";
export type EffortLevel = "low" | "medium" | "extra-high";

const APPLY_OPTIONS: { id: ApplyPolicy; label: string }[] = [
  { id: "ask", label: "Ask before changes" },
  { id: "always", label: "Always apply changes" },
  { id: "plan", label: "Plan first" },
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
  const applyLabel =
    APPLY_OPTIONS.find((o) => o.id === applyPolicy)?.label ?? "Ask before changes";
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
    <div className="rounded-[22px] border border-white/[0.09] bg-[#1c1c1c] shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
      {fileInput}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3.5 pt-3">
          {attachments.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1 rounded-md bg-white/[0.06] px-2 py-1 text-[11px] text-[#b0b0b0]"
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
        className="max-h-[200px] min-h-[48px] w-full resize-none bg-transparent px-4 pt-3.5 text-[14px] leading-[1.45] text-[#e8e8e8] placeholder:text-[#6a6a6a] focus:outline-none"
      />

      <div className="flex items-center gap-0.5 px-2.5 pb-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#9a9a9a] hover:bg-white/[0.06] hover:text-[#e8e8e8]"
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
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-[12.5px] text-[#c4c4c4] hover:bg-white/[0.06]"
            >
              <Timer className="h-3.5 w-3.5 text-[#8a8a8a]" strokeWidth={1.6} />
              <span className="max-w-[160px] truncate">{applyLabel}</span>
              <ChevronDown className="h-3 w-3 text-[#6a6a6a]" strokeWidth={2} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {APPLY_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={opt.id}
                onClick={() => setPolicy(opt.id)}
                className={cn(applyPolicy === opt.id && "bg-white/[0.06]")}
              >
                {opt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="min-w-0 flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-8 max-w-[180px] items-center gap-1.5 rounded-full px-2 text-[12.5px] text-[#c4c4c4] hover:bg-white/[0.06]"
            >
              <ProviderDot provider={activeModel.provider} />
              <span className="truncate">{activeModel.label}</span>
              <ChevronDown className="h-3 w-3 text-[#6a6a6a]" strokeWidth={2} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {models.map((m) => (
              <DropdownMenuItem
                key={m.id}
                onClick={() => onModelChange(m)}
                className={cn(m.id === activeModel.id && "bg-white/[0.06]")}
              >
                <ProviderDot provider={m.provider} className="mr-2" />
                {m.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-[12.5px] text-[#c4c4c4] hover:bg-white/[0.06]"
            >
              <Gauge className="h-3.5 w-3.5 text-[#8a8a8a]" strokeWidth={1.6} />
              <span>{effortLabel}</span>
              <ChevronDown className="h-3 w-3 text-[#6a6a6a]" strokeWidth={2} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {EFFORT_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={opt.id}
                onClick={() => setEffort(opt.id)}
                className={cn(effort === opt.id && "bg-white/[0.06]")}
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
                ? "bg-[#ececec] text-[#111] hover:bg-white"
                : "bg-[#2a2a2a] text-[#6a6a6a]",
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
