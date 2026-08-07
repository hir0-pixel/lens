import { useMemo, useState } from "react";
import { FolderGit2, FolderOpen, Settings } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/stores/sessionStore";
import { openFolder, openFolderPath } from "@/features/projects/openFolder";
import GithubIcon from "@/components/ui/GithubIcon";
import { OrchidsWordmark } from "@/components/brand/OrchidsWordmark";
import { CloneRepoDialog } from "./CloneRepoDialog";

interface WelcomeScreenProps {
  planLabel?: string;
  onOpenSettings: () => void;
}

type CardIcon = typeof FolderOpen | typeof GithubIcon;

interface ActionCard {
  id: string;
  label: string;
  icon: CardIcon;
  onClick: () => void;
  badge?: string;
  disabled?: boolean;
}

/**
 * Centered welcome when no session / repo is active.
 * Orchids branding + primary project actions + recent list.
 */
export function WelcomeScreen({
  planLabel = "Pro",
  onOpenSettings,
}: WelcomeScreenProps) {
  const recentProjects = useSessionStore((s) => s.recentProjects);
  const removeRecentProject = useSessionStore((s) => s.removeRecentProject);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [missingPath, setMissingPath] = useState<string | null>(null);

  const cards: ActionCard[] = useMemo(
    () => [
      {
        id: "open",
        label: "Open project",
        icon: FolderOpen,
        onClick: () => void openFolder(),
      },
      {
        id: "clone",
        label: "Clone repo",
        icon: FolderGit2,
        onClick: () => setCloneOpen(true),
      },
      {
        id: "github",
        label: "Connect GitHub",
        icon: GithubIcon,
        badge: "Coming soon",
        disabled: true,
        onClick: () =>
          toast.message("Coming soon", {
            description: "GitHub OAuth will land in a later build.",
          }),
      },
    ],
    [],
  );

  const visibleRecent = showAllRecent
    ? recentProjects
    : recentProjects.slice(0, 5);

  async function openRecent(path: string) {
    const result = await openFolderPath(path, { verifyExists: true });
    if (result.ok) return;
    if (result.reason === "missing") {
      setMissingPath(path);
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center overflow-y-auto bg-[var(--bg-base)] px-6 py-16">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 0%, hsl(262 70% 45% / 0.12), transparent 60%)",
        }}
      />

      <div className="relative z-[1] flex w-full max-w-[560px] flex-col items-center">
        <div className="mb-10 flex items-center gap-3">
          <OrchidsWordmark size="welcome" />
          <div className="flex items-baseline gap-2 self-end pb-1">
            <span className="text-[12px] text-[var(--text-tertiary)]">
              {planLabel}
            </span>
            <button
              type="button"
              onClick={onOpenSettings}
              className="ml-1 inline-flex items-center gap-1 text-[12px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
            >
              <Settings className="h-3 w-3" strokeWidth={1.75} />
              Settings
            </button>
          </div>
        </div>

        <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.id}
                type="button"
                disabled={card.disabled}
                onClick={card.onClick}
                className={cn(
                  "group relative flex aspect-square flex-col items-start gap-3 rounded-[var(--radius-md)] bg-[var(--bg-surface-raised)] p-4 text-left transition-all duration-150",
                  "border border-[var(--border-subtle)]",
                  card.disabled
                    ? "cursor-default opacity-70"
                    : "hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]",
                )}
              >
                <Icon
                  className="h-5 w-5 text-[var(--text-secondary)] group-hover:text-[var(--accent-primary)]"
                  strokeWidth={1.75}
                />
                <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                  {card.label}
                </span>
                {card.badge && (
                  <span className="absolute bottom-3 left-4 text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                    {card.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-12 w-full">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[12px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
              Recent projects
            </h2>
            {recentProjects.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAllRecent((v) => !v)}
                className="text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              >
                {showAllRecent ? "Show less" : "View all"}
              </button>
            )}
          </div>

          {visibleRecent.length === 0 ? (
            <p className="text-[13px] text-[var(--text-tertiary)]">
              No recent projects yet. Open or clone a folder to get started.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {visibleRecent.map((p) => (
                <li key={p.path}>
                  <button
                    type="button"
                    onClick={() => void openRecent(p.path)}
                    className="flex w-full items-baseline justify-between gap-4 rounded-[var(--radius-sm)] px-2 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
                  >
                    <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
                      {p.name}
                    </span>
                    <span className="max-w-[55%] truncate text-[11px] text-[var(--text-tertiary)]">
                      {p.path}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <CloneRepoDialog open={cloneOpen} onClose={() => setCloneOpen(false)} />

      {missingPath && (
        <ModalMissing
          path={missingPath}
          onDismiss={() => setMissingPath(null)}
          onRemove={() => {
            removeRecentProject(missingPath);
            setMissingPath(null);
            toast.message("Removed from recent projects");
          }}
        />
      )}
    </div>
  );
}

function ModalMissing({
  path,
  onDismiss,
  onRemove,
}: {
  path: string;
  onDismiss: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        role="alertdialog"
        className="w-full max-w-md rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] p-5 shadow-[var(--shadow-md)]"
      >
        <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">
          Folder not found
        </h3>
        <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
          This path no longer exists on disk. Remove it from your recent list?
        </p>
        <p className="mt-2 truncate font-mono text-[11px] text-[var(--text-tertiary)]">
          {path}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="h-8 rounded-[var(--radius-md)] px-3 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            Keep
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="h-8 rounded-[var(--radius-md)] bg-[var(--accent-primary)] px-3 text-[12px] font-medium text-[var(--text-on-accent)]"
          >
            Remove from list
          </button>
        </div>
      </div>
    </div>
  );
}

export default WelcomeScreen;
