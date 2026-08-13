import { useMemo, useState } from "react";
import { FolderGit2, FolderOpen, Settings } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/stores/sessionStore";
import { openFolder, openFolderPath } from "@/features/projects/openFolder";
import GithubIcon from "@/components/ui/GithubIcon";
import { LensWordmark } from "@/components/brand/LensWordmark";
import { CloneRepoDialog } from "./CloneRepoDialog";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
 * Lens branding + primary project actions + recent list.
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
          <LensWordmark size="welcome" />
          <div className="flex items-end gap-2 self-end pb-1">
            <Badge variant="secondary" className="h-auto px-1.5 py-0.5 text-[11px] leading-none">
              {planLabel}
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onOpenSettings}
              className="ml-1 h-auto gap-1 px-1 text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            >
              <Settings className="h-3 w-3" strokeWidth={1.75} />
              Settings
            </Button>
          </div>
        </div>

        <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <Card
                key={card.id}
                className={cn(
                  "aspect-square transition-all duration-150",
                  card.disabled
                    ? "opacity-70"
                    : "hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]",
                )}
              >
                <CardContent className="h-full p-0">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={card.disabled}
                    onClick={card.onClick}
                    className={cn(
                      "group flex h-full w-full flex-col items-start justify-start gap-3 rounded-none p-4",
                      card.disabled ? "cursor-default disabled:opacity-100" : "",
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
                      <Badge
                        variant="secondary"
                        className="mt-auto h-auto px-1 text-[10px] font-medium uppercase tracking-wide"
                      >
                        {card.badge}
                      </Badge>
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-12 w-full">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[12px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
              Recent projects
            </h2>
            {recentProjects.length > 5 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowAllRecent((v) => !v)}
                className="h-auto px-1 text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              >
                {showAllRecent ? "Show less" : "View all"}
              </Button>
            )}
          </div>

          {visibleRecent.length === 0 ? (
            <Alert variant="default" className="gap-1 bg-transparent px-0 py-0.5">
              <AlertDescription className="text-[13px]">
                No recent projects yet. Open or clone a folder to get started.
              </AlertDescription>
            </Alert>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {visibleRecent.map((p) => (
                <li key={p.path}>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void openRecent(p.path)}
                    className="h-auto w-full items-center justify-between gap-4 rounded-[var(--radius-sm)] px-2 py-2"
                  >
                    <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
                      {p.name}
                    </span>
                    <span className="max-w-[55%] truncate text-[11px] text-[var(--text-tertiary)]">
                      {p.path}
                    </span>
                  </Button>
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
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Folder not found</DialogTitle>
          <DialogDescription>
            This path no longer exists on disk. Remove it from your recent
            list?
          </DialogDescription>
        </DialogHeader>
        <p className="truncate font-mono text-[11px] text-[var(--text-tertiary)]">
          {path}
        </p>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onDismiss}>
            Keep
          </Button>
          <Button type="button" onClick={onRemove}>
            Remove from list
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default WelcomeScreen;