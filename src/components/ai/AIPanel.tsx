import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AIMode,
  Attachment,
  ChatMessage,
  Conversation,
  Model,
  Project,
} from "../../lib/types";
import { MODELS, INITIAL_PROJECTS } from "../../lib/mock-data";
import { AIPanelHeader } from "./AIPanelHeader";
import { AIComposer, type AIComposerHandle } from "./AIComposer";
import { ChatWindow } from "./ChatWindow";
import { ConversationHistory } from "./ConversationHistory";
import { AgentPlanPanel, type PlanStep } from "./AgentPlanPanel";
import { ReviewChangesPanel } from "./ReviewChangesPanel";
import {
  MOCK_CONVERSATIONS,
  MOCK_DIFF,
} from "./mock-data";
import { useAIKeyboardShortcuts } from "./hooks/useAIKeyboardShortcuts";

export interface AIPanelProps {
  messages: ChatMessage[];
  onSend: (text: string, attachments: Attachment[]) => void;
  onRestoreCheckpoint: (id: string) => void;
  onStop?: () => void;
  sending: boolean;
  restoringId: string | null;
  project?: Project;
  projects?: Project[];
  onProjectChange?: (project: Project) => void;
  onNewChat?: () => void;
  /** Entry mode from empty-session composer (Agent / Ask / Edit). */
  initialMode?: AIMode;
  onModeChange?: (mode: AIMode) => void;
  /** Controlled plan steps from session store. */
  planSteps?: PlanStep[];
}

/**
 * Primary agent session surface — plan, review ledger, transcript, composer.
 */
