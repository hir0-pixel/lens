import { useState } from "react";
import {
  Bot,
  History,
  Image as ImageIcon,
  RotateCcw,
  User,
  Video,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { ChatMessage, ToolCallRecord, FileEdit } from "../../lib/types";
import { ToolCallsList } from "./ToolCalls";
import FileEdits from "./FileEdits";

interface MessageBubbleProps {
  message: ChatMessage;
  restoring?: boolean;
  onRestore?: (checkpointId: string) => void;
}

export default function MessageBubble({
  message,
  restoring,
  onRestore,
}: MessageBubbleProps) {
  const [showCheckpointTip, setShowCheckpointTip] = useState(false);

  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end gap-2">
        <div className="flex max-w-[85%] items-end gap-2">
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-1 flex gap-1.5">
              {message.attachments.map((att) => (
                <div
                  key={att.id}
                  className="group relative flex h-14 w-14 items-center justify-center rounded-lg border border-white/10 bg-surface-2"
                  title={att.name}
                >
                  {att.kind === "image" && (
                    <ImageIcon className="h-5 w-5 text-accent" />
                  )}
                  {att.kind === "video" && (
                    <Video className="h-5 w-5 text-pink-400" />
                  )}
                  <div className="absolute inset-x-0 bottom-0 truncate rounded-b-lg bg-black/60 px-1 text-center text-[9px] text-zinc-300">
                    {att.name}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="rounded-2xl rounded-br-md border border-white/10 bg-zinc-800/80 px-3.5 py-2.5 text-[13px] leading-relaxed text-zinc-100">
            {message.content}
            <div className="mt-1 text-right text-[10px] text-zinc-500">
              {message.timestamp}
            </div>
          </div>
          <div className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10">
            <User className="h-3.5 w-3.5 text-zinc-400" />
          </div>
        </div>

        {message.checkpoint && (
          <button
            onClick={() => onRestore?.(message.checkpoint!)}
            disabled={restoring}
            className="group flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-60"
            onMouseEnter={() => setShowCheckpointTip(true)}
            onMouseLeave={() => setShowCheckpointTip(false)}
          >
            {restoring ? (
              <RotateCcw className="h-3 w-3 animate-spin" />
            ) : (
              <History className="h-3 w-3" />
            )}
            <span>Restore checkpoint</span>
            {showCheckpointTip && !restoring && (
              <span className="ml-1 hidden text-[10px] text-zinc-500 lg:inline">
                snapshots at this turn
              </span>
            )}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-400 to-accent-600">
        <Bot className="h-4 w-4 text-surface-0" />
      </div>
      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-zinc-200">
            Orchids Agent
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-500">
            {message.model}
          </span>
        </div>

        <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-300">
          {message.content}
        </div>

        {message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallsList calls={message.toolCalls} />
        )}

        {message.fileEdits && message.fileEdits.length > 0 && (
          <FileEdits edits={message.fileEdits} />
        )}

        <div className="text-[10px] text-zinc-600">{message.timestamp}</div>
      </div>
    </div>
  );
}
