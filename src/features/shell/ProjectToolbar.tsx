import {
  ChevronDown,
  Cloud,
  Coins,
  GitBranch,
  Moon,
  Rocket,
  Sun,
} from "lucide-react";
import { cn, formatCredits } from "@/lib/utils";
import type { Model, Project, Theme } from "@/lib/types";

interface ProjectToolbarProps {
  project: Project;
  projects: Project[];
  model: Model;
  credits: number;
  theme: Theme;
  onOpenProject: (p: Project) => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenPlans: () => void;
  onOpenProjects: () => void;
  onOpenImport: () => void;
}

/**
 * Toolbar — 40px, clear hierarchy: Deploy (primary) > Import (secondary) > ghosts.
 */
export function ProjectToolbar({
  project,
  projects,
  model,
  credits,
  theme,
  onOpenProject,
  onToggleTheme,
  onOpenSettings,
  onOpenPlans,
  onOpenProjects,
  onOpenImport,
}: ProjectToolbarProps) {
  return (
    <div
      className="flex h-10 shrink-0 items-center gap-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3"
      role="toolbar"
      aria-label="Project toolbar"
    >
      {/* Left cluster */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenProjects}
          title={project.name}
          className="btn-ghost h-7 max-w-[280px] gap-2 px-2"
        >
          <span
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent-primary)] text-[9px] font-bold text-[var(--text-on-accent)]"
            aria-hidden
          >
            O
          </span>
          <span className="min-w-0 truncate text-[12px] font-medium text-[var(--text-primary)]">
            {project.name}
          </span>
          <ChevronDown
            className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]"
            strokeWidth={1.75}
          />
        </button>

        <div
          className="mx-2 hidden h-4 w-px bg-[var(--border-default)] sm:block"
          aria-hidden
        />

        <button
          type="button"
          className="btn-ghost h-7 gap-2"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("orchids:view", { detail: { id: "git" } }),
            )
          }
          aria-label={`Branch ${project.branch}`}
        >
          <GitBranch
            className="h-3.5 w-3.5 text-[var(--text-secondary)]"
            strokeWidth={1.5}
          />
          <span className="font-mono text-[12px] text-[var(--text-secondary)] tabular-nums">
            {project.branch}
          </span>
        </button>
      </div>

      {/* Center — project tabs */}
      <div className="hidden min-w-0 flex-1 items-center justify-center gap-1 overflow-x-auto md:flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {projects.slice(0, 4).map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.name}
            onClick={() => onOpenProject(p)}
            className={cn(
              "h-7 max-w-[120px] truncate rounded-[var(--radius-md)] px-2 text-[12px] font-medium transition-[background-color,color] duration-[var(--duration-instant)] ease-[var(--ease-standard)]",
              p.id === project.id
                ? "bg-[var(--bg-selected)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
            )}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="flex-1 md:hidden" />

      {/* Right cluster */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost hidden h-7 gap-2 lg:inline-flex"
            onClick={onOpenSettings}
            title={model.label}
          >
            <span
              className="h-1.5 w-1.5 rounded-full bg-[var(--success)]"
              aria-hidden
            />
            <span className="max-w-[120px] truncate text-[12px]">
              {model.label}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenPlans}
            className="btn-ghost h-7 gap-2"
            title="Usage"
          >
            <Coins
              className="h-3.5 w-3.5 text-[var(--accent-primary)]"
              strokeWidth={1.5}
            />
            <span className="tabular-nums text-[12px] text-[var(--text-secondary)]">
              {formatCredits(credits)}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenImport}
            className="btn-secondary hidden sm:inline-flex"
          >
            <Cloud className="h-3.5 w-3.5" strokeWidth={1.5} />
            Import
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label="Toggle theme"
            className="btn-ghost relative h-7 w-7 overflow-hidden"
          >
            <Sun
              className={cn(
                "absolute h-3.5 w-3.5 transition-all duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
                theme === "dark"
                  ? "scale-100 opacity-100"
                  : "scale-75 opacity-0",
              )}
              strokeWidth={1.5}
            />
            <Moon
              className={cn(
                "absolute h-3.5 w-3.5 transition-all duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
                theme === "light"
                  ? "scale-100 opacity-100"
                  : "scale-75 opacity-0",
              )}
              strokeWidth={1.5}
            />
          </button>

          <button
            type="button"
            disabled
            title="Deploy requires a connected hosting provider"
            className="btn-primary cursor-not-allowed opacity-50"
          >
            <Rocket className="h-3.5 w-3.5" strokeWidth={1.75} />
            Deploy
          </button>
        </div>
      </div>
    </div>
  );
}
