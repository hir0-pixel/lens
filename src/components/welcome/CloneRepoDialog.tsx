import { useState } from "react";
import { toast } from "sonner";
import { gitClone } from "@/features/projects/gitClone";
import { openFolderPath } from "@/features/projects/openFolder";
import { pickFolder } from "@/features/projects/pickFolder";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldContent,
  FieldLabel,
} from "@/components/ui/field";
import { InputGroup, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";

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
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Clone repository</DialogTitle>
          <DialogDescription>
            Clone a git repo, then open it as a project
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="clone-url">Git URL</FieldLabel>
            <FieldContent>
              <Input
                id="clone-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/org/repo.git"
                autoFocus
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="clone-dest">Destination</FieldLabel>
            <FieldContent>
              <InputGroup>
                <InputGroupInput
                  id="clone-dest"
                  value={dest}
                  onChange={(e) => setDest(e.target.value)}
                  placeholder="Parent folder path"
                />
                <InputGroupButton onClick={() => void chooseDest()}>
                  Browse
                </InputGroupButton>
              </InputGroup>
            </FieldContent>
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={() => void handleClone()}>
            {busy ? "Cloning…" : "Clone"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CloneRepoDialog;