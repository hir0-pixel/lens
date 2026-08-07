import {
  ChevronDown,
  Cloud,
  Folder,
  FolderPlus,
  ListFilter,
  Mic,
  Monitor,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Settings,
  Sparkles,
  Workflow,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { AIMode, Attachment, Model } from "@/lib/types";
import { MODELS } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { ProviderDot } from "@/shared/design-system/ProviderDot";
import { revealInFolder } from "@/features/projects/revealInFolder";
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
  type Repository,
} from "@/stores/sessionStore";

const MODES: { id: AIMode; label: string }[] = [
  { id: "agent", label: "Agent" },
  { id: "ask", label: "Ask" },
  { id: "edit", label: "Edit" },
];

const NAV_ROWS: {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  shortcut?: string;
}[] = [
  { id: "new", label: "New Chat", icon: Plus, shortcut: "Ctrl+N" },
  { id: "search", label: "Search", icon: Search },
  { id: "automations", label: "Automations", icon: Workflow },
  { id: "customize", label: "Customize", icon: Wrench },
];

type LocationScope = "this-pc" | "cloud";

interface EmptySessionViewProps {
  model: Model;
  onSend: (
    text: string,
    mode: AIMode,
    model: Model,
    attachments?: Attachment[],
    opts?: { planFirst?: boolean },
  ) => void;
  onOpenSettings?: (section?: string) => void;
  onOpenAutomations?: () => void;
  onAddFolder?: () => void;
  onImport?: () => void;
  onMultitask?: () => void;
}

/**
 * Cursor-style empty / new-session home — wired to sessionStore.
 */
