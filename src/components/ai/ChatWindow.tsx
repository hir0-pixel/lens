import { useEffect, useRef } from "react";
import type { ChatMessage, Project } from "../../lib/types";
import { AIMessageBubble } from "./AIMessageBubble";
import { AgentWorkflow, ThinkingIndicator } from "./AgentWorkflow";
import { ChatEmptyState } from "./ChatEmptyState";

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
  onPromptSelect,
  recentWorkspaces,
  onWorkspaceSelect,
  streamingContent,
  pendingToolCalls,
}: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending, streamingContent]);

  if (messages.length === 0 && !sending) {
    return <ChatEmptyState />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 px-2 py-2">
        {messages.map((msg) => (
          <AIMessageBubble
            key={msg.id}
            message={msg}
            restoring={restoringId === msg.checkpoint}
            onRestore={onRestoreCheckpoint}
          />
        ))}

        {sending && (
          <>
            {pendingToolCalls && pendingToolCalls.length > 0 ? (
              <AgentWorkflow calls={pendingToolCalls} />
            ) : (
              <ThinkingIndicator />
            )}

          </>
        )}

        <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
