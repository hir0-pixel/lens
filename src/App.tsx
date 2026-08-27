import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import TitleBar from "./components/TitleBar";
import { EmptySessionView } from "./components/workspace/EmptySessionView";
import { SessionTabStrip } from "./components/workspace/SessionTabStrip";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  AgentsSideDock,
  type AgentsDockKind,
} from "./components/workspace/AgentsSideDock";
import IdeWindowApp from "./components/windows/IdeWindowApp";
import FileEditorWindowApp from "./components/windows/FileEditorWindowApp";
import { ProjectFilesSidePane } from "./components/workspace/ProjectFilesSidePane";
import SettingsDialog from "./components/settings/SettingsDialog";
import PlansDialog from "./components/plans/PlansDialog";
import ImportDialog from "./components/import/ImportDialog";
import AutomationsDialog from "./components/automations/AutomationsDialog";
import { WelcomeScreen } from "./components/welcome/WelcomeScreen";
import { CloneRepoDialog } from "./components/welcome/CloneRepoDialog";
import { useShellEvents } from "./features/shell/useShellEvents";
import { WorkbenchOverlays } from "./features/command-palette/WorkbenchOverlays";
import {
  getWindowMode,
  openIdeWindow,
} from "./features/windows/openAppWindow";
import { openFolder } from "./features/projects/openFolder";
import {
  INITIAL_PROJECTS,
  INITIAL_PROVIDERS,
  MODELS,
} from "./lib/mock-data";
import type {
  AIMode,
  Attachment,
  ChatMessage,
  Model,
  Project,
  ProviderState,
  ToolCallRecord,
  ViewKind,
} from "./lib/types";
import { Toaster } from "./components/ui/sonner";
import { useAppearanceStore } from "./stores/appearanceStore";
import { WorkbenchSkeleton } from "./components/ui/WorkbenchSkeleton";
import { useSettingsStore } from "./stores/settingsStore";
import { useSessionStore, type PlanStep } from "./stores/sessionStore";
import { useTerminalStore } from "./stores/terminalStore";
import type { SettingsSectionId } from "./shared/settings/defaults";
import { AuthGate } from "./shared/bff-auth/AuthGate";
import { AuthClientError, getBffAuthClient } from "./shared/bff-auth";
import { useAuthStore } from "./shared/bff-auth/store";
import { useModelCatalogStore } from "./stores/modelCatalogStore";
import { pickPreferredRagModel, resolveAskModelId } from "./shared/rag/preferredModel";

const ProjectListView = lazy(
  () => import("./components/projects/ProjectListView"),
);
const AnalyticsView = lazy(
  () => import("./components/analytics/AnalyticsView"),
);

const SETTINGS_SECTIONS = new Set<string>([
  "general",
  "appearance",
  "editor",
  "terminal",
  "browser",
  "ai",
  "models",
  "providers",
  "git",
  "privacy",
  "accessibility",
  "keyboard",
  "about",
]);

export default function App() {
  const mode = getWindowMode();
  if (mode === "ide") {
    return <IdeWindowApp />;
  }
  if (mode === "file-editor") {
    return <FileEditorWindowApp />;
  }
  return (
    <AuthGate>
      <AgentsApp />
    </AuthGate>
  );
}

