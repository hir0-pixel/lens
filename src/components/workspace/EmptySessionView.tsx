import {
  Bot,
  Boxes,
  ChevronDown,
  Cloud,
  Copy,
  ExternalLink,
  FileCode,
  FileText,
  Folder,
  FolderPlus,
  GitBranch,
  Image,
  LayoutGrid,
  MessageSquare,
  Monitor,
  MoreHorizontal,
  Pin,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Timer,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { AIMode, Attachment, Model, ChatMessage } from "@/lib/types";
import { MODELS } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { ChatWindow } from "@/components/ai/ChatWindow";
import { AgentChatComposer } from "@/components/ai/AgentChatComposer";
import TerminalPanel from "@/components/output/TerminalPanel";
import { UserAccountMenu } from "@/shared/bff-auth/UserAccountMenu";
import { revealInFolder } from "@/features/projects/revealInFolder";
import { LayoutToolbar } from "@/components/TitleBar";
import { useGitStore } from "@/stores/gitStore";
import { GitBranchPicker } from "@/components/workspace/GitBranchPicker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCommandStore } from "@/features/command-palette/commandStore";
import {
  relativeFrom,
  useSessionStore,
  type PlanStep,
  type Repository,
} from "@/stores/sessionStore";

type LocationScope = "this-pc" | "cloud";

interface EmptySessionViewProps {
  model: Model;
  models?: Model[];
  messages: ChatMessage[];
  sending: boolean;
  restoringId: string | null;
  planSteps?: PlanStep[];
  onSend: (
    text: string,
    mode: AIMode,
    model: Model,
    attachments?: Attachment[],
    opts?: { planFirst?: boolean },
  ) => void;
  onStop?: () => void;
  onRestoreCheckpoint?: (id: string) => void;
  onOpenSettings?: (section?: string) => void;
  onOpenAutomations?: () => void;
  onAddFolder?: () => void;
  onImport?: () => void;
  onMultitask?: () => void;
  terminalOpen?: boolean;
  onCloseTerminal?: () => void;
  catalogStatus?: "idle" | "loading" | "ready" | "empty" | "error";
  catalogError?: string;
  agentsDock?: string | null;
  onToggleSidePane?: () => void;
  onOpenTerminal?: () => void;
}

/**
 * Cursor-style agents home — sidebar, transcript, floating composer.
 */
export function EmptySessionView({
  model: fallbackModel,
  models = MODELS,
  messages,
  sending,
  restoringId,
  planSteps: _planSteps,
  onSend,
  onStop,
  onRestoreCheckpoint,
  onOpenSettings,
  onOpenAutomations: _onOpenAutomations,
  onAddFolder,
  onImport,
  onMultitask,
  terminalOpen = false,
  onCloseTerminal,
  catalogStatus,
  catalogError,
  agentsDock = null,
  onToggleSidePane,
  onOpenTerminal,
}: EmptySessionViewProps) {
  const repositories = useSessionStore((s) => s.repositories);
  const sessions = useSessionStore((s) => s.sessions);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const newChat = useSessionStore((s) => s.newChat);
  const openRepository = useSessionStore((s) => s.openRepository);
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);
  const setSessionRepo = useSessionStore((s) => s.setSessionRepo);
  const setSessionModel = useSessionStore((s) => s.setSessionModel);
  const renameSession = useSessionStore((s) => s.renameSession);
  const closeSessionTab = useSessionStore((s) => s.closeSessionTab);
  const renameRepository = useSessionStore((s) => s.renameRepository);
  const removeRepository = useSessionStore((s) => s.removeRepository);
  const createSession = useSessionStore((s) => s.createSession);

  const session = currentSessionId ? sessions[currentSessionId] : null;
  const activeModel =
    models.find((m) => m.id === (session?.modelId ?? fallbackModel.id)) ??
    fallbackModel;
  const activeRepoId = session?.repoId ?? null;
  const activeRepo = repositories.find((r) => r.id === activeRepoId) ?? null;

  const [text, setText] = useState("");
  const [expandedRepos, setExpandedRepos] = useState<string | null>(
    activeRepoId,
  );
  const [location, setLocation] = useState<LocationScope>("this-pc");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [tick, setTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openCommands = useCommandStore((s) => s.openCommands);
  const currentBranch = useGitStore((s) => s.branches.find((b) => b.current));
  const [headerBranchOpen, setHeaderBranchOpen] = useState(false);
  const togglePinSession = useSessionStore((s) => s.togglePinSession);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<
    "chat" | "capabilities" | "messaging" | "scheduled-jobs" | "artifacts"
  >("chat");
  const [artifactSearch, setArtifactSearch] = useState("");

  const canSend = text.trim().length > 0 || attachments.length > 0;

  const allArtifacts = useMemo(() => {
    const list: Array<{
      id: string;
      name: string;
      path?: string;
      kind: "created-file";
      fileType: "image" | "video" | "code" | "file";
      sizeLabel?: string;
      summary?: string;
      additions?: number;
      sessionId: string;
      sessionTitle: string;
      timestamp: number | string;
    }> = [];

    Object.values(sessions).forEach((sess) => {
      sess.messages?.forEach((msg) => {
        // Exclude user attachments and edits to existing folder files.
        // Include ONLY new files created by the agent.
        msg.fileEdits?.forEach((fe, idx) => {
          const summaryLower = (fe.summary || "").toLowerCase();
          const isNewlyCreated =
            fe.deletions === 0 ||
            summaryLower.includes("create") ||
            summaryLower.includes("new file") ||
            summaryLower.includes("add file");

          if (isNewlyCreated) {
            const basename = fe.path.split(/[/\\]/).pop() || fe.path;
            list.push({
              id: `created-${msg.id}-${idx}`,
              name: basename,
              path: fe.path,
              kind: "created-file",
              fileType: basename.endsWith(".png") || basename.endsWith(".jpg") ? "image" : "code",
              summary: fe.summary || "New file created by agent",
              additions: fe.additions,
              sessionId: sess.id,
              sessionTitle: sess.title,
              timestamp: msg.timestamp || sess.lastActiveAt,
            });
          }
        });
      });
    });

    if (list.length === 0) {
      list.push(
        {
          id: "created-sample-1",
          name: "implementation_plan.md",
          path: "implementation_plan.md",
          kind: "created-file",
          fileType: "file",
          sizeLabel: "4.2 KB",
          summary: "Architecture & Implementation Plan created by Agent",
          additions: 120,
          sessionId: currentSessionId || "default",
          sessionTitle: "Agent Task Session",
          timestamp: Date.now() - 3600000,
        },
        {
          id: "created-sample-2",
          name: "walkthrough.md",
          path: "walkthrough.md",
          kind: "created-file",
          fileType: "file",
          sizeLabel: "2.8 KB",
          summary: "Execution Walkthrough & Summary created by Agent",
          additions: 85,
          sessionId: currentSessionId || "default",
          sessionTitle: "Agent Task Session",
          timestamp: Date.now() - 7200000,
        },
        {
          id: "created-sample-3",
          name: "AuthHelper.ts",
          path: "src/utils/AuthHelper.ts",
          kind: "created-file",
          fileType: "code",
          summary: "New authentication utility module created by Agent",
          additions: 64,
          sessionId: currentSessionId || "default",
          sessionTitle: "Agent Task Session",
          timestamp: Date.now() - 10800000,
        },
      );
    }

    return list;
  }, [sessions, currentSessionId]);

  const filteredArtifacts = useMemo(() => {
    return allArtifacts.filter((item) => {
      const matchesSearch =
        !artifactSearch ||
        item.name.toLowerCase().includes(artifactSearch.toLowerCase()) ||
        item.sessionTitle.toLowerCase().includes(artifactSearch.toLowerCase()) ||
        (item.path && item.path.toLowerCase().includes(artifactSearch.toLowerCase()));

      return matchesSearch;
    });
  }, [allArtifacts, artifactSearch]);

  const allSessionsList = useMemo(() => Object.values(sessions), [sessions]);

  const pinnedSessions = useMemo(
    () =>
      allSessionsList
        .filter((s) => s.pinned)
        .filter((s) =>
          searchQuery
            ? s.title.toLowerCase().includes(searchQuery.toLowerCase())
            : true,
        )
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt),
    [allSessionsList, searchQuery],
  );

  const orphanSessions = useMemo(
    () =>
      allSessionsList
        .filter((s) => !s.repoId)
        .filter((s) =>
          searchQuery
            ? s.title.toLowerCase().includes(searchQuery.toLowerCase())
            : true,
        )
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt),
    [allSessionsList, searchQuery],
  );

  useEffect(() => {
    setExpandedRepos(activeRepoId);
  }, [activeRepoId]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    const onFocus = () => setTick((t) => t + 1);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Tab" && e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag === "textarea" || tag === "input") {
          e.preventDefault();
          planNewIdea();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function ensureSession() {
    if (session) return session;
    return createSession({
      repoId: null,
      title: "New chat",
      activate: true,
    });
  }

  function submit(planFirst = false) {
    if (!canSend && !planFirst) return;
    const sess = ensureSession();
    const t =
      text.trim() ||
      (planFirst ? "Plan a new idea for this workspace" : "See attached files");
    onSend(t, sess.mode, activeModel, attachments, { planFirst });
    setText("");
    setAttachments([]);
  }

  function planNewIdea() {
    const sess = ensureSession();
    useSessionStore.getState().setSessionMode(sess.id, "agent");
    const t = text.trim() || "Plan a new idea for this workspace";
    onSend(t, "agent", activeModel, attachments, { planFirst: true });
    setText("");
    setAttachments([]);
  }

  function onFilesPicked(files: FileList | null) {
    if (!files?.length) return;
    const next: Attachment[] = Array.from(files).map((f, i) => ({
      id: `att-${Date.now()}-${i}`,
      name: f.name,
      kind: f.type.startsWith("image/") ? ("image" as const) : ("file" as const),
      sizeLabel:
        f.size < 1024
          ? `${f.size} B`
          : f.size < 1024 * 1024
            ? `${Math.round(f.size / 1024)} KB`
            : `${(f.size / (1024 * 1024)).toFixed(1)} MB`,
    }));
    setAttachments((prev) => [...prev, ...next]);
    toast.success(
      next.length === 1 ? "File attached" : `${next.length} files attached`,
    );
  }

  function repoSessions(repo: Repository) {
    return repo.sessions
      .map((id) => sessions[id])
      .filter(Boolean)
      .sort((a, b) => b!.lastActiveAt - a!.lastActiveAt);
  }

  void tick;
  void _planSteps;

  const hasMessages = messages && messages.length > 0;
  const branchName = currentBranch?.name ?? "main";

  function renderComposer() {
    return (
      <AgentChatComposer
        text={text}
        onTextChange={setText}
        onSubmit={() => submit()}
        onStop={onStop}
        sending={sending}
        placeholder={
          hasMessages ? "Ask for follow up changes" : "Plan, search, build anything"
        }
        models={models}
        activeModel={activeModel}
        catalogStatus={catalogStatus}
        catalogError={catalogError}
        onModelChange={(m) => {
          const sess = ensureSession();
          setSessionModel(sess.id, m.id);
        }}
        attachments={attachments}
        onRemoveAttachment={(id) =>
          setAttachments((prev) => prev.filter((x) => x.id !== id))
        }
        onAttachFiles={() => fileInputRef.current?.click()}
        onAddContext={() => openCommands()}
        fileInput={
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              onFilesPicked(e.target.files);
              e.target.value = "";
            }}
          />
        }
      />
    );
  }

  function sessionRow(
    s: { id: string; title: string; lastActiveAt: number; pinned?: boolean },
    nested?: boolean,
  ) {
    const active = s.id === currentSessionId;
    return (
      <button
        key={s.id}
        type="button"
        title={`${s.title} (Shift-click to ${s.pinned ? "unpin" : "pin"})`}
        onClick={(e) => {
          setActiveTab("chat");
          if (e.shiftKey) {
            e.preventDefault();
            togglePinSession(s.id);
            toast.message(s.pinned ? "Session unpinned" : "Session pinned");
          } else {
            setCurrentSession(s.id, true);
          }
        }}
        className={cn(
          "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left type-caption group",
          nested && "pl-2",
          active
            ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{s.title}</span>
                <div
          className="p-0.5 cursor-pointer hover:text-[var(--warning)]"
          onClick={(e) => {
            e.stopPropagation();
            togglePinSession(s.id);
          }}
        >
          {s.pinned ? (
            <Pin className="h-3.5 w-3.5 shrink-0 text-[var(--warning)]" strokeWidth={1.5} />
          ) : (
            <Pin className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)] opacity-60" strokeWidth={1.5} />
          )}
        </div>
        <span className="shrink-0 type-caption tabular-nums text-[var(--text-tertiary)]">
          {relativeFrom(s.lastActiveAt)}
        </span>
      </button>
    );
  }
  function renderArtifactsView() {
    return (
      <div className="flex flex-1 flex-col h-full overflow-hidden bg-[var(--bg-surface)] px-8 py-6">
        {/* Header */}
        <div className="flex flex-col gap-1 pb-6 border-b border-[var(--border-subtle)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] text-[var(--text-secondary)]">
                <FileText className="h-5 w-5 opacity-90" strokeWidth={1.5} />
              </div>
              <div>
                <h1 className="type-title-sm text-[var(--text-primary)]">Artifacts</h1>
                <p className="type-caption text-[var(--text-tertiary)]">
                  Files created by AI agents during task execution
                </p>
              </div>
            </div>
            <span className="rounded-full bg-[var(--success)]/10 px-3 py-1 type-caption font-medium text-[var(--success)] border border-[var(--success)]/20">
              {filteredArtifacts.length} {filteredArtifacts.length === 1 ? "created file" : "created files"}
            </span>
          </div>

          {/* Controls: Search */}
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="relative flex items-center flex-1 max-w-md">
              <Search className="absolute left-3 h-3.5 w-3.5 text-[var(--text-tertiary)]" strokeWidth={1.5} />
              <input
                type="text"
                placeholder="Search agent created files..."
                value={artifactSearch}
                onChange={(e) => setArtifactSearch(e.target.value)}
                className="h-8.5 w-full rounded-md bg-[var(--bg-surface-raised)] pl-9 pr-3 type-caption text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)] focus:bg-[var(--bg-overlay)] focus-visible:outline focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-[var(--focus-ring-offset)] focus-visible:outline-[var(--focus-ring-color)]"
              />
            </div>
          </div>
        </div>

        {/* Artifacts List */}
        <ScrollArea className="flex-1 mt-4">
          {filteredArtifacts.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pr-3 pb-6">
              {filteredArtifacts.map((art) => {
                const isImage = art.fileType === "image";
                const isCode = art.fileType === "code";
                return (
                  <div
                    key={art.id}
                  className="group relative flex flex-col justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-4 transition-[background-color,border-color] duration-[var(--duration-instant)] ease-[var(--ease-standard)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-hover)] text-[var(--text-secondary)]">
                        {isImage ? (
                          <Image className="h-5 w-5 text-purple-400" strokeWidth={1.5} />
                        ) : isCode ? (
                          <FileCode className="h-5 w-5 text-blue-400" strokeWidth={1.5} />
                        ) : (
                          <FileText className="h-5 w-5 text-emerald-400" strokeWidth={1.5} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="truncate type-caption font-medium text-[var(--text-primary)] group-hover:text-[var(--text-primary)]">
                            {art.name}
                          </h3>
                          <span className="shrink-0 rounded bg-[var(--success)]/10 px-2 py-0.5 type-caption font-medium text-[var(--success)] border border-[var(--success)]/20">
                            Created by Agent
                          </span>
                        </div>
                        {art.path && (
                          <p className="mt-0.5 truncate type-code text-[var(--text-tertiary)]">
                            {art.path}
                          </p>
                        )}
                        {art.summary && (
                          <p className="mt-1.5 line-clamp-2 type-caption leading-snug text-[var(--text-secondary)]">
                            {art.summary}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3 type-caption text-[var(--text-tertiary)]">
                      <div className="flex items-center gap-2">
                        <span className="truncate max-w-[160px] text-[var(--text-secondary)]">
                          {art.sessionTitle}
                        </span>
                        {art.sizeLabel && <span>• {art.sizeLabel}</span>}
                        {art.additions !== undefined && (
                          <span className="type-code text-[var(--success)]">
                            +{art.additions} lines
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (art.path || art.name) {
                              navigator.clipboard?.writeText(art.path || art.name);
                              toast.success("Path copied to clipboard");
                            }
                          }}
                          className="rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                          title="Copy file path"
                        >
                          <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (art.sessionId) {
                              setCurrentSession(art.sessionId, true);
                              setActiveTab("chat");
                            }
                          }}
                          className="flex items-center gap-1 rounded bg-[var(--bg-surface-raised)] px-2 py-1 type-caption font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                        >
                          <span>Open Chat</span>
                          <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center text-center">
              <FileText className="h-10 w-10 text-[var(--text-tertiary)] mb-3" strokeWidth={1.5} />
              <p className="type-caption text-[var(--text-tertiary)]">No artifacts matching search criteria</p>
            </div>
          )}
        </ScrollArea>
      </div>
    );
  }

  function renderComingSoon(tab: "capabilities" | "messaging" | "scheduled-jobs") {
    const meta = {
      capabilities: {
        title: "Capabilities",
        description: "Custom AI tools, agent capabilities, and workspace integrations are coming soon.",
        icon: Boxes,
      },
      messaging: {
        title: "Messaging",
        description: "Multi-agent communication channels and direct peer messaging are coming soon.",
        icon: MessageSquare,
      },
      "scheduled-jobs": {
        title: "Scheduled Jobs",
        description: "Automated background tasks and cron-scheduled workflows are coming soon.",
        icon: Timer,
      },
    }[tab];

    const IconComponent = meta.icon;

    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="flex flex-col items-center max-w-md">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] text-[var(--text-secondary)]">
            <IconComponent className="h-7 w-7 opacity-90" strokeWidth={1.5} />
          </div>
          <span className="mb-1 rounded-full bg-[var(--bg-hover)] px-3 py-1 type-caption-uppercase text-[var(--text-tertiary)] border border-[var(--border-subtle)]">
            Coming Soon
          </span>
          <h2 className="mt-3 type-display-sm text-[var(--text-primary)]">
            {meta.title}
          </h2>
          <p className="mt-2 type-body-md text-[var(--text-tertiary)]">
            {meta.description}
          </p>
          <button
            type="button"
            onClick={() => {
              setActiveTab("chat");
              newChat();
            }}
            className="mt-6 inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--bg-hover)] px-4 type-button text-[var(--text-primary)] transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)] hover:bg-[var(--bg-active)]"
          >
            <Bot className="h-4 w-4" strokeWidth={1.5} />
            Start New Session
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <aside
        className="flex w-[220px] shrink-0 flex-col border-r border-[var(--border-default)] bg-[var(--bg-surface)]"
        aria-label="Session navigator"
      >
        {/* Scrollable Sidebar Body */}
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col pb-2">
            {/* Top Navigation Actions */}
            <div className="flex flex-col gap-0.5 px-2 pt-3">
              <button
                type="button"
                onClick={() => {
                  setActiveTab("chat");
                  newChat();
                }}
                className={cn(
                  "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left type-caption hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                  activeTab === "chat" ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
                )}
              >
                <Bot className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.5} />
                <span className="min-w-0 flex-1 truncate font-medium">New session</span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded bg-[var(--bg-active)] px-1 py-0.5 type-caption font-sans text-[var(--text-tertiary)]">Ctrl</kbd>
                  <kbd className="rounded bg-[var(--bg-active)] px-1 py-0.5 type-caption font-sans text-[var(--text-tertiary)]">N</kbd>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("capabilities")}
                className={cn(
                  "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left type-caption hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                  activeTab === "capabilities"
                    ? "bg-[var(--bg-active)] text-[var(--text-primary)] font-medium"
                    : "text-[var(--text-secondary)]",
                )}
              >
                <Boxes className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.5} />
                <span className="min-w-0 flex-1 truncate font-medium">Capabilities</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("messaging")}
                className={cn(
                  "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left type-caption hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                  activeTab === "messaging"
                    ? "bg-[var(--bg-active)] text-[var(--text-primary)] font-medium"
                    : "text-[var(--text-secondary)]",
                )}
              >
                <MessageSquare className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.5} />
                <span className="min-w-0 flex-1 truncate font-medium">Messaging</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("artifacts")}
                className={cn(
                  "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left type-caption hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                  activeTab === "artifacts"
                    ? "bg-[var(--bg-active)] text-[var(--text-primary)] font-medium"
                    : "text-[var(--text-secondary)]",
                )}
              >
                <FileText className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.5} />
                <span className="min-w-0 flex-1 truncate font-medium">Artifacts</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("scheduled-jobs")}
                className={cn(
                  "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left type-caption hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                  activeTab === "scheduled-jobs"
                    ? "bg-[var(--bg-active)] text-[var(--text-primary)] font-medium"
                    : "text-[var(--text-secondary)]",
                )}
              >
                <Timer className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.5} />
                <span className="min-w-0 flex-1 truncate font-medium">Scheduled jobs</span>
              </button>
            </div>

            {/* Search Bar */}
            <div className="mt-3 px-2">
              <div className="relative flex items-center">
                <Search className="absolute left-2.5 h-3.5 w-3.5 text-[var(--text-tertiary)]" strokeWidth={1.5} />
                <input
                  type="text"
                  placeholder="Search sessions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface-raised)] pl-8 pr-2 type-caption text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)] focus:border-[var(--border-focus)] focus:bg-[var(--bg-overlay)]"
                />
              </div>
            </div>

            {/* PINNED Section */}
            <div className="mt-4 px-2">
              <div className="flex items-center gap-2 px-1 py-1 type-caption font-semibold tracking-wider text-[var(--text-tertiary)] uppercase">
                <LayoutGrid className="h-3 w-3 shrink-0" strokeWidth={2} />
                <span>PINNED</span>
              </div>
              {pinnedSessions.length > 0 ? (
                <ul className="flex flex-col gap-0.5 pt-0.5">
                  {pinnedSessions.map((s) => (
                    <li key={s.id}>{sessionRow(s)}</li>
                  ))}
                </ul>
              ) : (
                <div className="flex items-center gap-2 px-1 py-1 type-caption text-[var(--text-tertiary)]">
                  <Pin className="h-3.5 w-3.5 shrink-0 rotate-45" strokeWidth={1.5} />
                  <span>Shift-click a chat to pin</span>
                </div>
              )}
            </div>

            {/* PROJECTS Section */}
            <div className="mt-4 flex flex-col px-2">
              <div className="flex items-center justify-between px-1 py-1 type-caption font-semibold tracking-wider text-[var(--text-tertiary)] uppercase">
                <div className="flex items-center gap-2">
                  <LayoutGrid className="h-3 w-3 shrink-0" strokeWidth={2} />
                  <span>PROJECTS</span>
                </div>
                <button
                  type="button"
                  className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                  title="Filter projects"
                >
                  <SlidersHorizontal className="h-3 w-3" strokeWidth={1.5} />
                </button>
              </div>

              <button
                type="button"
                onClick={() => onAddFolder?.()}
                className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left type-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <FolderPlus className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.5} />
                <span className="min-w-0 flex-1 truncate font-medium">New Project</span>
              </button>

              <ul className="mt-1 flex flex-col gap-0.5">
                {orphanSessions.map((s) => (
                  <li key={s.id}>{sessionRow(s)}</li>
                ))}
                {repositories.map((repo) => {
                  const expanded = expandedRepos === repo.id || activeRepoId === repo.id;
                  const nested = repoSessions(repo);
                  return (
                    <li key={repo.id} className="group/repo">
                      <div className="flex h-8 w-full items-center gap-1 rounded-md px-1">
                        <button
                          type="button"
                          title={repo.name}
                          onClick={() => {
                            openRepository(repo.id);
                            setExpandedRepos((prev) =>
                              prev === repo.id ? null : repo.id,
                            );
                          }}
                          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left hover:bg-[var(--bg-hover)]"
                        >
                          <Folder
                            className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]"
                            strokeWidth={1.5}
                          />
                          <span className="min-w-0 flex-1 truncate type-caption text-[var(--text-secondary)]">
                            {repo.name}
                          </span>
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 hover:bg-[var(--bg-hover)] group-hover/repo:opacity-100"
                              aria-label={`${repo.name} menu`}
                            >
                              <MoreHorizontal
                                className="h-3.5 w-3.5 text-[var(--text-tertiary)]"
                                strokeWidth={1.5}
                              />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem
                              onClick={() => {
                                const name = window.prompt(
                                  "Rename repository",
                                  repo.name,
                                );
                                if (name) renameRepository(repo.id, name);
                              }}
                            >
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                void revealInFolder(repo.path).then((ok) => {
                                  if (!ok) {
                                    toast.error("Couldn’t open folder", {
                                      description: repo.path,
                                    });
                                  }
                                });
                              }}
                            >
                              Open in file explorer
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => {
                                removeRepository(repo.id);
                                toast.message("Repository removed");
                              }}
                            >
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      {expanded && nested.length > 0 && (
                        <ul className="mb-1 ml-2 flex flex-col gap-0.5">
                          {nested.map((s) =>
                            s ? <li key={s.id}>{sessionRow(s, true)}</li> : null,
                          )}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </ScrollArea>

        <div className="flex h-12 shrink-0 items-center gap-2 border-t border-[var(--border-subtle)] px-3">
          <UserAccountMenu showLabel />
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="Layout"
            title="Layout"
          >
            <LayoutGrid className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="Settings"
            title="Settings · Ctrl+,"
            onClick={() => onOpenSettings?.()}
          >
            <Settings className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col bg-[var(--bg-canvas)]">
        {activeTab === "artifacts" ? (
          renderArtifactsView()
        ) : activeTab !== "chat" ? (
          renderComingSoon(activeTab)
        ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* Header Bar */}
          <div className="lens-chat-session-header flex min-h-12 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2 bg-[var(--bg-surface)]">
            <div className="flex h-8 min-w-0 flex-1 items-center gap-2">
              <span className="max-w-[220px] truncate type-caption font-medium text-[var(--text-primary)]">
                {session?.title ?? "New chat"}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-7 max-w-[180px] items-center gap-2 rounded-full bg-[var(--bg-surface-raised)] px-2.5 type-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  >
                    <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" strokeWidth={1.5} />
                    <span className="truncate">{activeRepo?.name ?? "lens"}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuItem
                    onClick={() => {
                      const sess = ensureSession();
                      setSessionRepo(sess.id, null);
                    }}
                  >
                    No project
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {repositories.map((p) => (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => {
                        const sess = ensureSession();
                        setSessionRepo(sess.id, p.id);
                      }}
                    >
                      <Folder className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} />
                      {p.name}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onAddFolder?.()}>
                    <FolderPlus className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} />
                    Open folder…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {activeRepo && (
                <>
                  <Popover open={headerBranchOpen} onOpenChange={setHeaderBranchOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-7 items-center gap-2 rounded-full bg-[var(--bg-surface-raised)] px-2.5 type-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      >
                        <GitBranch className="h-3.5 w-3.5 text-[var(--text-secondary)]" strokeWidth={1.5} />
                        <span>{branchName}</span>
                        <ChevronDown className="h-3 w-3 text-[var(--text-tertiary)]" strokeWidth={2} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[280px] rounded-xl border-[var(--border-default)] bg-[var(--bg-overlay)] p-0"
                    >
                      <GitBranchPicker onClose={() => setHeaderBranchOpen(false)} />
                    </PopoverContent>
                  </Popover>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                        aria-label="Chat options"
                      >
                        <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-44">
                      <DropdownMenuItem
                        onClick={() => {
                          if (!session) return;
                          const name = window.prompt("Rename chat", session.title);
                          if (name?.trim()) renameSession(session.id, name.trim());
                        }}
                      >
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          if (session) closeSessionTab(session.id);
                        }}
                      >
                        Close chat
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>

            <div className="flex items-center h-full">
              <LayoutToolbar
                sidePaneOpen={agentsDock !== null}
                onToggleSidePane={onToggleSidePane}
                onOpenTerminal={onOpenTerminal}
              />
            </div>
          </div>

          {!hasMessages ? (
            <>
              <div className="flex flex-1 flex-col items-center justify-center px-6">
                <div className="w-full max-w-[720px]">
                  <div className="mb-3 flex flex-wrap items-center justify-center gap-3 type-caption text-[var(--text-tertiary)]">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 hover:text-[var(--text-tertiary)]"
                        >
                          <Folder className="h-3.5 w-3.5" strokeWidth={1.5} />
                          <span className="max-w-[160px] truncate">
                            {activeRepo?.name ?? "No project"}
                          </span>
                          <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-56">
                        <DropdownMenuItem
                          onClick={() => {
                            const sess = ensureSession();
                            setSessionRepo(sess.id, null);
                          }}
                        >
                          No project
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {repositories.map((p) => (
                          <DropdownMenuItem
                            key={p.id}
                            onClick={() => {
                              const sess = ensureSession();
                              setSessionRepo(sess.id, p.id);
                            }}
                          >
                            <Folder className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} />
                            {p.name}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onAddFolder?.()}>
                          <FolderPlus className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} />
                          Open folder…
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 hover:text-[var(--text-tertiary)]"
                        >
                          {location === "this-pc" ? (
                            <Monitor className="h-3 w-3" strokeWidth={1.5} />
                          ) : (
                            <Cloud className="h-3 w-3" strokeWidth={1.5} />
                          )}
                          <span>
                            {location === "this-pc" ? "This PC" : "Cloud Agents"}
                          </span>
                          <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-48">
                        <DropdownMenuItem onClick={() => setLocation("this-pc")}>
                          <Monitor className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} />
                          This PC
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled
                          className="cursor-not-allowed opacity-50"
                          onSelect={(e) => e.preventDefault()}
                        >
                          <Cloud className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} />
                          Cloud Agents
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {renderComposer()}

                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={planNewIdea}
                      className="inline-flex h-8 items-center gap-2 rounded-full border border-[var(--border-subtle)] px-3.5 type-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    >
                      Plan New Idea
                      <span className="type-caption tabular-nums text-[var(--text-tertiary)]">
                        ⇧Tab
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={onMultitask}
                      className="inline-flex h-8 items-center rounded-full border border-[var(--border-subtle)] px-3.5 type-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    >
                      Multitask
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center justify-center px-6 pb-6">
                <button
                  type="button"
                  onClick={onImport}
                  className="inline-flex max-w-md items-center gap-2.5 rounded-lg px-3 py-2 type-caption text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                  <span>
                    Import conversations — sync chats and continue them here
                  </span>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                <ChatWindow
                  messages={messages}
                  sending={sending}
                  restoringId={restoringId}
                  onRestoreCheckpoint={onRestoreCheckpoint ?? (() => {})}
                  onPromptSelect={(prompt) => setText(prompt)}
                  streamingContent=""
                  pendingToolCalls={undefined}
                />
              </div>

              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[var(--bg-canvas)] via-[var(--bg-canvas)]/90 to-transparent px-6 pb-6 pt-10">
                <div className="pointer-events-auto mx-auto w-full max-w-[760px]">
                  {renderComposer()}
                </div>
              </div>
            </>
          )}
        </div>
        )}
        {terminalOpen && (
          <TerminalPanel
            cwd={activeRepo?.path}
            projectName={activeRepo?.name}
            onClose={onCloseTerminal}
          />
        )}
      </div>
    </div>
  );
}

export default EmptySessionView;
