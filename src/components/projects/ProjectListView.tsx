import {
  Boxes,
  CloudDownload,
  Folder,
  GitBranch,
  Plus,
  Rocket,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { Project } from "../../lib/types";

interface ProjectListViewProps {
  projects: Project[];
  onOpenProject: (p: Project) => void;
  onOpenImport: () => void;
  onBack: () => void;
}

const STATUS_STYLES: Record<
  Project["deployStatus"],
  { label: string; cls: string }
> = {
  live: { label: "Live", cls: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
  building: { label: "Building", cls: "text-accent bg-accent/10 border-accent/20" },
  failed: { label: "Failed", cls: "text-red-400 bg-red-400/10 border-red-400/20" },
  idle: { label: "Not deployed", cls: "text-zinc-400 bg-white/5 border-white/10" },
};

export default function ProjectListView({
  projects,
  onOpenProject,
  onOpenImport,
  onBack,
}: ProjectListViewProps) {
  return (
    <div className="flex h-full flex-col bg-surface-0">
      <div className="border-b border-white/5 px-5 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-zinc-100">Projects</h1>
            <p className="text-[12px] text-zinc-500">
              {projects.length} recent projects
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenImport}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[12.5px] font-medium text-zinc-200 transition-colors hover:bg-white/10"
            >
              <CloudDownload className="h-3.5 w-3.5" />
              Import
            </button>
            <button
              onClick={onOpenImport}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-surface-0 transition-colors hover:bg-accent-600"
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const status = STATUS_STYLES[p.deployStatus];
            return (
              <button
                key={p.id}
                onClick={() => onOpenProject(p)}
                className="group rounded-lg border border-white/10 bg-white/5 p-4 text-left transition-colors hover:border-white/20 hover:bg-white/10"
              >
                <div className="flex items-start justify-between">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5">
                    <Boxes className="h-4 w-4" style={{ color: p.color }} />
                  </div>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10.5px] font-medium",
                      status.cls,
                    )}
                  >
                    {status.label}
                  </span>
                </div>
                <div className="mt-3 truncate text-[14px] font-medium text-zinc-100">
                  {p.name}
                </div>
                <div className="mt-0.5 truncate text-[11.5px] text-zinc-500">
                  {p.stack}
                </div>
                <div className="mt-3 flex items-center gap-3 border-t border-white/10 pt-2.5 text-[11px] text-zinc-500">
                  <span className="flex min-w-0 items-center gap-1">
                    <Folder className="h-3 w-3 shrink-0" />
                    <span className="truncate">{p.path}</span>
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-[11px] text-zinc-600">
                  <span className="flex items-center gap-1">
                    <GitBranch className="h-3 w-3" />
                    {p.branch}
                  </span>
                  <span>{p.updatedAt}</span>
                  {p.deployedUrl && (
                    <span className="ml-auto flex items-center gap-1 text-emerald-400/80">
                      <Rocket className="h-3 w-3" />
                      {p.deployedUrl.replace("https://", "")}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-white/5 px-5 py-3">
        <button
          onClick={onBack}
          className="text-[12.5px] text-zinc-400 transition-colors hover:text-zinc-100"
        >
          ← Back to workspace
        </button>
      </div>
    </div>
  );
}