/** Agents OS window — chat + optional side Terminal dock. IDE is a separate window. */
function AgentsApp() {
  const applyAppearance = useAppearanceStore((s) => s.apply);
  const themeMode = useAppearanceStore((s) => s.themeMode);

  const sessions = useSessionStore((s) => s.sessions);
  const repositories = useSessionStore((s) => s.repositories);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const activeRepositoryId = useSessionStore((s) => s.activeRepositoryId);
  const newChat = useSessionStore((s) => s.newChat);
  const multitask = useSessionStore((s) => s.multitask);
  const appendMessage = useSessionStore((s) => s.appendMessage);
  const setConversationRef = useSessionStore((s) => s.setConversationRef);
  const setPlan = useSessionStore((s) => s.setPlan);
  const setSessionMode = useSessionStore((s) => s.setSessionMode);
  const createSession = useSessionStore((s) => s.createSession);
  const getModel = useSessionStore((s) => s.getModel);
  const closeWorkspace = useSessionStore((s) => s.closeWorkspace);
  const catalogModels = useModelCatalogStore((s) => s.models);
  const catalogStatus = useModelCatalogStore((s) => s.status);
  const catalogError = useModelCatalogStore((s) => s.errorMessage);
  const refreshCatalog = useModelCatalogStore((s) => s.refresh);
  const authStatus = useAuthStore((s) => s.status);

  const session = currentSessionId ? sessions[currentSessionId] : null;

  const [view, setView] = useState<ViewKind>("workspace");
  const [projects] = useState<Project[]>(INITIAL_PROJECTS);
  const [providers, setProviders] = useState<ProviderState[]>(INITIAL_PROVIDERS);
  const [sending, setSending] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [credits, setCredits] = useState(2_000_000);
  const [, setSessionCredits] = useState(348_120);
  const [agentsDock, setAgentsDock] = useState<string | null>(null);
  const [bottomTerminal, setBottomTerminal] = useState(false);
  const requestAbort = useRef<AbortController | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [automationsOpen, setAutomationsOpen] = useState(false);

  const showWelcome =
    view === "workspace" &&
    currentSessionId === null &&
    activeRepositoryId === null;

  const activeRepo = repositories.find((r) => r.id === activeRepositoryId);
  const project: Project =
    projects.find((p) => p.id === session?.repoId) ??
    (activeRepo
      ? {
          id: activeRepo.id,
          name: activeRepo.name,
          stack: "Local",
          path: activeRepo.path,
          branch: "main",
          deployStatus: "idle",
          updatedAt: "now",
          color: "#0070f3",
        }
      : projects[0]);

  const model: Model = session
    ? (catalogModels.find((entry) => entry.id === session.modelId)
      ?? pickPreferredRagModel(catalogModels)
      ?? getModel(session))
    : (pickPreferredRagModel(catalogModels) ?? MODELS[0]);

  useEffect(() => {
    if (authStatus === "authenticated") void refreshCatalog();
  }, [authStatus, refreshCatalog]);

  useEffect(() => {
    if (catalogStatus !== "ready" || catalogModels.length === 0) return;
    const preferred = pickPreferredRagModel(catalogModels);
    if (!preferred) return;
    const state = useSessionStore.getState();
    const active = state.currentSession();
    const resolved = resolveAskModelId(catalogModels, active?.modelId);
    if (active && resolved && resolved !== active.modelId) {
      state.setSessionModel(active.id, resolved);
    } else if (state.defaultModelId !== preferred.id && !catalogModels.some((entry) => entry.id === state.defaultModelId)) {
      state.setDefaultModel(preferred.id);
    }
  }, [catalogStatus, catalogModels]);

  const openProjects = useCallback(() => setView("projects"), []);

  const openSettings = useCallback((section?: string) => {
    if (section && SETTINGS_SECTIONS.has(section)) {
      useSettingsStore.getState().setSection(section as SettingsSectionId);
    }
    setSettingsOpen(true);
  }, []);

  useShellEvents({
    onOpenProjects: openProjects,
    onOpenSettings: openSettings,
  });

  useEffect(() => {
    document.title = "Agents";
    applyAppearance();
  }, [applyAppearance]);

  useEffect(() => {
    if (themeMode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyAppearance();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [themeMode, applyAppearance]);

  useEffect(() => {
    function onOpenFile(e: Event) {
      const detail = (e as CustomEvent<{ path?: string }>).detail;
      void openIdeWindow().then(() => {
        if (detail?.path) {
          try {
            localStorage.setItem("lens-ide-open-path", detail.path);
          } catch {
            /* ignore */
          }
        }
      });
    }
    function onNewAgent() {
      newChat();
      setView("workspace");
      setAgentsDock(null);
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("lens:focus-composer"));
      }, 50);
    }
    function onOpenIde() {
      void openIdeWindow();
    }
    function onOpenTerminal() {
      const term = useTerminalStore.getState();
      if (!term.activeSessionId) {
        const repos = useSessionStore.getState().repositories;
        const activeId = useSessionStore.getState().activeRepositoryId;
        const cwd =
          repos.find((r) => r.id === activeId)?.path ?? term.defaultCwd;
        term.createSession({ cwd });
      }
      setBottomTerminal((v) => !v);
      setView("workspace");
    }
    function onOpenBrowser() {
      setAgentsDock("browser");
      setView("workspace");
    }
    function onToggleAgentsDock() {
      setAgentsDock((k) => (k ? null : "picker"));
      setView("workspace");
    }
    function onOpenAgentsTab(e: Event) {
      const kind = (e as CustomEvent<{ kind?: string }>).detail?.kind;
      if (!kind || kind === "picker") {
        setAgentsDock("picker");
      } else {
        if (kind === "terminal") {
          const term = useTerminalStore.getState();
          if (!term.activeSessionId) {
            const repos = useSessionStore.getState().repositories;
            const activeId = useSessionStore.getState().activeRepositoryId;
            const cwd =
              repos.find((r) => r.id === activeId)?.path ?? term.defaultCwd;
            term.createSession({ cwd });
          }
        }
        setAgentsDock(kind);
      }
      setView("workspace");
    }
    function onShowWelcome() {
      closeWorkspace();
      setAgentsDock(null);
      setView("workspace");
    }
    function onProjectOpened() {
      setView("workspace");
      setAgentsDock(null);
    }

    window.addEventListener("lens:open-file", onOpenFile);
    window.addEventListener("lens:new-agent", onNewAgent);
    window.addEventListener("lens:open-ide", onOpenIde);
    window.addEventListener("lens:open-terminal", onOpenTerminal);
    window.addEventListener("lens:open-browser", onOpenBrowser);
    window.addEventListener("lens:toggle-agents-dock", onToggleAgentsDock);
    window.addEventListener("lens:open-agents-tab", onOpenAgentsTab);
    window.addEventListener("lens:show-welcome", onShowWelcome);
    window.addEventListener("lens:project-opened", onProjectOpened);
    return () => {
      window.removeEventListener("lens:open-file", onOpenFile);
      window.removeEventListener("lens:new-agent", onNewAgent);
      window.removeEventListener("lens:open-ide", onOpenIde);
      window.removeEventListener("lens:open-terminal", onOpenTerminal);
      window.removeEventListener("lens:open-browser", onOpenBrowser);
      window.removeEventListener("lens:toggle-agents-dock", onToggleAgentsDock);
      window.removeEventListener("lens:open-agents-tab", onOpenAgentsTab);
      window.removeEventListener("lens:show-welcome", onShowWelcome);
      window.removeEventListener("lens:project-opened", onProjectOpened);
    };
  }, [newChat, closeWorkspace]);

  const showWorkspace =
    !showWelcome &&
    view === "workspace";

  function switchProject(p: Project) {
    const repo = repositories.find((r) => r.id === p.id);
    if (repo) useSessionStore.getState().openRepository(repo.id);
  }

  async function handleSend(
    text: string,
    attachments: Attachment[] = [],
    opts?: { planFirst?: boolean; modeOverride?: AIMode },
  ) {
    let sess = useSessionStore.getState().currentSession();
    if (!sess) sess = createSession({ activate: true });

    const mode = opts?.modeOverride ?? sess.mode;
    setView("workspace");

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
      checkpoint: `ckpt-u-${Date.now()}`,
      ...(attachments.length
        ? { attachments: attachments.map((a) => ({ ...a })) }
        : {}),
    };
    appendMessage(sess.id, userMsg);
    setSending(true);

    if (mode === "ask") {
      const bffClient = getBffAuthClient();
      if (!bffClient) {
        toast.error("The governed RAG service is unavailable through the secure gateway.");
        setSending(false);
        return;
      }
      const controller = new AbortController();
      requestAbort.current = controller;
      try {
        const askModelId = resolveAskModelId(catalogModels, sess.modelId);
        if (askModelId && askModelId !== sess.modelId) {
          useSessionStore.getState().setSessionModel(sess.id, askModelId);
        }
        const answer = await bffClient.askRag(text, {
          modelId: askModelId,
          conversationRef: sess.conversationRef,
          conversationCreationKey: sess.conversationCreationKey,
          signal: controller.signal,
        });
        setConversationRef(sess.id, answer.conversationRef);
        appendMessage(sess.id, {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: answer.output,
          timestamp: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
          model: "Lens (authenticated)",
          citations: answer.citations.map((citation) => ({ ...citation })),
        });
      } catch (error) {
        if (error instanceof AuthClientError && error.code === "AUTH_REQUIRED") {
          useAuthStore.getState().clear();
        } else if (
          error instanceof AuthClientError &&
          (error.code === "OVERLOADED" ||
            error.code === "CAPACITY_UNAVAILABLE" ||
            error.code === "RATE_LIMITED")
        ) {
          toast.error("Lens is at capacity.", {
            description:
              "Too many governed RAG requests are active right now. Please retry shortly.",
          });
        } else if (error instanceof AuthClientError && error.code === "RAG_NOT_CONFIGURED") {
          toast.error("Governed RAG is not configured.", {
            description:
              "Ask mode needs RAG_PROVIDER_MODE=internal plus ORCHESTRATOR_URL/TOKEN in server/.env. Run: node scripts/dev/merge-bff-rag-env.mjs, then restart the BFF and RAG stack. Provider onboarding alone is not enough.",
          });
        } else if (error instanceof AuthClientError && error.code === "MODEL_NOT_ELIGIBLE") {
          toast.error("Selected model cannot be used for Ask.", {
            description:
              error.detail ?? "Pick an approved Gemini 3.x model (e.g. gemini-3.6-flash) from the model menu.",
          });
        } else if (error instanceof AuthClientError && error.code === "FORBIDDEN") {
          toast.error("Governed RAG turn was denied.", {
            description:
              error.detail ??
              "The orchestrator rejected this request. Check the orchestrator terminal for [orchestrator deny] logs, or try gemini-3.6-flash.",
          });
        } else if (
          error instanceof AuthClientError &&
          (error.code === "RAG_UNAVAILABLE" || error.code === "DEPENDENCY_UNAVAILABLE")
        ) {
          toast.error("Governed RAG request failed.", {
            description:
              error.code === "DEPENDENCY_UNAVAILABLE"
                ? "The orchestrator or runtime is unreachable or returned an error. Ensure authority, orchestrator (:8789), and runtime (:8793) are running."
                : "The governed RAG service returned an unexpected response.",
          });
        } else if (!controller.signal.aborted) {
          toast.error("The governed RAG service is unavailable through the secure gateway.");
        }
      } finally {
        if (requestAbort.current === controller) requestAbort.current = null;
        setSending(false);
      }
      return;
    }

    if (opts?.planFirst) {
      const plan: PlanStep[] = [
        { id: "p1", label: "Clarify goals and constraints", status: "done" },
        { id: "p2", label: "Outline approach", status: "in_progress" },
        { id: "p3", label: "Execute approved steps", status: "pending" },
      ];
      setPlan(sess.id, plan);
      setSessionMode(sess.id, "agent");
    }

    const allowWrites = mode === "agent";
    const allowScopedEdit =
      mode === "edit" && (sess.openFiles.length > 0 || attachments.length > 0);
    const willTouchFiles = allowWrites || allowScopedEdit;

    const toolCalls: ToolCallRecord[] = willTouchFiles
      ? [
          {
            id: `t-${Date.now()}-1`,
            name: mode === "edit" ? "edit_file" : "write_file",
            detail:
              mode === "edit"
                ? sess.openFiles[0] ?? "selected files"
                : "Updating project files",
            status: "running",
            category: mode === "edit" ? "edit" : "write",
          },
        ]
      : [];

    if (willTouchFiles) {
      window.setTimeout(() => void openIdeWindow(), 600);
    }

    setTimeout(() => {
      let content: string;
      const greeting = /^(hi|hello|hey|yo)\b/i.test(text.trim());
      const repoName =
        repositories.find((r) => r.id === sess!.repoId)?.name ??
        repositories.find(
          (r) => r.id === useSessionStore.getState().activeRepositoryId,
        )?.name ??
        "lens";
      if (greeting && mode !== "edit") {
        content = `Hi! I'm Lens, ready to help with your project in \`${repoName}\`. What would you like to work on?`;
      } else if ((mode as "ask" | "edit" | "agent") === "ask") {
        content =
          "Here's what I found — Ask mode is read-only, so I won't change any files.";
      } else if (mode === "edit" && !allowScopedEdit) {
        content = "Edit mode needs an open file. Open the IDE, then try again.";
      } else if (opts?.planFirst) {
        content =
          "I've drafted a plan below. Review the steps — say go when you want me to execute.";
      } else {
        content =
          "I've applied that change. The IDE window has the editor open for review.";
      }

      appendMessage(sess!.id, {
        id: `a-${Date.now()}`,
        role: "assistant",
        content,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
        model: getModel(sess!).label,
        ...(toolCalls.length
          ? {
              toolCalls: toolCalls.map((c) => ({
                ...c,
                status: "done" as const,
              })),
            }
          : {}),
      });
      setSending(false);
      setCredits((c) => c - Math.round(text.length * 1.12));
      setSessionCredits((c) => c + Math.round(text.length * 1.12));
    }, 1400);
  }

  function handleEmptySend(
    text: string,
    mode: AIMode,
    selectedModel: Model,
    attachments: Attachment[] = [],
    opts?: { planFirst?: boolean },
  ) {
    let sess = useSessionStore.getState().currentSession();
    if (!sess) sess = createSession({ activate: true });
    setSessionMode(sess.id, mode);
    useSessionStore.getState().setSessionModel(sess.id, selectedModel.id);
    handleSend(text, attachments, {
      planFirst: opts?.planFirst,
      modeOverride: mode,
    });
  }

  function handleRestoreCheckpoint(id: string) {
    setRestoringId(id);
    setTimeout(() => {
      setRestoringId(null);
      setCredits((c) => c - 5);
      setSessionCredits((c) => c + 5);
    }, 1200);
  }

  function handleToggleProvider(id: ProviderState["id"]) {
    setProviders((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, connected: !p.connected } : p,
      ),
    );
  }

  function handleImport(_source: string) {
    setImportOpen(false);
  }

  const mainContent = showWelcome ? (
    <ErrorBoundary fallbackTitle="Welcome crashed">
      <WelcomeScreen planLabel="Pro" onOpenSettings={openSettings} />
    </ErrorBoundary>
  ) : showWorkspace ? (
    <ErrorBoundary fallbackTitle="Workspace crashed">
      <EmptySessionView
        model={model}
        models={catalogModels}
        catalogStatus={catalogStatus}
        catalogError={catalogError}
        messages={session?.messages ?? []}
        sending={sending}
        restoringId={restoringId}
        planSteps={session?.plan}
        onSend={handleEmptySend}
        onStop={() => {
          requestAbort.current?.abort();
          setSending(false);
        }}
        onRestoreCheckpoint={handleRestoreCheckpoint}
        onOpenSettings={openSettings}
        onOpenAutomations={() => setAutomationsOpen(true)}
        onAddFolder={() => void openFolder()}
        onMultitask={() => {
          multitask();
          toast.message("Multitask", {
            description: "New parallel session opened",
          });
        }}
        terminalOpen={bottomTerminal}
        onCloseTerminal={() => setBottomTerminal(false)}
        onImport={() => setImportOpen(true)}
        agentsDock={agentsDock}
        onToggleSidePane={() =>
          setAgentsDock((k) => (k ? null : "project-files"))
        }
        onOpenTerminal={() => setBottomTerminal((v) => !v)}
      />
    </ErrorBoundary>
  ) : (
    <Suspense fallback={<WorkbenchSkeleton variant="cards" rows={6} />}>
      {view === "projects" ? (
        <ProjectListView
          projects={projects}
          onOpenProject={(p) => {
            switchProject(p);
            setView("workspace");
          }}
          onOpenImport={() => setImportOpen(true)}
          onBack={() => setView("workspace")}
        />
      ) : (
        <AnalyticsView project={project} onBack={() => setView("workspace")} />
      )}
    </Suspense>
  );

  return (
    <div className="flex h-screen flex-col bg-[var(--bg-canvas)] font-sans text-[var(--text-primary)] antialiased">
      <TitleBar
        projectName={project.name}
        onOpenSettings={() => openSettings()}
        variant="agents"
        onIdeWindow={() => void openIdeWindow()}
        onOpenTerminal={() => setBottomTerminal((v) => !v)}
        sidePaneOpen={agentsDock === "project-files"}
        onToggleSidePane={() =>
          setAgentsDock((k) => (k === "project-files" ? null : "project-files"))
        }
      />
      <SessionTabStrip />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">{mainContent}</div>
        {agentsDock === "project-files" ? (
          <ProjectFilesSidePane onClose={() => setAgentsDock(null)} />
        ) : agentsDock !== null ? (
          <AgentsSideDock
            kind={agentsDock as AgentsDockKind}
            onClose={() => setAgentsDock(null)}
            onOpenTab={(tab) =>
              window.dispatchEvent(
                new CustomEvent("lens:open-agents-tab", { detail: { kind: tab } }),
              )
            }
          />
        ) : null}
      </div>

      <WorkbenchOverlays />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        providers={providers}
        onToggleProvider={handleToggleProvider}
      />
      <PlansDialog
        open={plansOpen}
        onClose={() => setPlansOpen(false)}
        credits={credits}
      />
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={handleImport}
        onCloneRequest={() => setCloneOpen(true)}
      />
      <CloneRepoDialog open={cloneOpen} onClose={() => setCloneOpen(false)} />
      <AutomationsDialog
        open={automationsOpen}
        onClose={() => setAutomationsOpen(false)}
      />
      <Toaster />
    </div>
  );
}
