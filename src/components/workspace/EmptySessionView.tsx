import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Cloud,
  Folder,
  FolderPlus,
  GitBranch,
  LayoutGrid,
  Monitor,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { AIMode, Attachment, Model, ChatMessage } from "@/lib/types";
import { MODELS } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { ChatWindow } from "@/components/ai/ChatWindow";
import { AgentChatComposer } from "@/components/ai/AgentChatComposer";
import { revealInFolder } from "@/features/projects/revealInFolder";
import { useGitStore } from "@/stores/gitStore";
import { GitToolsCard } from "@/components/workspace/GitToolsCard";
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

const NAV_ROWS: {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  shortcut?: string;
}[] = [
  { id: "new", label: "New task", icon: Plus, shortcut: "Ctrl+N" },
  { id: "search", label: "Search", icon: Search, shortcut: "Ctrl+K" },
  { id: "automations", label: "Automations", icon: Workflow },
  { id: "skills", label: "Skills", icon: Sparkles },
];

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
  onOpenAutomations,
  onAddFolder,
  onImport,
  onMultitask,
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
  const [groups, setGroups] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openCommands = useCommandStore((s) => s.openCommands);
  const currentBranch = useGitStore((s) => s.branches.find((b) => b.current));
  const [headerBranchOpen, setHeaderBranchOpen] = useState(false);

  const canSend = text.trim().length > 0 || attachments.length > 0;

  const orphanSessions = useMemo(
    () =>
      Object.values(sessions)
        .filter((s) => !s.repoId)
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt),
    [sessions],
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
    s: { id: string; title: string; lastActiveAt: number },
    nested?: boolean,
  ) {
    const active = s.id === currentSessionId;
    return (
      <button
        key={s.id}
        type="button"
        title={s.title}
        onClick={() => setCurrentSession(s.id, true)}
        className={cn(
          "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]",
          nested && "pl-2",
          active
            ? "bg-white/[0.08] text-[#ececec]"
            : "text-[#8a8a8a] hover:bg-white/[0.05] hover:text-[#d4d4d4]",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{s.title}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-[#666]">
          {relativeFrom(s.lastActiveAt)}
        </span>
      </button>
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

        <div className="mt-1 flex flex-col gap-0.5 px-2">
          {NAV_ROWS.map(({ id, label, icon: Icon, shortcut }) => (
            <button
              key={id}
              type="button"
              title={shortcut ? `${label} · ${shortcut}` : label}
              onClick={() => {
                if (id === "new") newChat();
                else if (id === "search") openCommands();
                else if (id === "automations") onOpenAutomations?.();
                else if (id === "skills") onOpenSettings?.("ai");
              }}
              className={cn(
                "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px]",
                "text-[#b0b0b0] transition-colors duration-100",
                "hover:bg-white/[0.06] hover:text-[#e8e8e8]",
              )}
            >
              <Icon className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.5} />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {shortcut && (
                <span className="shrink-0 text-[11px] tabular-nums text-[#666]">
                  {shortcut}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-1 px-3">
          <button
            type="button"
            onClick={() => {
              const name = window.prompt("Group name");
              if (name?.trim()) setGroups((g) => [...g, name.trim()]);
            }}
            className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-[#8a8a8a] hover:bg-white/[0.05] hover:text-[#d4d4d4]"
          >
            <Plus className="h-3 w-3" strokeWidth={2} />
            Group
          </button>
          <button
            type="button"
            onClick={() => onAddFolder?.()}
            className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-[#8a8a8a] hover:bg-white/[0.05] hover:text-[#d4d4d4]"
          >
            <Plus className="h-3 w-3" strokeWidth={2} />
            Project
          </button>
        </div>

        <div className="mt-3 px-3.5 pb-1 text-[11px] font-medium tracking-wide text-[#6a6a6a]">
          Projects
        </div>

        {groups.map((g) => (
          <div
            key={g}
            className="mx-2 mb-0.5 truncate rounded-md px-2 py-1 text-[12px] text-[#8a8a8a]"
          >
            {g}
          </div>
        ))}

        <ScrollArea className="min-h-0 flex-1 px-1.5">
          <ul className="flex flex-col gap-0.5 pb-2">
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
        </ScrollArea>

        <div className="flex h-12 shrink-0 items-center gap-2 border-t border-white/[0.06] px-3">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 hover:bg-white/[0.05]"
            title="Account"
            onClick={() => onOpenSettings?.("general")}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#3a3a3a] text-[11px] font-medium text-[#ececec]">
              A
            </span>
            <span className="min-w-0 truncate text-[13px] text-[#c8c8c8]">
              Account
            </span>
          </button>
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
              <div className="ml-auto shrink-0">
                <GitToolsCard />
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
    </div>
  );
}

export default EmptySessionView;