export function EmptySessionView({
  model: fallbackModel,
  onSend,
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
  const setSessionMode = useSessionStore((s) => s.setSessionMode);
  const setSessionModel = useSessionStore((s) => s.setSessionModel);
  const renameRepository = useSessionStore((s) => s.renameRepository);
  const removeRepository = useSessionStore((s) => s.removeRepository);
  const createSession = useSessionStore((s) => s.createSession);

  const session = currentSessionId ? sessions[currentSessionId] : null;
  const mode = session?.mode ?? "ask";
  const activeModel =
    MODELS.find((m) => m.id === (session?.modelId ?? fallbackModel.id)) ??
    fallbackModel;
  const activeRepoId = session?.repoId ?? null;
  const activeRepo = repositories.find((r) => r.id === activeRepoId) ?? null;

  const [text, setText] = useState("");
  const [expandedRepos, setExpandedRepos] = useState<string | null>(
    activeRepoId,
  );
  const [repoFilter, setRepoFilter] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [location, setLocation] = useState<LocationScope>("this-pc");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [tick, setTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openCommands = useCommandStore((s) => s.openCommands);

  const canSend = text.trim().length > 0 || attachments.length > 0;

  const filteredRepos = useMemo(() => {
    const q = repoFilter.trim().toLowerCase();
    if (!q) return repositories;
    return repositories.filter((p) => p.name.toLowerCase().includes(q));
  }, [repositories, repoFilter]);

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
    const t = text.trim() || (planFirst ? "Plan a new idea for this workspace" : "See attached files");
    onSend(t, sess.mode, activeModel, attachments, { planFirst });
    setText("");
    setAttachments([]);
  }

  function planNewIdea() {
    const sess = ensureSession();
    setSessionMode(sess.id, "agent");
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

  return (
    <div className="flex min-h-0 flex-1 bg-[#0a0a0a]">
      <aside
        className="flex w-[250px] shrink-0 flex-col border-r border-white/[0.06] bg-[#141414]"
        aria-label="Session navigator"
      >
        <div className="flex flex-col gap-0.5 px-2 pt-2">
          {NAV_ROWS.map(({ id, label, icon: Icon, shortcut }) => (
            <button
              key={id}
              type="button"
              title={shortcut ? `${label} · ${shortcut}` : label}
              onClick={() => {
                if (id === "new") newChat();
                else if (id === "search") openCommands();
                else if (id === "automations") onOpenAutomations?.();
                else if (id === "customize") onOpenSettings?.("appearance");
              }}
              className={cn(
                "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px]",
                "text-[#b0b0b0] transition-colors duration-100",
                "hover:bg-white/[0.06] hover:text-[#e8e8e8]",
                id === "new" && "bg-white/[0.06] text-[#e8e8e8]",
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

        <div className="mt-4 flex items-center gap-1 px-3.5 pb-1.5">
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium tracking-wide text-[#666]">
            Repositories
          </span>
          <button
            type="button"
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded text-[#666] hover:bg-white/[0.06] hover:text-[#b0b0b0]",
              filterOpen && "bg-white/[0.06] text-[#b0b0b0]",
            )}
            aria-label="Filter repositories"
            title="Filter"
            onClick={() => setFilterOpen((v) => !v)}
          >
            <ListFilter className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded text-[#666] hover:bg-white/[0.06] hover:text-[#b0b0b0]"
            aria-label="Add folder"
            title="Add folder"
            onClick={() => onAddFolder?.()}
          >
            <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </div>

        {filterOpen && (
          <div className="px-3 pb-2">
            <input
              value={repoFilter}
              onChange={(e) => setRepoFilter(e.target.value)}
              placeholder="Filter repositories…"
              className="h-7 w-full rounded-md border border-white/[0.08] bg-[#0a0a0a] px-2 text-[12px] text-[#d4d4d4] placeholder:text-[#555] focus:outline-none focus:ring-1 focus:ring-white/20"
              autoFocus
            />
          </div>
        )}

        <ScrollArea className="min-h-0 flex-1 px-1.5">
          <ul className="flex flex-col gap-0.5 pb-2">
            {filteredRepos.map((repo) => {
              const expanded = expandedRepos === repo.id;
              const nested = repoSessions(repo);
              return (
                <li key={repo.id} className="group/repo">
                  <div
                    className={cn(
                      "flex h-8 w-full items-center gap-1 rounded-md px-1",
                      activeRepoId === repo.id && "bg-white/[0.05]",
                    )}
                  >
                    <button
                      type="button"
                      title={repo.name}
                      onClick={() => {
                        openRepository(repo.id);
                        setExpandedRepos((prev) =>
                          prev === repo.id ? null : repo.id,
                        );
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-white/[0.06]"
                    >
                      <Folder
                        className="h-3.5 w-3.5 shrink-0 text-[#666]"
                        strokeWidth={1.5}
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-[#d4d4d4]">
                        {repo.name}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-[#555]">
                        {relativeFrom(repo.lastOpenedAt)}
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
                            const name = window.prompt("Rename repository", repo.name);
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
                    <ul className="mb-1 ml-3.5 flex flex-col gap-0.5 border-l border-white/[0.06] pl-2">
                      {nested.map((s) =>
                        s ? (
                          <li key={s.id}>
                            <button
                              type="button"
                              title={s.title}
                              onClick={() => setCurrentSession(s.id, true)}
                              className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-[#8a8a8a] hover:bg-white/[0.06] hover:text-[#d4d4d4]"
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {s.title}
                              </span>
                              <span className="shrink-0 text-[11px] tabular-nums text-[#555]">
                                {relativeFrom(s.lastActiveAt)}
                              </span>
                            </button>
                          </li>
                        ) : null,
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </ScrollArea>

        <div className="flex h-11 shrink-0 items-center gap-2 border-t border-white/[0.06] px-3">
          <button
            type="button"
            className="flex h-7 items-center gap-2 rounded-md px-1 text-[#8a8a8a] hover:bg-white/[0.06]"
            title="Account"
            onClick={() => onOpenSettings?.("general")}
          >
            <div className="flex h-6 w-6 flex-col justify-center gap-[3px] px-1" aria-hidden>
              <span className="h-px w-full bg-[#555]" />
              <span className="h-px w-full bg-[#555]" />
            </div>
          </button>
          <span className="min-w-0 flex-1" />
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

      <div className="relative flex min-w-0 flex-1 flex-col bg-[#0a0a0a]">
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <div className="w-full max-w-[620px]">
            <div className="mb-3 flex flex-wrap items-center gap-4 text-[12px] text-[#6b6b6b]">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-[#9a9a9a]"
                  >
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
                    title="Cloud Agents require a connected Orchids account"
                    onSelect={(e) => e.preventDefault()}
                  >
                    <Cloud className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} />
                    Cloud Agents
                    <span className="ml-auto text-[10px] uppercase text-[var(--text-tertiary)]">
                      Soon
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="rounded-xl border border-white/[0.1] bg-[#1a1a1a]">
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-3 pt-3">
                  {attachments.map((a) => (
                    <span
                      key={a.id}
                      className="inline-flex items-center gap-1 rounded-md bg-white/[0.06] px-2 py-1 text-[11px] text-[#b0b0b0]"
                    >
                      <Paperclip className="h-3 w-3" strokeWidth={1.5} />
                      <span className="max-w-[120px] truncate">{a.name}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${a.name}`}
                        onClick={() =>
                          setAttachments((prev) =>
                            prev.filter((x) => x.id !== a.id),
                          )
                        }
                      >
                        <X className="h-3 w-3" strokeWidth={2} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={1}
                placeholder="Ask questions"
                className="max-h-[160px] min-h-[48px] w-full resize-none border-0 bg-transparent px-4 pt-3.5 text-[14px] text-[#e8e8e8] placeholder:text-[#5a5a5a] focus:outline-none"
              />
              <div className="flex items-center gap-1.5 px-3 pb-3">
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
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded-full text-[#8a8a8a] hover:bg-white/[0.06]"
                      aria-label="Attach"
                    >
                      <Plus className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    <DropdownMenuItem
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Paperclip className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} />
                      Attach files…
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openCommands()}>
                      <Search className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} />
                      Add context…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-7 items-center gap-1 rounded-full bg-[#1e3a2f] px-2.5 text-[12px] font-medium text-[#3ecf8e]"
                    >
                      {MODES.find((m) => m.id === mode)?.label ?? "Ask"}
                      <X
                        className="h-3 w-3 opacity-70"
                        strokeWidth={2}
                        onClick={(e) => {
                          e.stopPropagation();
                          const sess = ensureSession();
                          setSessionMode(sess.id, "ask");
                        }}
                      />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-36">
                    {MODES.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={() => {
                          const sess = ensureSession();
                          setSessionMode(sess.id, m.id);
                        }}
                      >
                        {m.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-7 max-w-[200px] items-center gap-1.5 rounded-md px-2 text-[12px] text-[#b0b0b0] hover:bg-white/[0.06]"
                    >
                      <ProviderDot provider={activeModel.provider} />
                      <span className="truncate">{activeModel.label}</span>
                      <ChevronDown className="h-3 w-3 opacity-50" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {MODELS.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={() => {
                          const sess = ensureSession();
                          setSessionModel(sess.id, m.id);
                        }}
                      >
                        <ProviderDot provider={m.provider} className="mr-2" />
                        {m.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <div className="flex-1" />

                <button
                  type="button"
                  disabled
                  className="flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-md text-[#555]"
                  aria-label="Voice input coming soon"
                  title="Voice input coming soon"
                >
                  <Mic className="h-4 w-4" strokeWidth={1.5} />
                </button>

                <button
                  type="button"
                  disabled={!canSend}
                  onClick={() => submit()}
                  className={cn(
                    "ml-1 h-7 rounded-full px-3 text-[12px] font-medium",
                    canSend
                      ? "bg-[#e8e8e8] text-[#0a0a0a] hover:bg-white"
                      : "cursor-not-allowed bg-white/[0.06] text-[#555]",
                  )}
                >
                  Send
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={planNewIdea}
                className="inline-flex h-8 items-center gap-2 rounded-full border border-white/[0.1] px-3.5 text-[12px] text-[#b0b0b0] hover:bg-white/[0.04] hover:text-[#e8e8e8]"
              >
                Plan New Idea
                <span className="text-[11px] tabular-nums text-[#555]">⇧Tab</span>
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
            <span>Import conversations — sync chats and continue them here</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default EmptySessionView;
