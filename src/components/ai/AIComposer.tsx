import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { cn } from "../../lib/utils";
import type { AIMode, Attachment, MentionItem, Model } from "../../lib/types";
import { useAutoGrowTextarea } from "./hooks/useAutoGrowTextarea";
import { MENTION_ITEMS } from "./mock-data";
import { MentionPicker } from "./MentionPicker";
import { AgentChatComposer } from "./AgentChatComposer";

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
          "sticky bottom-0 shrink-0 bg-transparent px-4 pb-4 pt-2",
          dragOver && "bg-[var(--bg-hover)]",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <div className="relative mx-auto max-w-[760px]">
          <MentionPicker
            open={mentionOpen}
            items={MENTION_ITEMS}
            query={mentionQuery}
            onQueryChange={setMentionQuery}
            onSelect={handleMentionSelect}
            onClose={() => setMentionOpen(false)}
          />
          <AgentChatComposer
            text={text}
            onTextChange={handleChange}
            onSubmit={submit}
            onStop={onStop}
            sending={sending}
            placeholder={MODE_PLACEHOLDER[mode] ?? "Ask for follow up changes"}
            models={models}
            activeModel={activeModel}
            onModelChange={onModelChange}
            attachments={attachments}
            onRemoveAttachment={(id) =>
              setAttachments((prev) => prev.filter((a) => a.id !== id))
            }
            onAttachFiles={() => fileInputRef.current?.click()}
            onAddContext={() => {
              setText((t) => t + "@");
              setMentionOpen(true);
              taRef.current?.focus();
            }}
            textareaRef={taRef}
            fileInput={
              <>
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
              </>
            }
          />
        </div>
      </div>
    );
  },
);
