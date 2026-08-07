import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ArrowUp,
  AtSign,
  ChevronDown,
  FolderUp,
  Image as ImageIcon,
  Paperclip,
  Square,
  Video,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { AIMode, Attachment, MentionItem, Model } from "../../lib/types";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { useAutoGrowTextarea } from "./hooks/useAutoGrowTextarea";
import { MENTION_ITEMS } from "./mock-data";
import { MentionPicker } from "./MentionPicker";
import { ProviderDot } from "@/shared/design-system/ProviderDot";

export interface AIComposerHandle {
  focus: () => void;
  setText: (text: string) => void;
}

interface AIComposerProps {
  mode: AIMode;
  models: Model[];
  activeModel: Model;
  sending: boolean;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  onModelChange: (m: Model) => void;
}

const MODE_PLACEHOLDER: Record<AIMode, string> = {
  agent: "Build, edit, plan or fix…",
  ask: "Ask about this codebase…",
  edit: "Describe the edit…",
};

export const AIComposer = forwardRef<AIComposerHandle, AIComposerProps>(
  function AIComposer(
    {
      mode,
      models,
      activeModel,
      sending,
      onSend,
      onStop,
      onModelChange,
    },
    ref,
  ) {
    const [text, setText] = useState("");
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [modelMenuOpen, setModelMenuOpen] = useState(false);
    const [mentionOpen, setMentionOpen] = useState(false);
    const [mentionQuery, setMentionQuery] = useState("");
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const { ref: taRef, adjust, reset } = useAutoGrowTextarea(200);

    useImperativeHandle(ref, () => ({
      focus: () => taRef.current?.focus(),
      setText: (value: string) => {
        setText(value);
        adjust();
      },
    }));

    const submit = useCallback(() => {
      if (sending) return;
      if (text.trim() === "" && attachments.length === 0) return;
      onSend(text.trim(), attachments);
      setText("");
      setAttachments([]);
      reset();
    }, [sending, text, attachments, onSend, reset]);

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
      if (mentionOpen) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    }

    function handleChange(value: string) {
      setText(value);
      adjust();

      const atMatch = value.match(/@(\w*)$/);
      if (atMatch) {
        setMentionOpen(true);
        setMentionQuery(atMatch[1] ?? "");
      } else {
        setMentionOpen(false);
        setMentionQuery("");
      }
    }

    function handleMentionSelect(item: MentionItem) {
      const newText = text.replace(/@(\w*)$/, `@${item.label} `);
      setText(newText);
      setMentionOpen(false);
      setMentionQuery("");
      adjust();
      taRef.current?.focus();
    }

    function handleFiles(files: FileList | null, kind?: "folder") {
      if (!files) return;
      const newAttachments: Attachment[] = Array.from(files).map((f) => {
        const isImage = f.type.startsWith("image/");
        const isVideo = f.type.startsWith("video/");
        const fileKind = isImage ? "image" : isVideo ? "video" : "file";
        const preview = isImage ? URL.createObjectURL(f) : undefined;
        const sizeLabel =
          f.size > 1024 * 1024
            ? `${(f.size / (1024 * 1024)).toFixed(1)} MB`
            : `${Math.max(1, Math.round(f.size / 1024))} KB`;
        return {
          id: `${f.name}-${Date.now()}`,
          name: kind === "folder" ? `${f.name}/` : f.name,
          kind: fileKind,
          sizeLabel,
          preview,
        };
      });
      setAttachments((prev) => [...prev, ...newAttachments]);
    }

    function handleDrop(e: React.DragEvent) {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    }

    return (
      <div
        className={cn(
          "sticky bottom-0 shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 pb-3 pt-2",
          "transition-colors duration-[var(--duration-instant)]",
          dragOver && "bg-[var(--bg-hover)]",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="group flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors duration-[var(--duration-instant)]"
              >
                {att.kind === "image" && att.preview ? (
                  <img src={att.preview} alt="" className="h-4 w-4 rounded object-cover" />
                ) : att.kind === "image" ? (
                  <ImageIcon className="h-3 w-3 text-accent" />
                ) : att.kind === "video" ? (
                  <Video className="h-3 w-3 text-pink-400" />
                ) : (
                  <Paperclip className="h-3 w-3 text-zinc-400" />
                )}
                <span className="max-w-[120px] truncate">{att.name}</span>
                <span className="text-[10px] text-zinc-500">{att.sizeLabel}</span>
                <button
                  onClick={() =>
                    setAttachments((prev) => prev.filter((a) => a.id !== att.id))
                  }
                  className="ml-0.5 text-[var(--text-tertiary)] opacity-0 transition-opacity duration-[var(--duration-instant)] group-hover:opacity-100 hover:text-[var(--text-primary)]"
                  aria-label={`Remove ${att.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="relative">
          <MentionPicker
            open={mentionOpen}
            items={MENTION_ITEMS}
            query={mentionQuery}
            onQueryChange={setMentionQuery}
            onSelect={handleMentionSelect}
            onClose={() => setMentionOpen(false)}
          />

          <div
            className={cn(
              "orchids-composer-shell flex items-end gap-1 p-1.5",
              "focus-within:shadow-[var(--shadow-focus-ring)]",
            )}
            data-streaming={sending ? "true" : "false"}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,*/*"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <input
              ref={folderInputRef}
              type="file"
              // @ts-expect-error webkitdirectory is non-standard but widely supported
              webkitdirectory=""
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files, "folder")}
            />

            <div className="flex shrink-0 flex-col gap-0.5">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
                title="Attach files"
              >
                <Paperclip className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => folderInputRef.current?.click()}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
                title="Attach folder"
              >
                <FolderUp className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => {
                  setText((t) => t + "@");
                  setMentionOpen(true);
                  taRef.current?.focus();
                }}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
                title="Mention (@)"
              >
                <AtSign className="h-3.5 w-3.5" />
              </button>
            </div>

            <Textarea
              ref={taRef}
              value={text}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder={MODE_PLACEHOLDER[mode]}
              className="max-h-[200px] min-h-[36px] min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-[13px] text-zinc-100 placeholder-zinc-500 shadow-none focus-visible:ring-0"
            />

            <div className="relative shrink-0">
              <button
                onClick={() => setModelMenuOpen((v) => !v)}
                className="flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-white/10"
              >
                <ProviderDot provider={activeModel.provider} />
                <span className="max-w-[90px] truncate">{activeModel.label}</span>
                <ChevronDown className="h-3 w-3 text-zinc-500" />
              </button>
              {modelMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setModelMenuOpen(false)}
                  />
                  <div className="absolute bottom-full right-0 z-40 mb-1.5 w-56 animate-scale-in rounded-lg border border-white/10 bg-surface-2 p-1 shadow-float-pop">
                    {models.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          onModelChange(m);
                          setModelMenuOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-zinc-300 transition-colors hover:bg-white/5",
                          m.id === activeModel.id && "bg-white/5 text-zinc-100",
                        )}
                      >
                        <ProviderDot provider={m.provider} />
                        {m.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <Button
              onClick={sending ? onStop : submit}
              size="icon"
              disabled={!sending && text.trim() === "" && attachments.length === 0}
              className={cn(
                "h-8 w-8 shrink-0 rounded-[var(--radius-md)] transition-colors duration-[var(--duration-instant)]",
                sending
                  ? "bg-[var(--error-muted)] text-[var(--error)] hover:bg-[var(--error)] hover:text-white"
                  : text.trim() || attachments.length
                    ? "btn-send-active border-0 shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)]"
                    : "bg-[var(--bg-hover)] text-[var(--text-disabled)]",
              )}
              title={sending ? "Stop" : "Send"}
              aria-label={sending ? "Stop agent" : "Send"}
            >
              {sending ? (
                <Square className="h-3.5 w-3.5 fill-current" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        <div className="mt-1.5 flex items-center justify-between px-1 text-[10px] text-[var(--text-tertiary)]">
          <span>Ctrl+I focus · @ files / folders / terminal / sessions</span>
          <span>Enter send · Shift+Enter newline</span>
        </div>
      </div>
    );
  },
);
