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
                  className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)]"
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
                      <span className="max-w-[140px] truncate text-[12px] text-[var(--text-secondary)]">
                        {att.name}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="rounded-[18px] bg-[var(--bg-active)] px-3.5 py-2 text-[14px] leading-[1.45] text-[var(--text-primary)]">
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
          "mb-2 inline-flex items-center gap-1 text-[12.5px] text-[var(--text-tertiary)]",
          hasTrace && "hover:text-[var(--text-secondary)]",
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

      <div className="w-full text-[14.5px] leading-[1.55] text-[var(--text-primary)]">
        <MarkdownContent content={message.content} streaming={streaming} />
      </div>

      {message.citations && message.citations.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Sources">
          {message.citations.map((citation) => (
            <span
              key={`${citation.source}:${citation.section}`}
              className="rounded-md border border-white/[0.1] bg-white/[0.03] px-2 py-1 text-[11px] text-[#aeb8c8]"
              title={citation.section}
            >
              {citation.source} · {citation.section}
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={copyContent}
        className="mt-1.5 inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-[var(--text-tertiary)] opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] group-hover:opacity-100"
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
