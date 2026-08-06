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
              className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-zinc-300"
            >
              {att.kind === "image" && <ImageIcon className="h-3 w-3 text-accent" />}
              {att.kind === "video" && <Video className="h-3 w-3 text-pink-400" />}
              <span className="max-w-[140px] truncate">{att.name}</span>
              <span className="text-[10px] text-zinc-500">{att.sizeLabel}</span>
              <button
                onClick={() =>
                  setAttachments((prev) =>
                    prev.filter((a) => a.id !== att.id),
                  )
                }
                className="ml-0.5 text-zinc-500 transition-colors hover:text-zinc-200"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-1.5 rounded-xl border border-white/10 bg-surface-2 p-1.5 focus-within:border-accent/50">
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
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
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
          className="max-h-40 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-[13px] text-zinc-100 placeholder-zinc-500 outline-none"
        />

        <div className="relative">
          <button
            onClick={() => setModelMenuOpen((v) => !v)}
            className="flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-white/10"
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                activeModel.provider === "orchids"
                  ? "bg-accent"
                  : activeModel.provider === "claude"
                    ? "bg-[#D97757]"
                    : "bg-[#10A37F]",
              )}
            />
            <span className="max-w-[120px] truncate">{activeModel.label}</span>
            <ChevronDown className="h-3 w-3 text-zinc-500" />
          </button>
          {modelMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setModelMenuOpen(false)}
              />
              <div className="absolute bottom-full right-0 z-40 mb-1.5 w-64 animate-scale-in rounded-lg border border-white/10 bg-surface-2 p-1.5 shadow-float-pop">
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      onModelChange(m);
                      setModelMenuOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-zinc-300 transition-colors hover:bg-white/5",
                      m.id === activeModel.id && "bg-white/5 text-zinc-100",
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        m.provider === "orchids" && "bg-accent",
                        m.provider === "claude" && "bg-[#D97757]",
                        m.provider === "chatgpt" && "bg-[#10A37F]",
                        m.provider === "gemini" && "bg-[#4285F4]",
                        m.provider === "copilot" && "bg-[#2490EB]",
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
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
            sending
              ? "bg-white/10 text-zinc-200 hover:bg-white/20"
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

      <div className="mt-1.5 flex items-center justify-between px-1 text-[10px] text-zinc-600">
        <span>1 credit ≈ 1 word of AI output</span>
        <span>Enter to send · Shift+Enter for newline</span>
      </div>
    </div>
  );
}
