import {
  Boxes,
  CloudDownload,
  Folder,
  FolderOpen,
  GitBranch,
  Plus,
  Rocket,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { Project } from "../../lib/types";
import { WorkbenchEmptyState } from "../ui/WorkbenchEmptyState";

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
  live: {
    label: "Live",
    cls: "text-success bg-emerald-400/10 border-emerald-400/20",
  },
  building: {
    label: "Building",
    cls: "text-accent bg-accent/10 border-accent/20",
  },
  failed: {
    label: "Failed",
    cls: "text-error bg-red-400/10 border-red-400/20",
  },
  idle: {
    label: "Not deployed",
    cls: "text-muted-foreground bg-secondary border-border",
  },
};

export default function ProjectListView({
  projects,
  onOpenProject,
  onOpenImport,
  onBack,
}: ProjectListViewProps) {
  return (
    <div className="flex h-full flex-col bg-surface-0">
      <div className="border-b border-border px-5 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[15px] font-semibold text-foreground">
              Projects
            </h1>
            <p className="text-[12px] text-muted-foreground">
              {projects.length} recent project{projects.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenImport}
              className="flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-[12px] font-medium text-foreground/90 transition-colors duration-150 hover:bg-secondary/80"
            >
              <CloudDownload className="h-3.5 w-3.5" />
              Import
            </button>
            <button
              type="button"
              onClick={onOpenImport}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-foreground transition-colors duration-150 hover:bg-accent-600"
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {projects.length === 0 ? (
          <WorkbenchEmptyState
            icon={FolderOpen}
            title="No recent projects"
            description="Import a repository or create a new project to get started."
            actions={[
              { label: "Import project", onClick: onOpenImport },
              {
                label: "New project",
                onClick: onOpenImport,
                variant: "primary",
              },
            ]}
            shortcuts={[
              { keys: "Ctrl+O", label: "Open folder" },
              { keys: "Ctrl+Shift+P", label: "Command palette" },
            ]}
          />
        ) : (
          <div className="mx-auto grid max-w-4xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => {
              const status = STATUS_STYLES[p.deployStatus];
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onOpenProject(p)}
                  className="group rounded-lg border border-border bg-secondary/40 p-4 text-left transition-colors duration-150 hover:border-border hover:bg-secondary"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-2">
                      <Boxes className="h-4 w-4" style={{ color: p.color }} />
                    </div>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                        status.cls,
                      )}
                    >
                      {status.label}
                    </span>
                  </div>
                  <div className="mt-3 truncate text-[14px] font-medium text-foreground">
                    {p.name}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {p.stack}
                  </div>
                  <div className="mt-3 flex items-center gap-3 border-t border-border pt-2.5 text-[11px] text-muted-foreground">
                    <span className="flex min-w-0 items-center gap-1">
                      <Folder className="h-3 w-3 shrink-0" />
                      <span className="truncate">{p.path}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground/80">
                    <span className="flex items-center gap-1">
                      <GitBranch className="h-3 w-3" />
                      {p.branch}
                    </span>
                    <span>{p.updatedAt}</span>
                    {p.deployedUrl && (
                      <span className="ml-auto flex items-center gap-1 text-success/80">
                        <Rocket className="h-3 w-3" />
                        {p.deployedUrl.replace("https://", "")}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-border px-5 py-3">
        <button
          type="button"
          onClick={onBack}
          className="text-[12px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          ← Back to workspace
        </button>
      </div>
    </div>
  );
}
