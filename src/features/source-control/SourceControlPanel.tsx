import { ScrollArea } from "@/components/ui/scroll-area";
import { RepositorySelector } from "./RepositorySelector";
import { BranchSwitcher } from "./BranchSwitcher";
import { RemoteToolbar } from "./RemoteToolbar";
import { CommitEditor } from "./CommitEditor";
import { ChangesTree } from "./ChangesTree";
import { ScmDiffViewer } from "./ScmDiffViewer";
import { MergeConflictView } from "./MergeConflictView";
import { CommitHistory } from "./CommitHistory";
import { useGitStore } from "@/stores/gitStore";

/**
 * Cursor/VS Code-style Source Control sidebar panel.
 */
export function SourceControlPanel() {
  const selectedDiffPath = useGitStore((s) => s.selectedDiffPath);
  const showHistory = useGitStore((s) => s.showHistory);
  const showConflicts = useGitStore((s) => s.showConflicts);
  const conflictCount = useGitStore((s) => s.getConflicts().length);
  const staged = useGitStore((s) => s.getStaged().length);
  const unstaged = useGitStore((s) => s.getUnstaged().length);
  const branch = useGitStore((s) => s.getCurrentBranch());

  const showSecondary = Boolean(selectedDiffPath) || showHistory || showConflicts;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-1" data-source-control>
      <div className="wb-panel-header justify-between !h-[35px] !border-[var(--cursor-border)] !bg-[var(--cursor-sidebar-bg)] !px-5">
        <span className="type-caption-uppercase text-[var(--cursor-fg)]">
          Source Control
        </span>
        <span className="tabular-nums type-caption text-muted-foreground">
          {staged + unstaged}
          {conflictCount > 0 && (
            <span className="ml-1 text-error">· {conflictCount} conflict</span>
          )}
        </span>
      </div>

      <RepositorySelector />
      <BranchSwitcher />
      <RemoteToolbar />

      <div className="flex min-h-0 flex-1 flex-col">
        <CommitEditor />
        <ScrollArea className="min-h-0 flex-1">
          <ChangesTree />
        </ScrollArea>

        {showSecondary && (
          <div className="flex max-h-[45%] min-h-[160px] shrink-0 flex-col">
            {showConflicts ? (
              <MergeConflictView />
            ) : showHistory ? (
              <CommitHistory />
            ) : (
              <ScmDiffViewer />
            )}
          </div>
        )}
      </div>

      <div
        className="flex h-6 shrink-0 items-center gap-2 border-t border-border px-2.5 type-caption text-muted-foreground"
        aria-live="polite"
      >
        <span className="truncate">{branch?.name ?? "—"}</span>
        {branch && branch.ahead > 0 && (
          <span className="text-success">↑{branch.ahead}</span>
        )}
        {branch && branch.behind > 0 && (
          <span className="text-info">↓{branch.behind}</span>
        )}
        {branch?.upstream && (
          <span className="ml-auto truncate text-muted-foreground/70">
            {branch.upstream}
          </span>
        )}
      </div>
    </div>
  );
}

export default SourceControlPanel;
