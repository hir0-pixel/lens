import { useState } from "react";
import { toast } from "sonner";
import Modal from "@/components/ui/Modal";
import { gitClone } from "@/features/projects/gitClone";
import { openFolderPath } from "@/features/projects/openFolder";
import { pickFolder } from "@/features/projects/pickFolder";

interface CloneRepoDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CloneRepoDialog({ open, onClose }: CloneRepoDialogProps) {
  const [url, setUrl] = useState("");
  const [dest, setDest] = useState("");
  const [busy, setBusy] = useState(false);

  async function chooseDest() {
    const selected = await pickFolder("Clone into…");
    if (selected) setDest(selected);
  }

  async function handleClone() {
    if (!url.trim() || !dest.trim()) {
      toast.error("Enter a git URL and destination folder");
      return;
    }
    const repoName =
      url
        .trim()
        .replace(/\.git$/i, "")
        .split(/[/\\]/)
        .filter(Boolean)
        .pop() ?? "repo";
    const target = `${dest.replace(/[/\\]$/, "")}${dest.includes("\\") ? "\\" : "/"}${repoName}`;
    setBusy(true);
    const result = await gitClone(url, target);
    setBusy(false);
    if (!result.ok) {
      toast.error("Clone failed", { description: result.error });
      return;
    }
    toast.success("Repository cloned");
    onClose();
    setUrl("");
    setDest("");
    await openFolderPath(result.path, { verifyExists: false });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Clone repository"
      subtitle="Clone a git repo, then open it as a project"
      size="sm"
    >
      <div className="flex flex-col gap-4 p-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">
            Git URL
          </span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/org/repo.git"
            className="h-9 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
            autoFocus
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">
            Destination
          </span>
          <div className="flex gap-2">
            <input
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              placeholder="Parent folder path"
              className="h-9 min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
            />
            <button
              type="button"
              onClick={() => void chooseDest()}
              className="h-9 shrink-0 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] px-3 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Browse
            </button>
          </div>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-[var(--radius-md)] px-3 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleClone()}
            className="h-8 rounded-[var(--radius-md)] bg-[var(--accent-primary)] px-3 text-[12px] font-medium text-[var(--text-on-accent)] disabled:opacity-50"
          >
            {busy ? "Cloning…" : "Clone"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default CloneRepoDialog;
