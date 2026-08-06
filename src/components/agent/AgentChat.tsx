import { useEffect, useRef, useState } from "react";
import { Braces, Sparkles } from "lucide-react";
import { cn } from "../../lib/utils";
import type {
  AgentMode,
  Attachment,
  ChatMessage,
  Model,
} from "../../lib/types";
import { MODELS } from "../../lib/mock-data";
import MessageBubble from "./MessageBubble";
import Composer from "./Composer";

interface AgentChatProps {
  messages: ChatMessage[];
  onSend: (text: string, attachments: Attachment[]) => void;
  onRestoreCheckpoint: (id: string) => void;
  sending: boolean;
  restoringId: string | null;
}

export default function AgentChat({
  messages,
  onSend,
  onRestoreCheckpoint,
  sending,
  restoringId,
}: AgentChatProps) {
  const [mode, setMode] = useState<AgentMode>("agent");
  const [activeModel, setActiveModel] = useState<Model>(MODELS[0]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  return (
    <div className="flex h-full flex-col bg-surface-0">
      {/* Mode switch */}
      <div className="flex items-center gap-1 border-b border-white/5 px-3 py-2">
        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-surface-1 p-0.5">
          <button
            onClick={() => setMode("agent")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
              mode === "agent"
                ? "bg-accent text-surface-0"
                : "text-zinc-400 hover:text-zinc-200",
            )}
          >
            <Sparkles className="h-3 w-3" />
            Agent
          </button>
          <button
            onClick={() => setMode("claude-code")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
              mode === "claude-code"
                ? "bg-[#D97757] text-white"
                : "text-zinc-400 hover:text-zinc-200",
            )}
          >
            <Braces className="h-3 w-3" />
            Claude Code
          </button>
        </div>
        <span className="ml-auto hidden text-[11px] text-zinc-600 xl:block">
          {mode === "agent"
            ? "Build, edit, plan and fix with the agent"
            : "Running Claude Code directly inside Orchids"}
        </span>
      </div>

      {/* Thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto flex max-w-[560px] flex-col gap-6">
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              restoring={restoringId === msg.checkpoint}
              onRestore={onRestoreCheckpoint}
            />
          ))}
          {sending && (
            <div className="flex items-center gap-2 px-1 text-[12px] text-zinc-500">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" />
                <span
                  className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent"
                  style={{ animationDelay: "0.15s" }}
                />
                <span
                  className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent"
                  style={{ animationDelay: "0.3s" }}
                />
              </span>
              {mode === "claude-code" ? "Claude Code is thinking…" : "Agent is thinking…"}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <Composer
        models={MODELS}
        activeModel={activeModel}
        sending={sending}
        onSend={onSend}
        onStop={() => {}}
        onModelChange={setActiveModel}
      />
    </div>
  );
}
