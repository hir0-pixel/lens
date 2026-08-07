import { useState } from "react";
import {
  Boxes,
  ChevronDown,
  Cloud,
  Coins,
  Folder,
  Rocket,
  Settings,
  Sun,
  Moon,
} from "lucide-react";
import GithubIcon from "./ui/GithubIcon";
import { cn, formatCredits } from "../lib/utils";
import type { Model, Project, Theme } from "../lib/types";

interface TopBarProps {
  project: Project;
  projects: Project[];
  model: Model;
  credits: number;
  sessionCredits: number;
  theme: Theme;
  onOpenProject: (p: Project) => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenPlans: () => void;
  onOpenProjects: () => void;
  onOpenImport: () => void;
}

export default function TopBar({
  project,
  projects,
  model,
  credits,
  sessionCredits,
  theme,
  onOpenProject,
  onToggleTheme,
  onOpenSettings,
  onOpenPlans,
  onOpenProjects,
  onOpenImport,
}: TopBarProps) {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [creditsMenuOpen, setCreditsMenuOpen] = useState(false);

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface-1 px-3">
      <div className="relative">
        <button
          onClick={() => setProjectMenuOpen((v) => !v)}
          className="flex max-w-[320px] items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-left transition-colors hover:border-white/20 hover:bg-white/10"
        >
          <Boxes className="h-4 w-4 shrink-0 text-accent" />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium leading-tight text-zinc-100">
              {project.name}
            </div>
            <div className="flex items-center gap-1 truncate text-[11px] leading-tight text-zinc-500">
              <Folder className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{project.path}</span>
            </div>
          </div>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        </button>

        {projectMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-30"
              onClick={() => setProjectMenuOpen(false)}
            />
            <div className="absolute left-0 top-full z-40 mt-1.5 w-72 animate-scale-in rounded-lg border border-white/10 bg-surface-2 p-1.5 shadow-float-pop">
              <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                Recent projects
              </div>
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    onOpenProject(p);
                    setProjectMenuOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/5",
                    p.id === project.id && "bg-white/5",
                  )}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-zinc-200">
                      {p.name}
                    </div>
                    <div className="truncate text-[11px] text-zinc-500">
                      {p.stack}
                    </div>
                  </div>
                  {p.deployStatus === "live" && (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      live
                    </span>
                  )}
                </button>
              ))}
              <div className="mt-1 border-t border-white/10 pt-1.5">
                <button
                  onClick={() => {
                    setProjectMenuOpen(false);
                    onOpenProjects();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-zinc-300 transition-colors hover:bg-white/5"
                >
                  <Boxes className="h-3.5 w-3.5 text-zinc-500" />
                  All projects
                </button>
                <button
                  onClick={() => {
                    setProjectMenuOpen(false);
                    onOpenImport();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-zinc-300 transition-colors hover:bg-white/5"
                >
                  <Cloud className="h-3.5 w-3.5 text-zinc-500" />
                  Import project…
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mx-1 h-5 w-px bg-white/10" />

      {/* Credits indicator */}
      <div className="relative">
        <button
          onClick={() => setCreditsMenuOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[12px] font-medium text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/10"
        >
          <Coins className="h-3.5 w-3.5 text-accent" />
          <span>{formatCredits(credits)}</span>
          <span className="text-[10px] text-zinc-500">credits</span>
          {sessionCredits > 0 && (
            <span className="text-[10px] font-normal text-zinc-500">
              · −{formatCredits(sessionCredits)} this session
            </span>
          )}
          <ChevronDown className="h-3 w-3 text-zinc-500" />
        </button>

        {creditsMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-30"
              onClick={() => setCreditsMenuOpen(false)}
            />
            <div className="absolute left-0 top-full z-40 mt-1.5 w-80 animate-scale-in rounded-lg border border-white/10 bg-surface-2 p-4 shadow-float-pop">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-semibold text-zinc-100">
                    {formatCredits(credits)} credits
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    Plan resets in 12 days
                  </div>
                </div>
                <Coins className="h-6 w-6 text-accent" />
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[var(--accent-primary)]"
                  style={{ width: "68%" }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] text-zinc-500">
                <span>{formatCredits(sessionCredits)} used this session</span>
                <span>2M monthly</span>
              </div>

              <button
                onClick={() => {
                  setCreditsMenuOpen(false);
                  onOpenPlans();
                }}
                className="mt-3 w-full rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-surface-0 transition-colors hover:bg-accent-600"
              >
                Manage plan
              </button>
            </div>
          </>
        )}
      </div>

      {/* Model chip */}
      <div className="relative">
        <button
          onClick={() => setModelMenuOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[12px] font-medium text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/10"
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              model.provider === "orchids"
                ? "bg-accent"
                : model.provider === "claude"
                  ? "bg-[#D97757]"
                  : model.provider === "chatgpt"
                    ? "bg-[#10A37F]"
                    : model.provider === "gemini"
                      ? "bg-[#4285F4]"
                      : "bg-[#2490EB]",
            )}
          />
          <span className="max-w-[160px] truncate">{model.label}</span>
          <ChevronDown className="h-3 w-3 text-zinc-500" />
        </button>

        {modelMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-30"
              onClick={() => setModelMenuOpen(false)}
            />
            <div className="absolute left-0 top-full z-40 mt-1.5 w-72 animate-scale-in rounded-lg border border-white/10 bg-surface-2 p-1.5 shadow-float-pop">
              <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                Active model
              </div>
              <div className="flex items-center gap-2 rounded-md bg-white/5 px-2 py-1.5">
                <span className="h-2 w-2 rounded-full bg-accent" />
                <div className="flex-1">
                  <div className="text-[13px] text-zinc-200">
                    {model.label}
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    Powered by {model.provider} subscription
                  </div>
                </div>
              </div>
              <div className="mt-1.5 px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                Switch provider
              </div>
              {[
                { label: "Orchids (trial)", color: "bg-accent" },
                { label: "Claude Code", color: "bg-[#D97757]" },
                { label: "ChatGPT", color: "bg-[#10A37F]" },
                { label: "Gemini", color: "bg-[#4285F4]" },
                { label: "GitHub Copilot", color: "bg-[#2490EB]" },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  disabled
                  title="Use the composer model picker to change models"
                  className="flex w-full cursor-not-allowed items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-zinc-300 opacity-50"
                >
                  <span className={cn("h-2 w-2 rounded-full", p.color)} />
                  {p.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex-1" />

      {/* GitHub */}
      <button
        type="button"
        disabled
        className="flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[12px] font-medium text-zinc-300 opacity-50"
        title="Connect GitHub to enable branch sync"
      >
        <GithubIcon className="h-3.5 w-3.5" />
        <span>{project.branch}</span>
      </button>

      {/* Deploy */}
      <button
        type="button"
        disabled
        title="Deploy requires a connected hosting provider"
        className="flex cursor-not-allowed items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-surface-0 opacity-50"
      >
        <Rocket className="h-3.5 w-3.5" />
        Deploy
      </button>

      <div className="mx-1 h-5 w-px bg-white/10" />

      {/* Theme toggle */}
      <button
        onClick={onToggleTheme}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
        title="Toggle theme"
      >
        {theme === "dark" ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
        )}
      </button>

      {/* Settings */}
      <button
        onClick={onOpenSettings}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
        title="Settings"
      >
        <Settings className="h-4 w-4" />
      </button>
    </header>
  );
}
