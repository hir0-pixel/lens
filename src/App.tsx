import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import TitleBar from "./components/TitleBar";
import { AgentWorkspace } from "./components/workspace/AgentWorkspace";
import { EmptySessionView } from "./components/workspace/EmptySessionView";
import { SessionTabStrip } from "./components/workspace/SessionTabStrip";
import {
  AgentsSideDock,
  type AgentsDockKind,
} from "./components/workspace/AgentsSideDock";
import { ErrorBoundary } from "./components/ErrorBoundary";
import IdeWindowApp from "./components/windows/IdeWindowApp";
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
  if (getWindowMode() === "ide") {
    return <IdeWindowApp />;
  }
  return <AgentsApp />;
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
  const setPlan = useSessionStore((s) => s.setPlan);
  const setSessionMode = useSessionStore((s) => s.setSessionMode);
  const createSession = useSessionStore((s) => s.createSession);
  const getModel = useSessionStore((s) => s.getModel);
  const closeWorkspace = useSessionStore((s) => s.closeWorkspace);

  const session = currentSessionId ? sessions[currentSessionId] : null;

  const [view, setView] = useState<ViewKind>("workspace");
  const [projects] = useState<Project[]>(INITIAL_PROJECTS);
  const [providers, setProviders] = useState<ProviderState[]>(INITIAL_PROVIDERS);
  const [sending, setSending] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [credits, setCredits] = useState(2_000_000);
  const [, setSessionCredits] = useState(348_120);
  const [agentsDock, setAgentsDock] = useState<AgentsDockKind>(null);

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
          color: "#8B5CF6",
        }
      : projects[0]);

  const model: Model = session ? getModel(session) : MODELS[0];

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
            localStorage.setItem("orchids-ide-open-path", detail.path);
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
        window.dispatchEvent(new CustomEvent("orchids:focus-composer"));
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
      setAgentsDock("terminal");
      setView("workspace");
    }
    function onOpenBrowser() {
      setAgentsDock("browser");
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

    window.addEventListener("orchids:open-file", onOpenFile);
    window.addEventListener("orchids:new-agent", onNewAgent);
    window.addEventListener("orchids:open-ide", onOpenIde);
    window.addEventListener("orchids:open-terminal", onOpenTerminal);
    window.addEventListener("orchids:open-browser", onOpenBrowser);
    window.addEventListener("orchids:show-welcome", onShowWelcome);
    window.addEventListener("orchids:project-opened", onProjectOpened);
    return () => {
      window.removeEventListener("orchids:open-file", onOpenFile);
      window.removeEventListener("orchids:new-agent", onNewAgent);
      window.removeEventListener("orchids:open-ide", onOpenIde);
      window.removeEventListener("orchids:open-terminal", onOpenTerminal);
      window.removeEventListener("orchids:open-browser", onOpenBrowser);
      window.removeEventListener("orchids:show-welcome", onShowWelcome);
      window.removeEventListener("orchids:project-opened", onProjectOpened);
    };
  }, [newChat, closeWorkspace]);

  const showEmptyHome =
    !showWelcome &&
    view === "workspace" &&
    (!session || session.messages.length === 0);

  const showAgentChat =
    !showWelcome &&
    view === "workspace" &&
    !!session &&
    session.messages.length > 0;

  function switchProject(p: Project) {
    const repo = repositories.find((r) => r.id === p.id);
    if (repo) useSessionStore.getState().openRepository(repo.id);
  }

  function handleSend(
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

    const toolCalls: ToolCallRecord[] =
      mode === "ask"
        ? []
        : willTouchFiles
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
      if (mode === "ask") {
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
  ) : showEmptyHome ? (
    <ErrorBoundary fallbackTitle="Home crashed">
      <EmptySessionView
        model={model}
        onSend={handleEmptySend}
        onOpenSettings={openSettings}
        onOpenAutomations={() => setAutomationsOpen(true)}
        onAddFolder={() => void openFolder()}
        onMultitask={() => {
          multitask();
          toast.message("Multitask", {
            description: "New parallel session opened",
          });
        }}
        onImport={() => setImportOpen(true)}
      />
    </ErrorBoundary>
  ) : showAgentChat ? (
    <ErrorBoundary fallbackTitle="Agent crashed">
      <div className="flex min-h-0 flex-1 flex-col bg-[#0a0a0a]">
        <AgentWorkspace
          project={project}
          projects={projects}
          onProjectChange={switchProject}
          messages={session!.messages}
          sending={sending}
          restoringId={restoringId}
          onSend={(text, attachments) => handleSend(text, attachments)}
          onStop={() => setSending(false)}
          onRestoreCheckpoint={handleRestoreCheckpoint}
          onNewChat={() => newChat()}
          initialMode={session!.mode}
          planSteps={session!.plan}
          onModeChange={(mode) => setSessionMode(session!.id, mode)}
        />
      </div>
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
    <div className="flex h-screen flex-col bg-[#0a0a0a] font-sans text-[#e8e8e8] antialiased">
      <TitleBar
        projectName={project.name}
        onOpenSettings={() => openSettings()}
        variant="agents"
        onIdeWindow={() => void openIdeWindow()}
      />
      <SessionTabStrip />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">{mainContent}</div>
        <AgentsSideDock kind={agentsDock} onClose={() => setAgentsDock(null)} />
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
