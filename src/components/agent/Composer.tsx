import { useRef, useState } from "react";
import {
  ArrowUp,
  ChevronDown,
  Image as ImageIcon,
  Paperclip,
  Square,
  Video,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { Attachment, Model } from "../../lib/types";

interface ComposerProps {
  models: Model[];
  activeModel: Model;
  sending: boolean;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  onModelChange: (m: Model) => void;
}

export default function Composer({
  models,
  activeModel,
  sending,
  onSend,
  onStop,
  onModelChange,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  function autoGrow() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    if (sending) return;
    if (text.trim() === "" && attachments.length === 0) return;
    onSend(text.trim(), attachments);
    setText("");
    setAttachments([]);
    if (taRef.current) taRef.current.style.height = "auto";
  }

  function handleFiles(files: FileList | null) {
    if (!files) return;
    const newAttachments: Attachment[] = Array.from(files).map((f) => {
      const isImage = f.type.startsWith("image/");
      const isVideo = f.type.startsWith("video/");
      const kind = isImage ? "image" : isVideo ? "video" : "file";
      const preview = isImage ? URL.createObjectURL(f) : undefined;
      const sizeLabel =
        f.size > 1024 * 1024
          ? `${(f.size / (1024 * 1024)).toFixed(1)} MB`
          : `${Math.max(1, Math.round(f.size / 1024))} KB`;
      return {
        id: `${f.name}-${Date.now()}`,
        name: f.name,
        kind,
        sizeLabel,
        preview,
      };
    });
    setAttachments((prev) => [...prev, ...newAttachments]);
  }

  return (
    <div className="border-t border-white/5 bg-surface-1 px-3 pb-3 pt-2.5">
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-hover)] px-2 py-1 type-caption text-[var(--text-secondary)]"
            >
              {att.kind === "image" && <ImageIcon className="h-3 w-3 text-accent" />}
              {att.kind === "video" && <Video className="h-3 w-3 text-[var(--info)]" />}
              <span className="max-w-[140px] truncate">{att.name}</span>
              <span className="type-caption text-[var(--text-tertiary)]">{att.sizeLabel}</span>
              <button
                onClick={() =>
                  setAttachments((prev) =>
                    prev.filter((a) => a.id !== att.id),
                  )
                }
                className="ml-0.5 text-[var(--text-tertiary)] transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)] hover:text-[var(--text-primary)]"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-1.5 rounded-xl border border-white/10 bg-surface-2 p-1.5">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          title="Upload images or videos"
        >
          <Paperclip className="h-4 w-4" />
        </button>

        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            autoGrow();
          }}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="Build, edit, plan or fix…"
          className="max-h-40 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1.5 type-caption text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none"
        />

        <div className="relative">
          <button
            onClick={() => setModelMenuOpen((v) => !v)}
            className="flex h-8 items-center gap-1 rounded-lg px-2 type-caption font-medium text-[var(--text-secondary)] transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)] hover:bg-[var(--bg-hover)]"
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                activeModel.provider === "lens"
                  ? "bg-accent"
                  : activeModel.provider === "claude"
                    ? "bg-[var(--warning)]"
                    : "bg-[var(--success)]",
              )}
            />
            <span className="max-w-[120px] truncate">{activeModel.label}</span>
            <ChevronDown className="h-3 w-3 text-[var(--text-tertiary)]" />
          </button>
          {modelMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setModelMenuOpen(false)}
              />
              <div className="absolute bottom-full right-0 z-40 mb-1.5 w-64 animate-scale-in rounded-lg border border-white/10 bg-surface-2 p-1.5">
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      onModelChange(m);
                      setModelMenuOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left type-caption text-[var(--text-secondary)] transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)] hover:bg-[var(--bg-hover)]",
                      m.id === activeModel.id && "bg-[var(--bg-hover)] text-[var(--text-primary)]",
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        m.provider === "lens" && "bg-accent",
                        m.provider === "claude" && "bg-[var(--warning)]",
                        m.provider === "chatgpt" && "bg-[var(--success)]",
                        m.provider === "gemini" && "bg-[var(--info)]",
                        m.provider === "copilot" && "bg-[var(--accent-primary-active)]",
                      )}
                    />
                    {m.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <button
          onClick={sending ? onStop : submit}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)]",
            sending
              ? "bg-[var(--bg-active)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              : "bg-accent text-surface-0 hover:bg-accent-600",
          )}
          title={sending ? "Stop" : "Send"}
        >
          {sending ? (
            <Square className="h-3.5 w-3.5 fill-current" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
        </button>
      </div>

      <div className="mt-1.5 flex items-center justify-between px-1 type-caption text-[var(--text-tertiary)]">
        <span>1 credit ≈ 1 word of AI output</span>
        <span>Enter to send · Shift+Enter for newline</span>
      </div>
    </div>
  );
}
