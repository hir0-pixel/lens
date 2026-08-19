import {
  ArrowLeft,
  ArrowRight,
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
}

/**
 * Cursor-style agents home — sidebar, transcript, floating composer.
 */
export function EmptySessionView({
  model: fallbackModel,
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
  const historyIndex = useSessionStore((s) => s.historyIndex);
  const historyLen = useSessionStore((s) => s.historyStack.length);
  const goBack = useSessionStore((s) => s.goBack);
  const goForward = useSessionStore((s) => s.goForward);

  const session = currentSessionId ? sessions[currentSessionId] : null;
  const activeModel =
    MODELS.find((m) => m.id === (session?.modelId ?? fallbackModel.id)) ??
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
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex >= 0 && historyIndex < historyLen - 1;

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
        models={MODELS}
        activeModel={activeModel}
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
          "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] group",
          nested && "pl-2",
          active
            ? "bg-white/[0.08] text-[#ececec]"
            : "text-[#8a8a8a] hover:bg-white/[0.05] hover:text-[#d4d4d4]",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{s.title}</span>
                <div
          className="p-0.5 cursor-pointer hover:text-yellow-400"
          onClick={(e) => {
            e.stopPropagation();
            togglePinSession(s.id);
          }}
        >
          {s.pinned ? (
            <Pin className="h-3.5 w-3.5 shrink-0 text-yellow-400" strokeWidth={1.5} />
          ) : (
            <Pin className="h-3.5 w-3.5 shrink-0 text-[#666] opacity-60" strokeWidth={1.5} />
          )}
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-[#666]">
          {relativeFrom(s.lastActiveAt)}
        </span>
      </button>
    );
  }
  function renderArtifactsView() {
    return (
      <div className="flex flex-1 flex-col h-full overflow-hidden bg-[#111111] px-8 py-6">
        {/* Header */}
        <div className="flex flex-col gap-1 pb-6 border-b border-white/[0.08]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-[#e8e8e8]">
                <FileText className="h-5 w-5 opacity-90" strokeWidth={1.5} />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-[#f0f0f0]">Artifacts</h1>
                <p className="text-[12.5px] text-[#8a8a8a]">
                  Files created by AI agents during task execution
                </p>
              </div>
            </div>
            <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-[11.5px] font-medium text-emerald-400 border border-emerald-500/20">
              {filteredArtifacts.length} {filteredArtifacts.length === 1 ? "created file" : "created files"}
            </span>
          </div>

          {/* Controls: Search */}
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="relative flex items-center flex-1 max-w-md">
              <Search className="absolute left-3 h-3.5 w-3.5 text-[#555]" strokeWidth={1.5} />
              <input
                type="text"
                placeholder="Search agent created files..."
                value={artifactSearch}
                onChange={(e) => setArtifactSearch(e.target.value)}
                className="h-8.5 w-full rounded-md bg-white/[0.04] pl-9 pr-3 text-[12px] text-[#e8e8e8] placeholder-[#555] outline-none transition-colors focus:bg-white/[0.07] focus:ring-1 focus:ring-white/10"
              />
            </div>
          </div>
        </div>

        {/* Artifacts List */}
        <ScrollArea className="flex-1 mt-4">
          {filteredArtifacts.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pr-3 pb-6">
              {filteredArtifacts.map((art) => {
                const isImage = art.fileType === "image";
                const isCode = art.fileType === "code";
                return (
                  <div
                    key={art.id}
                    className="group relative flex flex-col justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 hover:border-white/[0.15] hover:bg-white/[0.04] transition-all"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-[#d4d4d4]">
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
                          <h3 className="truncate text-[13.5px] font-medium text-[#eee] group-hover:text-white">
                            {art.name}
                          </h3>
                          <span className="shrink-0 rounded bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-medium text-emerald-400 border border-emerald-500/20">
                            Created by Agent
                          </span>
                        </div>
                        {art.path && (
                          <p className="mt-0.5 truncate text-[11.5px] font-mono text-[#666]">
                            {art.path}
                          </p>
                        )}
                        {art.summary && (
                          <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-[#999]">
                            {art.summary}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-white/[0.05] pt-3 text-[11.5px] text-[#777]">
                      <div className="flex items-center gap-2">
                        <span className="truncate max-w-[160px] text-[#aaa]">
                          {art.sessionTitle}
                        </span>
                        {art.sizeLabel && <span>• {art.sizeLabel}</span>}
                        {art.additions !== undefined && (
                          <span className="font-mono text-[11px] text-emerald-400">
                            +{art.additions} lines
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (art.path || art.name) {
                              navigator.clipboard?.writeText(art.path || art.name);
                              toast.success("Path copied to clipboard");
                            }
                          }}
                          className="rounded p-1 text-[#777] hover:bg-white/[0.08] hover:text-[#d4d4d4]"
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
                          className="flex items-center gap-1 rounded bg-white/[0.06] px-2 py-1 text-[11px] font-medium text-[#c8c8c8] hover:bg-white/[0.12] hover:text-white"
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
              <FileText className="h-10 w-10 text-[#444] mb-3" strokeWidth={1.5} />
              <p className="text-[13px] text-[#8a8a8a]">No artifacts matching search criteria</p>
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
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-[#e8e8e8] shadow-inner">
            <IconComponent className="h-7 w-7 opacity-90" strokeWidth={1.5} />
          </div>
          <span className="mb-1 rounded-full bg-white/[0.06] px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#a0a0a0] border border-white/[0.06]">
            Coming Soon
          </span>
          <h2 className="mt-3 text-xl font-semibold tracking-tight text-[#f0f0f0]">
            {meta.title}
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-[#8a8a8a]">
            {meta.description}
          </p>
          <button
            type="button"
            onClick={() => {
              setActiveTab("chat");
              newChat();
            }}
            className="mt-6 inline-flex h-9 items-center gap-2 rounded-lg bg-white/[0.08] px-4 text-[13px] font-medium text-[#e8e8e8] hover:bg-white/[0.12] transition-colors"
          >
            <Bot className="h-4 w-4" strokeWidth={1.5} />
            Start New Session
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 bg-[#111111]">
      <aside
        className="flex w-[244px] shrink-0 flex-col border-r border-white/[0.06] bg-[#161616]"
        aria-label="Session navigator"
      >
        <div className="flex items-center gap-1 px-3.5 pt-3 pb-1">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white/[0.08] text-[12px] font-semibold text-[#e8e8e8]">
            L
          </span>
          <button
            type="button"
            aria-label="Back"
            disabled={!canGoBack}
            onClick={() => goBack()}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md",
              canGoBack
                ? "text-[#b0b0b0] hover:bg-white/[0.06] hover:text-[#e8e8e8]"
                : "cursor-not-allowed text-[#555]",
            )}
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label="Forward"
            disabled={!canGoForward}
            onClick={() => goForward()}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md",
              canGoForward
                ? "text-[#b0b0b0] hover:bg-white/[0.06] hover:text-[#e8e8e8]"
                : "cursor-not-allowed text-[#555]",
            )}
          >
            <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* Scrollable Sidebar Body */}
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col pb-2">
            {/* Top Navigation Actions */}
            <div className="flex flex-col gap-0.5 px-2">
              <button
                type="button"
                onClick={() => {
                  setActiveTab("chat");
                  newChat();
                }}
                className={cn(
                  "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] hover:bg-white/[0.06] hover:text-[#e8e8e8]",
                  activeTab === "chat" ? "text-[#c8c8c8]" : "text-[#8a8a8a]",
                )}
              >
                <Bot className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.5} />
                <span className="min-w-0 flex-1 truncate font-medium">New session</span>
                <span className="flex items-center gap-0.5">
                  <kbd className="rounded bg-white/10 px-1 py-0.5 text-[10px] font-sans text-[#777]">Ctrl</kbd>
                  <kbd className="rounded bg-white/10 px-1 py-0.5 text-[10px] font-sans text-[#777]">N</kbd>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("capabilities")}
                className={cn(
                  "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] hover:bg-white/[0.06] hover:text-[#e8e8e8]",
                  activeTab === "capabilities"
                    ? "bg-white/[0.08] text-[#ececec] font-medium"
                    : "text-[#c8c8c8]",
                )}
              >
                <Boxes className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.5} />
                <span className="min-w-0 flex-1 truncate font-medium">Capabilities</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("messaging")}
                className={cn(
                  "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] hover:bg-white/[0.06] hover:text-[#e8e8e8]",
                  activeTab === "messaging"
                    ? "bg-white/[0.08] text-[#ececec] font-medium"
                    : "text-[#c8c8c8]",
                )}
              >
                <MessageSquare className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.5} />
                <span className="min-w-0 flex-1 truncate font-medium">Messaging</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("artifacts")}
                className={cn(
                  "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] hover:bg-white/[0.06] hover:text-[#e8e8e8]",
                  activeTab === "artifacts"
                    ? "bg-white/[0.08] text-[#ececec] font-medium"
                    : "text-[#c8c8c8]",
                )}
              >
                <FileText className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.5} />
                <span className="min-w-0 flex-1 truncate font-medium">Artifacts</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("scheduled-jobs")}
                className={cn(
                  "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] hover:bg-white/[0.06] hover:text-[#e8e8e8]",
                  activeTab === "scheduled-jobs"
                    ? "bg-white/[0.08] text-[#ececec] font-medium"
                    : "text-[#c8c8c8]",
                )}
              >
                <Timer className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.5} />
                <span className="min-w-0 flex-1 truncate font-medium">Scheduled jobs</span>
              </button>
            </div>

            {/* Search Bar */}
            <div className="mt-3 px-2">
              <div className="relative flex items-center">
                <Search className="absolute left-2.5 h-3.5 w-3.5 text-[#555]" strokeWidth={1.5} />
                <input
                  type="text"
                  placeholder="Search sessions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 w-full rounded-md bg-white/[0.04] pl-8 pr-2 text-[12px] text-[#e8e8e8] placeholder-[#555] outline-none transition-colors focus:bg-white/[0.07] focus:ring-1 focus:ring-white/10"
                />
              </div>
            </div>

            {/* PINNED Section */}
            <div className="mt-4 px-2">
              <div className="flex items-center gap-1.5 px-1 py-1 text-[11px] font-bold tracking-wider text-[#7a7a7a] uppercase">
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
                <div className="flex items-center gap-2 px-1 py-1 text-[12px] text-[#666]">
                  <Pin className="h-3.5 w-3.5 shrink-0 rotate-45" strokeWidth={1.5} />
                  <span>Shift-click a chat to pin</span>
                </div>
              )}
            </div>

            {/* PROJECTS Section */}
            <div className="mt-4 flex flex-col px-2">
              <div className="flex items-center justify-between px-1 py-1 text-[11px] font-bold tracking-wider text-[#7a7a7a] uppercase">
                <div className="flex items-center gap-1.5">
                  <LayoutGrid className="h-3 w-3 shrink-0" strokeWidth={2} />
                  <span>PROJECTS</span>
                </div>
                <button
                  type="button"
                  className="text-[#666] hover:text-[#aaa]"
                  title="Filter projects"
                >
                  <SlidersHorizontal className="h-3 w-3" strokeWidth={1.5} />
                </button>
              </div>

              <button
                type="button"
                onClick={() => onAddFolder?.()}
                className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] text-[#c8c8c8] hover:bg-white/[0.06] hover:text-[#e8e8e8]"
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
                      <div className="flex h-8 w-full items-center gap-0.5 rounded-md px-1">
                        <button
                          type="button"
                          title={repo.name}
                          onClick={() => {
                            openRepository(repo.id);
                            setExpandedRepos((prev) =>
                              prev === repo.id ? null : repo.id,
                            );
                          }}
                          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left hover:bg-white/[0.05]"
                        >
                          <Folder
                            className="h-3.5 w-3.5 shrink-0 text-[#6a6a6a]"
                            strokeWidth={1.5}
                          />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-[#c8c8c8]">
                            {repo.name}
                          </span>
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 hover:bg-white/[0.08] group-hover/repo:opacity-100"
                              aria-label={`${repo.name} menu`}
                            >
                              <MoreHorizontal
                                className="h-3.5 w-3.5 text-[#888]"
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

        <div className="flex h-12 shrink-0 items-center gap-2 border-t border-white/[0.06] px-3">
          <UserAccountMenu showLabel />
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-[#666] hover:bg-white/[0.06] hover:text-[#b0b0b0]"
            aria-label="Layout"
            title="Layout"
          >
            <LayoutGrid className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-[#666] hover:bg-white/[0.06] hover:text-[#b0b0b0]"
            aria-label="Settings"
            title="Settings · Ctrl+,"
            onClick={() => onOpenSettings?.()}
          >
            <Settings className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col bg-[#111111]">
        {activeTab === "artifacts" ? (
          renderArtifactsView()
        ) : activeTab !== "chat" ? (
          renderComingSoon(activeTab)
        ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          {!hasMessages ? (
          <>
            <div className="flex flex-1 flex-col items-center justify-center px-6">
              <div className="w-full max-w-[720px]">
                <div className="mb-3 flex flex-wrap items-center gap-3 text-[12px] text-[#6b6b6b]">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 hover:text-[#9a9a9a]"
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
                        className="inline-flex items-center gap-1.5 hover:text-[#9a9a9a]"
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
                    className="inline-flex h-8 items-center gap-2 rounded-full border border-white/[0.1] px-3.5 text-[12px] text-[#b0b0b0] hover:bg-white/[0.04] hover:text-[#e8e8e8]"
                  >
                    Plan New Idea
                    <span className="text-[11px] tabular-nums text-[#555]">
                      ⇧Tab
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={onMultitask}
                    className="inline-flex h-8 items-center rounded-full border border-white/[0.1] px-3.5 text-[12px] text-[#b0b0b0] hover:bg-white/[0.04] hover:text-[#e8e8e8]"
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
                className="inline-flex max-w-md items-center gap-2.5 rounded-lg px-3 py-2 text-[12px] text-[#555] hover:bg-white/[0.03] hover:text-[#8a8a8a]"
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
            <div className="flex min-h-12 shrink-0 items-start gap-2 px-4 pb-2 pt-2">
              <div className="flex h-8 min-w-0 flex-1 items-center gap-2">
                <span className="max-w-[220px] truncate text-[13.5px] font-medium leading-8 text-[#f2f2f2]">
                  {session?.title ?? "New chat"}
                </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-7 max-w-[180px] items-center gap-1.5 rounded-full bg-[#2a2a2a] px-2.5 text-[12.5px] text-[#d4d4d4] hover:bg-[#333]"
                  >
                    <Folder className="h-3.5 w-3.5 shrink-0 text-[#b0b0b0]" strokeWidth={1.5} />
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
              <Popover open={headerBranchOpen} onOpenChange={setHeaderBranchOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#2a2a2a] px-2.5 text-[12.5px] text-[#d4d4d4] hover:bg-[#333]"
                  >
                    <GitBranch className="h-3.5 w-3.5 text-[#b0b0b0]" strokeWidth={1.5} />
                    <span>{branchName}</span>
                    <ChevronDown className="h-3 w-3 text-[#8a8a8a]" strokeWidth={2} />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-[280px] rounded-xl border-white/[0.1] bg-[#1c1c1c] p-0"
                >
                  <GitBranchPicker onClose={() => setHeaderBranchOpen(false)} />
                </PopoverContent>
              </Popover>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[#8a8a8a] hover:bg-white/[0.06] hover:text-[#d4d4d4]"
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
              </div>
            </div>

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

            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#111111] via-[#111111]/90 to-transparent px-6 pb-4 pt-10">
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
