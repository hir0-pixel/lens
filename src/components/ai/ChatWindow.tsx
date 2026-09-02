import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Project } from "../../lib/types";
import { AIMessageBubble } from "./AIMessageBubble";
import { ThinkingIndicator } from "./AgentWorkflow";

interface ChatWindowProps {
  messages: ChatMessage[];
  sending: boolean;
  restoringId: string | null;
  onRestoreCheckpoint: (id: string) => void;
  onPromptSelect: (prompt: string) => void;
  recentWorkspaces?: Project[];
  onWorkspaceSelect?: (project: Project) => void;
  streamingContent?: string;
  pendingToolCalls?: ChatMessage["toolCalls"];
}

export function ChatWindow({
  messages,
  sending,
  restoringId,
  onRestoreCheckpoint,
  streamingContent,
}: ChatWindowProps) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [hasScrolled, setHasScrolled] = useState(false);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript || !stickToBottomRef.current) return;

    transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" });
  }, [messages.length, sending, streamingContent]);

  const handleTranscriptScroll = () => {
    const transcript = transcriptRef.current;
    if (!transcript) return;

    const nextHasScrolled = transcript.scrollTop > 2;
    setHasScrolled((current) =>
      current === nextHasScrolled ? current : nextHasScrolled,
    );

    const distanceFromBottom =
      transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= 24;
  };

  if (messages.length === 0 && !sending) {
    return <div className="min-h-0 flex-1" />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        className="relative min-h-0 flex-1"
        data-scrolled={hasScrolled ? "true" : "false"}
      >
        <div
          ref={transcriptRef}
          className="lens-chat-transcript h-full min-h-0 overflow-y-auto overscroll-contain"
          onScroll={handleTranscriptScroll}
        >
          <div className="mx-auto flex w-full max-w-[760px] flex-col gap-7 px-6 pb-40 pt-4">
            {messages.map((msg) => (
              <AIMessageBubble
                key={msg.id}
                message={msg}
                restoring={restoringId === msg.checkpoint}
                onRestore={onRestoreCheckpoint}
              />
            ))}

            {sending && <ThinkingIndicator />}
          </div>
        </div>
        <div aria-hidden="true" className="lens-chat-transcript-fade" />
      </div>
    </div>
  );
}
