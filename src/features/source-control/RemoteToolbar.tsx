import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CloudUpload,
  GitPullRequest,
  History,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
} from "@/components/icons/tabler";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useGitStore } from "@/stores/gitStore";

export function RemoteToolbar() {
  const fetchRemote = useGitStore((s) => s.fetchRemote);
  const pull = useGitStore((s) => s.pull);
  const push = useGitStore((s) => s.push);
  const sync = useGitStore((s) => s.sync);
  const operation = useGitStore((s) => s.operation);
  const setShowHistory = useGitStore((s) => s.setShowHistory);
  const branch = useGitStore((s) => s.getCurrentBranch());
  const [forceOpen, setForceOpen] = useState(false);

  const busy = operation !== "idle";

  return (
    <>
      <div
        className="flex h-8 shrink-0 items-center gap-0.5 border-b border-[var(--border-subtle)] px-1.5"
        role="toolbar"
        aria-label="Git remote operations"
      >
        <ToolBtn
          label="Fetch"
          disabled={busy}
          onClick={() => void fetchRemote()}
          loading={operation === "fetching"}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn
          label={`Pull${branch?.behind ? ` (${branch.behind})` : ""}`}
          disabled={busy}
          onClick={() => void pull()}
          loading={operation === "pulling"}
        >
          <ArrowDownToLine className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn
          label={`Push${branch?.ahead ? ` (${branch.ahead})` : ""}`}
          disabled={busy}
          onClick={() => void push()}
          loading={operation === "pushing"}
        >
          <ArrowUpFromLine className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn
          label="Sync"
          disabled={busy}
          onClick={() => void sync()}
          loading={operation === "syncing"}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </ToolBtn>

        <div className="mx-0.5 h-4 w-px bg-[var(--bg-hover)]" />

        <ToolBtn label="Commit History" onClick={() => setShowHistory(true)}>
          <History className="h-3.5 w-3.5" />
        </ToolBtn>

        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="More git actions">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => void push()}>
                <CloudUpload className="mr-2 h-3.5 w-3.5" />
                Publish Branch
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setForceOpen(true)} className="text-[var(--warning)]">
                Force Push…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled className="text-[var(--text-tertiary)]">
                <GitPullRequest className="mr-2 h-3.5 w-3.5" />
                Create Pull Request…
              </DropdownMenuItem>
              <DropdownMenuItem disabled className="text-[var(--text-tertiary)]">
                Open on GitHub…
              </DropdownMenuItem>
              <DropdownMenuItem disabled className="text-[var(--text-tertiary)]">
                Clone Repository…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AlertDialog open={forceOpen} onOpenChange={setForceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force push to remote?</AlertDialogTitle>
            <AlertDialogDescription>
              This will overwrite the remote branch history. Collaborators may need to
              reset their local branches. This action cannot be undone easily.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--warning)] text-[var(--text-on-accent)] hover:bg-[var(--warning)]"
              onClick={() => void push(true)}
            >
              Force Push
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ToolBtn({
  label,
  onClick,
  disabled,
  loading,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