export function AIPanel({
  messages,
  onSend,
  onRestoreCheckpoint,
  onStop,
  sending,
  restoringId,
  project: _project = INITIAL_PROJECTS[0],
  projects = INITIAL_PROJECTS,
  onProjectChange,
  onNewChat,
  initialMode = "agent",
  onModeChange,
  planSteps: planStepsProp,
}: AIPanelProps) {
  const [mode, setModeState] = useState<AIMode>(initialMode);
  const [activeModel, setActiveModel] = useState<Model>(MODELS[0]);

  function setMode(next: AIMode) {
    setModeState(next);
    onModeChange?.(next);
  }

  useEffect(() => {
    setModeState(initialMode);
  }, [initialMode]);
  const [conversations, setConversations] =
    useState<Conversation[]>(MOCK_CONVERSATIONS);
  const [activeConversationId, setActiveConversationId] = useState("c1");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [localPlanSteps, setLocalPlanSteps] = useState<PlanStep[]>([]);
  const planSteps = planStepsProp ?? localPlanSteps;
  const setPlanSteps = setLocalPlanSteps;
  const [streamingContent, setStreamingContent] = useState("");
  const [pendingToolCalls, setPendingToolCalls] =
    useState<ChatMessage["toolCalls"]>();
  const composerRef = useRef<AIComposerHandle>(null);

  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) ?? conversations[0];
  const title = activeConversation?.title ?? "New session";

  const onFocusComposer = useCallback(() => composerRef.current?.focus(), []);
  const onEscapeComposer = useCallback(() => {
    setHistoryOpen(false);
    composerRef.current?.focus();
  }, []);

  useAIKeyboardShortcuts({
    onFocusComposer,
    onEscape: onEscapeComposer,
  });

  void _project;

  useEffect(() => {
    if (!sending) {
      setStreamingContent("");
      setPendingToolCalls(undefined);
      return;
    }

    setPlanSteps((prev) =>
      prev.map((s) =>
        s.status === "pending" && s.id === "p2"
          ? { ...s, status: "in_progress" }
          : s,
      ),
    );

    setPendingToolCalls([
      {
        id: "pending-1",
        name: "read_file",
        detail: "src/App.tsx",
        status: "running",
        category: "read",
        timestamp: new Date().toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
      },
    ]);

    const streamText =
      mode === "ask"
        ? "Here's how that part of the codebase works…"
        : mode === "edit"
          ? "I've prepared a scoped edit for the active file."
          : "I've applied that change and the preview is live in the Browser tab.";

    let index = 0;
    const streamInterval = setInterval(() => {
      index += 2;
      setStreamingContent(streamText.slice(0, index));
      if (index >= streamText.length) {
        clearInterval(streamInterval);
        setPendingToolCalls([
          {
            id: "pending-1",
            name: "read_file",
            detail: "src/App.tsx",
            status: "done",
            category: "read",
            durationMs: 320,
          },
          {
            id: "pending-2",
            name: "edit_file",
            detail: "Updating project files",
            status: "done",
            category: "edit",
            durationMs: 890,
          },
        ]);
        setPlanSteps((prev) =>
          prev.map((s) =>
            s.id === "p2" ? { ...s, status: "done" } : s,
          ),
        );
      }
    }, 40);

    return () => clearInterval(streamInterval);
  }, [sending, mode]);

  const handleNewChat = useCallback(() => {
    const id = `c-${Date.now()}`;
    setConversations((prev) => [
      {
        id,
        title: "New session",
        preview: "",
        updatedAt: new Date(),
      },
      ...prev,
    ]);
    setActiveConversationId(id);
    setPlanSteps([]);
    onNewChat?.();
  }, [onNewChat]);

  const handlePin = useCallback((id: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)),
    );
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationId === id && conversations.length > 1) {
        setActiveConversationId(
          conversations.find((c) => c.id !== id)?.id ?? "c1",
        );
      }
    },
    [activeConversationId, conversations],
  );

  const handleRename = useCallback((id: string, newTitle: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: newTitle } : c)),
    );
  }, []);

  const handlePromptSelect = useCallback((prompt: string) => {
    composerRef.current?.setText(prompt);
    composerRef.current?.focus();
  }, []);

  const handleSend = useCallback(
    (text: string, attachments: Attachment[]) => {
      if (mode === "agent" && planSteps.length === 0) {
        setPlanSteps([
          {
            id: "np1",
            label: "Analyze workspace context",
            status: "in_progress",
          },
          {
            id: "np2",
            label: "Apply requested changes",
            status: "pending",
          },
          {
            id: "np3",
            label: "Verify preview / diagnostics",
            status: "pending",
          },
        ]);
      }
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversationId
            ? {
                ...c,
                preview: text.slice(0, 80),
                updatedAt: new Date(),
                title:
                  c.title === "New session" || c.title === "New chat"
                    ? text.slice(0, 40) + (text.length > 40 ? "…" : "")
                    : c.title,
              }
            : c,
        ),
      );
      onSend(text, attachments);
    },
    [activeConversationId, mode, onSend, planSteps.length],
  );

  return (
    <div className="flex h-full flex-col bg-[var(--bg-canvas)]">
      <AIPanelHeader
        title={title}
        mode={mode}
        onModeChange={setMode}
        models={MODELS}
        activeModel={activeModel}
        onModelChange={setActiveModel}
        onNewChat={handleNewChat}
        onOpenHistory={() => setHistoryOpen(true)}
        onRenameTitle={() => {
          const newTitle = window.prompt("Rename session", title);
          if (newTitle?.trim())
            handleRename(activeConversationId, newTitle.trim());
        }}
        onDeleteChat={() => handleDelete(activeConversationId)}
      />

      {(mode === "agent" || planSteps.length > 0) &&
        planSteps.length > 0 && (
          <AgentPlanPanel steps={planSteps} forceOpen={sending} />
        )}

      {(mode === "agent" || mode === "edit") && messages.length > 0 && (
        <ReviewChangesPanel files={MOCK_DIFF} />
      )}

      <ChatWindow
        messages={messages}
        sending={sending}
        restoringId={restoringId}
        onRestoreCheckpoint={onRestoreCheckpoint}
        onPromptSelect={handlePromptSelect}
        recentWorkspaces={projects}
        onWorkspaceSelect={onProjectChange}
        streamingContent={streamingContent}
        pendingToolCalls={pendingToolCalls}
      />

      <AIComposer
        ref={composerRef}
        mode={mode}
        models={MODELS}
        activeModel={activeModel}
        sending={sending}
        onSend={handleSend}
        onStop={() => {
          setStreamingContent("");
          setPendingToolCalls(undefined);
          onStop?.();
        }}
        onModelChange={setActiveModel}
      />

      <ConversationHistory
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        conversations={conversations}
        activeId={activeConversationId}
        onSelect={setActiveConversationId}
        onPin={handlePin}
        onDelete={handleDelete}
        onRename={handleRename}
      />
    </div>
  );
}

export default AIPanel;
