import { useState } from "react";
import {
  Bot,
  Copy,
  Check,
  History,
  Image as ImageIcon,
  RotateCcw,
  User,
  Video,
} from "lucide-react";
import type { ChatMessage } from "../../lib/types";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { AgentWorkflow } from "./AgentWorkflow";
import { DiffViewer } from "./DiffViewer";
import { MarkdownContent } from "./MarkdownContent";

interface AIMessageBubbleProps {
  message: ChatMessage;
  restoring?: boolean;
  onRestore?: (checkpointId: string) => void;
  streaming?: boolean;
}

/**
 * Spec §5.2 — user right-aligned raised surface; AI left transparent (panel-native).
 */
export function AIMessageBubble({
  message,
  restoring,
  onRestore,
  streaming,
}: AIMessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [showCheckpointTip, setShowCheckpointTip] = useState(false);

  async function copyContent() {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end gap-2 animate-cursor-fade">
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {message.attachments.map((att) => (
              <div
                key={att.id}
                className="group relative overflow-hidden rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)]"
                title={att.name}
              >
                {att.preview ? (
                  <img
                    src={att.preview}
                    alt={att.name}
                    className="h-16 w-16 object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center">
                    {att.kind === "image" && (
                      <ImageIcon className="h-4 w-4 text-[var(--accent-primary)]" />
                    )}
                    {att.kind === "video" && (
                      <Video className="h-4 w-4 text-[var(--info)]" />
                    )}
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 truncate bg-[hsl(0_0%_0%/0.7)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                  {att.name}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex max-w-[92%] items-end gap-2">
          <div className="rounded-[var(--radius-card)] bg-[var(--bg-surface-raised)] px-3 py-2 text-[13px] leading-5 text-[var(--text-primary)]">
            {message.content}
            <div className="mt-1 text-right text-[10px] text-[var(--text-tertiary)]">
              {message.timestamp}
            </div>
          </div>
          <div
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-hover)] text-[var(--text-tertiary)]"
            aria-hidden
          >
            <User className="h-3.5 w-3.5" />
          </div>
        </div>

        {message.checkpoint && (
          <button
            type="button"
            onClick={() => onRestore?.(message.checkpoint!)}
            disabled={restoring}
            className="group flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors duration-[var(--duration-instant)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] disabled:opacity-60"
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
              <span className="ml-1 hidden text-[10px] text-[var(--text-tertiary)] lg:inline">
                snapshots at this turn
              </span>
            )}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 animate-cursor-fade">
      <div
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-primary-muted)] text-[var(--accent-primary)]"
        aria-hidden
      >
        <Bot className="h-3.5 w-3.5" />
      </div>

      <div className="group min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-[var(--text-primary)]">
            Orchids
          </span>
          {streaming && (
            <span className="orchids-thinking-glow" title="Streaming">
              <span className="orchids-thinking-dot" />
            </span>
          )}
          {message.model && (
            <span className="rounded-[var(--radius-pill)] bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">
              {message.model}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={copyContent}
            className={cn(
              "ml-auto h-6 w-6 opacity-0 transition-opacity duration-[var(--duration-instant)] group-hover:opacity-100",
            )}
            aria-label="Copy message"
          >
            {copied ? (
              <Check className="h-3 w-3 text-[var(--success)]" />
            ) : (
              <Copy className="h-3 w-3 text-[var(--text-tertiary)]" />
            )}
          </Button>
        </div>

        <div className="bg-transparent text-[13px] leading-5 text-[var(--text-primary)]">
          <MarkdownContent content={message.content} streaming={streaming} />
        </div>

        {message.toolCalls && message.toolCalls.length > 0 && (
          <AgentWorkflow calls={message.toolCalls} />
        )}

        {message.fileEdits && message.fileEdits.length > 0 && (
          <DiffViewer edits={message.fileEdits} />
        )}

        <div className="text-[10px] text-[var(--text-tertiary)]">
          {message.timestamp}
        </div>
      </div>
    </div>
  );
}
