import { Pin, Plus, Search } from "@/components/icons/tabler";
import { type NavView, useLayoutStore } from "@/stores/layoutStore";
import { INITIAL_PROJECTS } from "@/lib/mock-data";
import { MOCK_CONVERSATIONS } from "@/components/ai/mock-data";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { useMemo, useState } from "react";

const TITLES: Record<NavView, string> = {
  agents: "Agents",
  search: "Search",
  automations: "Automations",
  knowledge: "Knowledge",
  projects: "Projects",
  workspaces: "Workspaces",
  history: "History",
  memory: "Memory",
  prompts: "Prompts",
  templates: "Templates",
  settings: "Settings",
  repositories: "Repositories",
};

const STUB_COPY: Partial<Record<NavView, string>> = {
  automations: "Workflow automations will appear here.",
  knowledge: "Docs, notes, and indexed knowledge bases.",
  memory: "Long-term agent memory across sessions.",
  prompts: "Saved prompt library for reuse.",
  templates: "Project and agent starter templates.",
  settings: "Open Settings from the rail or toolbar.",
  repositories: "Linked git repositories for this workspace.",
  search: "Use Ctrl+Shift+F for workspace search.",
};

interface WorkspaceNavigatorProps {
  projects?: Project[];
  activeProjectId?: string;
  onProjectSelect?: (project: Project) => void;
  onNewAgent?: () => void;
  onSessionSelect?: (id: string) => void;
}

/**
 * Expandable list panel for Agent Workspace navigation.
 */
export function WorkspaceNavigator({
  projects = INITIAL_PROJECTS,
  activeProjectId,
  onProjectSelect,
  onNewAgent,
  onSessionSelect,
}: WorkspaceNavigatorProps) {
  const navView = useLayoutStore((s) => s.navView);
  const [query, setQuery] = useState("");

  const sessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MOCK_CONVERSATIONS;
    return MOCK_CONVERSATIONS.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.preview.toLowerCase().includes(q),
    );
  }, [query]);

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.stack?.toLowerCase().includes(q),
    );
  }, [projects, query]);

  return (
    <div className="flex h-full flex-col bg-[var(--bg-surface)] animate-cursor-fade">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3">
        <h2 className="truncate type-caption-uppercase text-[var(--text-tertiary)]">
          {TITLES[navView]}
        </h2>
        {(navView === "agents" || navView === "history") && (
          <button
            type="button"
            className="btn-ghost h-6 w-6"
            aria-label="New agent"
            title="New agent"
            onClick={onNewAgent}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {(navView === "agents" ||
        navView === "history" ||
        navView === "projects" ||
        navView === "workspaces") && (
        <div className="shrink-0 border-b border-[var(--border-subtle)] p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Filter ${TITLES[navView].toLowerCase()}…`}
              className="h-7 border-[var(--border-default)] bg-[var(--bg-canvas)] pl-7 type-caption"
            />
          </div>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-1.5">
          {(navView === "agents" || navView === "history") && (
            <ul className="flex flex-col gap-0.5">
              {sessions.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    title={c.title}
                    onClick={() => onSessionSelect?.(c.id)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left",
                      "transition-colors duration-[var(--duration-instant)]",
                      "hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--border-focus)]",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {c.pinned && (
                        <Pin
                          className="h-3 w-3 shrink-0 text-[var(--accent-primary)]"
                          strokeWidth={1.75}
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate type-caption font-medium text-[var(--text-primary)]">
                        {c.title}
                      </span>
                    </span>
                    <span
                      className="truncate type-caption text-[var(--text-tertiary)]"
                      title={c.preview}
                    >
                      {c.preview}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {(navView === "projects" || navView === "workspaces") && (
            <>
              {navView === "workspaces" && <SectionLabel>Pinned</SectionLabel>}
              <ul className="flex flex-col gap-0.5">
                {filteredProjects.map((p, i) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      title={p.name}
                      onClick={() => onProjectSelect?.(p)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-[5px] text-left",
                        "transition-colors duration-[var(--duration-instant)]",
                        "hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--border-focus)]",
                        activeProjectId === p.id && "bg-[var(--bg-selected)]",
                      )}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="min-w-0 flex-1 truncate type-caption text-[var(--text-primary)]">
                        {p.name}
                      </span>
                      {i < 2 && navView === "workspaces" && (
                        <Pin className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {navView === "workspaces" && (
                <>
                  <SectionLabel>Recent</SectionLabel>
                  <ul className="flex flex-col gap-0.5">
                    {filteredProjects.slice(0, 4).map((p) => (
                      <li key={`recent-${p.id}`}>
                        <button
                          type="button"
                          title={p.name}
                          onClick={() => onProjectSelect?.(p)}
                          className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-[5px] text-left transition-colors duration-[var(--duration-instant)] hover:bg-[var(--bg-hover)]"
                        >
                          <span className="min-w-0 flex-1 truncate type-caption text-[var(--text-secondary)]">
                            {p.name}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}

          {STUB_COPY[navView] && (
            <div className="px-2 py-6 text-center">
              <p className="type-caption leading-5 text-[var(--text-secondary)]">
                {STUB_COPY[navView]}
              </p>
              <p className="mt-1 type-caption text-[var(--text-tertiary)]">
                Extensible slot — no shell restructure required.
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-3 type-caption-uppercase text-[var(--text-tertiary)]">
      {children}
    </div>
  );
}

export default WorkspaceNavigator;
