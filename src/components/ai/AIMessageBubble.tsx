import { useState } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  Image as ImageIcon,
  Video,
} from "lucide-react";
import type { ChatMessage } from "../../lib/types";
import { cn } from "../../lib/utils";
import { AgentWorkflow } from "./AgentWorkflow";
import { DiffViewer } from "./DiffViewer";
import { MarkdownContent } from "./MarkdownContent";

interface AIMessageBubbleProps {
  message: ChatMessage;
  restoring?: boolean;
  onRestore?: (checkpointId: string) => void;
  streaming?: boolean;
}

function workedLabel(message: ChatMessage) {
  const total = message.toolCalls?.reduce(
    (sum, call) => sum + (call.durationMs ?? 0),
    0,
  );
  const seconds = Math.max(1, Math.round((total || 3000) / 1000));
  return `Worked for ${seconds}s`;
}

/**
 * Cursor-style transcript: user is a compact right pill; assistant is
 * flush text with a collapsible “Worked for Xs” line — no avatars.
 */
export function AIMessageBubble({
  message,
  streaming,
}: AIMessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);

  async function copyContent() {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[min(72%,520px)] flex-col items-end gap-2">
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap justify-end gap-1.5">
              {message.attachments.map((att) => (
                <div
                  key={att.id}
                  className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#2a2a2a]"
                  title={att.name}
                >
                  {att.preview ? (
                    <img
                      src={att.preview}
                      alt={att.name}
                      className="h-16 w-16 object-cover"
                    />
                  ) : (
                    <div className="flex h-12 items-center gap-2 px-3">
                      {att.kind === "image" ? (
                        <ImageIcon className="h-3.5 w-3.5 text-[#8a8a8a]" />
                      ) : att.kind === "video" ? (
                        <Video className="h-3.5 w-3.5 text-[#8a8a8a]" />
                      ) : null}
                      <span className="max-w-[140px] truncate text-[12px] text-[#c8c8c8]">
                        {att.name}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="rounded-[18px] bg-[#2f2f2f] px-3.5 py-2 text-[14px] leading-[1.45] text-[#ececec]">
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  const hasTrace =
    (message.toolCalls && message.toolCalls.length > 0) ||
    (message.fileEdits && message.fileEdits.length > 0);

  return (
    <div className="group flex flex-col items-start">
      <button
        type="button"
        onClick={() => hasTrace && setTraceOpen((v) => !v)}
        className={cn(
          "mb-2 inline-flex items-center gap-1 text-[12.5px] text-[#8a8a8a]",
          hasTrace && "hover:text-[#c4c4c4]",
        )}
      >
        {streaming ? "Working" : workedLabel(message)}
        <ChevronRight
          className={cn(
            "h-3 w-3 transition-transform",
            traceOpen && "rotate-90",
          )}
          strokeWidth={2}
        />
      </button>

      {traceOpen && hasTrace && (
        <div className="mb-3 w-full">
          {message.toolCalls && message.toolCalls.length > 0 && (
            <AgentWorkflow calls={message.toolCalls} />
          )}
          {message.fileEdits && message.fileEdits.length > 0 && (
            <div className="mt-2">
              <DiffViewer edits={message.fileEdits} />
            </div>
          )}
        </div>
      )}

      <div className="w-full text-[14.5px] leading-[1.55] text-[#d4d4d4]">
        <MarkdownContent content={message.content} streaming={streaming} />
      </div>

      <button
        type="button"
        onClick={copyContent}
        className="mt-1.5 inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-[#6a6a6a] opacity-0 transition-opacity hover:bg-white/[0.04] hover:text-[#c4c4c4] group-hover:opacity-100"
        aria-label="Copy message"
      >
        {copied ? (
          <Check className="h-3 w-3 text-[#3fb950]" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </button>
    </div>
  );
}
