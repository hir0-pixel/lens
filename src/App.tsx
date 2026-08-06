import { useEffect, useState } from "react";
import TitleBar from "./components/TitleBar";
import TopBar from "./components/TopBar";
import AgentChat from "./components/agent/AgentChat";
import OutputTabs from "./components/output/OutputTabs";
import SettingsDialog from "./components/settings/SettingsDialog";
import PlansDialog from "./components/plans/PlansDialog";
import ImportDialog from "./components/import/ImportDialog";
import ProjectListView from "./components/projects/ProjectListView";
import AnalyticsView from "./components/analytics/AnalyticsView";
import {
  INITIAL_PROJECTS,
  INITIAL_PROVIDERS,
  INITIAL_THREAD,
  MODELS,
} from "./lib/mock-data";
import type {
  Attachment,
  ChatMessage,
  Model,
  Project,
  ProviderState,
  Theme,
  ToolCallRecord,
  ViewKind,
} from "./lib/types";

const RESIZER_WIDTH = 5;

export default function App() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [view, setView] = useState<ViewKind>("workspace");
  const [projects] = useState<Project[]>(INITIAL_PROJECTS);
  const [project, setProject] = useState<Project>(INITIAL_PROJECTS[0]);
  const [model] = useState<Model>(MODELS[0]);
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_THREAD);
  const [sending, setSending] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [credits, setCredits] = useState(2_000_000);
  const [sessionCredits, setSessionCredits] = useState(348_120);
  const [providers, setProviders] = useState<ProviderState[]>(INITIAL_PROVIDERS);
  const [leftWidth, setLeftWidth] = useState(38); // percent

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  function handleSend(text: string, attachments: Attachment[]) {
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
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);

    const toolCalls: ToolCallRecord[] = [
      { id: `t-${Date.now()}-1`, name: "write_file", detail: "Updating project files", status: "running" },
    ];

    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content:
            "I've applied that change and the preview is live in the Browser tab. Let me know if you'd like any adjustments.",
          timestamp: new Date().toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          }),
          model: model.label,
          toolCalls: toolCalls.map((c) => ({ ...c, status: "done" as const })),
        },
      ]);
      setSending(false);
      setCredits((c) => c - Math.round(text.length * 1.12));
      setSessionCredits((c) => c + Math.round(text.length * 1.12));
    }, 1400);
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

  function handleImport(source: string) {
    setImportOpen(false);
    const names: Record<string, string> = {
      local: "local-project",
      github: "imported-repo",
      v0: "v0-import",
      lovable: "lovable-app",
      replit: "replit-clone",
      bolt: "bolt-project",
    };
    setProject((prev) => ({
      ...prev,
      name: names[source] ?? "imported-project",
      stack: "Imported · Vite",
    }));
  }

  return (
    <div className="flex h-screen flex-col bg-surface-0 font-sans text-zinc-200 antialiased">
      <TitleBar />

      {view === "workspace" ? (
        <>
          <TopBar
            project={project}
            projects={projects}
            model={model}
            credits={credits}
            sessionCredits={sessionCredits}
            theme={theme}
            onOpenProject={(p) => setProject(p)}
            onToggleTheme={() =>
              setTheme((t) => (t === "dark" ? "light" : "dark"))
            }
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenPlans={() => setPlansOpen(true)}
            onOpenProjects={() => setView("projects")}
            onOpenImport={() => setImportOpen(true)}
          />

          <div className="flex min-h-0 flex-1">
            {/* Left pane */}
            <div style={{ width: `${leftWidth}%` }} className="min-w-0">
              <AgentChat
                messages={messages}
                sending={sending}
                restoringId={restoringId}
                onSend={handleSend}
                onRestoreCheckpoint={handleRestoreCheckpoint}
              />
            </div>

            {/* Resizer */}
            <div
              className="group relative shrink-0 cursor-col-resize"
              style={{ width: RESIZER_WIDTH }}
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startWidth = leftWidth;
                function move(ev: MouseEvent) {
                  const totalWidth = window.innerWidth;
                  const pct = Math.min(
                    70,
                    Math.max(24, startWidth + ((ev.clientX - startX) / totalWidth) * 100),
                  );
                  setLeftWidth(pct);
                }
                function up() {
                  window.removeEventListener("mousemove", move);
                  window.removeEventListener("mouseup", up);
                }
                window.addEventListener("mousemove", move);
                window.addEventListener("mouseup", up);
              }}
            >
              <div className="absolute inset-y-0 -left-4 -right-4 opacity-0 transition-opacity group-hover:opacity-0" />
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10 transition-colors group-hover:bg-accent/60" />
            </div>

            {/* Right pane — output */}
            <div className="min-w-0 flex-1">
              <OutputTabs />
            </div>
          </div>
        </>
      ) : view === "projects" ? (
        <ProjectListView
          projects={projects}
          onOpenProject={(p) => {
            setProject(p);
            setView("workspace");
          }}
          onOpenImport={() => setImportOpen(true)}
          onBack={() => setView("workspace")}
        />
      ) : (
        <AnalyticsView
          project={project}
          onBack={() => setView("workspace")}
        />
      )}

      {/* Dialogs */}
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
      />
    </div>
  );
}