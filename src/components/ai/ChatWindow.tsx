import { useEffect, useRef } from "react";
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
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending, streamingContent]);

  if (messages.length === 0 && !sending) {
    return <div className="min-h-0 flex-1" />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
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

          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
