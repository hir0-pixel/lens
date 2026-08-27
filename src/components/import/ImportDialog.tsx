import { useState } from "react";
import { Boxes, Bot, Code2, FolderOpen, LifeBuoy, Search, Sparkles, Wand2 } from "@/components/icons/tabler";
import GithubIcon from "../ui/GithubIcon";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import Modal from "../ui/Modal";
import { cn } from "../../lib/utils";
import { openFolder } from "@/features/projects/openFolder";
import { toast } from "sonner";

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImport?: (source: string, repo?: string) => void;
  onCloneRequest?: () => void;
}

const SOURCES = [
  { id: "local", name: "Local folder", desc: "Open a project from your computer", icon: FolderOpen, color: "text-foreground", ready: true },
  { id: "github", name: "GitHub", desc: "Clone a repository via git URL", icon: GithubIcon, color: "text-foreground", ready: true },
  { id: "v0", name: "v0", desc: "Import a Vercel v0 project", icon: Sparkles, color: "text-violet-400", ready: false, reason: "v0 import is coming soon" },
  { id: "lovable", name: "Lovable", desc: "Import from Lovable studio", icon: Wand2, color: "text-pink-400", ready: false, reason: "Lovable import is coming soon" },
  { id: "replit", name: "Replit", desc: "Import a Replit project", icon: Code2, color: "text-amber-400", ready: false, reason: "Replit import is coming soon" },
  { id: "bolt", name: "Bolt", desc: "Import from Bolt.new", icon: Bot, color: "text-sky-400", ready: false, reason: "Bolt import is coming soon" },
];

export default function ImportDialog({ open, onClose, onImport, onCloneRequest }: ImportDialogProps) {
  const [query, setQuery] = useState("");
  const filtered = SOURCES.filter((source) => source.name.toLowerCase().includes(query.toLowerCase()));

  async function handleSource(id: string) {
    if (id === "local") {
      onClose();
      await openFolder();
      onImport?.("local");
    } else if (id === "github") {
      onClose();
      if (onCloneRequest) onCloneRequest();
      else toast.message("Clone a repo", { description: "Use Welcome > Clone repo, or paste a git URL after opening a folder." });
      onImport?.("github");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Import project" subtitle="Start from an existing project or copy one in from another tool" size="lg">
      <div className="p-5">
        <InputGroup className="mb-4 bg-background">
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupInput autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search import sources..." />
        </InputGroup>

        <div className="grid grid-cols-2 gap-2.5">
          {filtered.map((source) => (
            <Button
              key={source.id}
              type="button"
              variant="outline"
              disabled={!source.ready}
              title={!source.ready ? source.reason : undefined}
              onClick={() => void handleSource(source.id)}
              className="h-auto justify-start gap-3 p-3.5 text-left whitespace-normal"
            >
              <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted", source.color)}>
                <source.icon className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="block type-caption font-medium text-foreground">
                  {source.name}
                  {!source.ready && <span className="ml-2 type-caption-uppercase text-muted-foreground">Soon</span>}
                </span>
                <span className="block truncate type-caption font-normal text-muted-foreground">{source.desc}</span>
              </span>
            </Button>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="flex flex-col items-center py-10 text-center">
            <Boxes className="h-8 w-8 text-muted-foreground" />
            <p className="mt-3 type-caption text-muted-foreground">No sources match &quot;{query}&quot;</p>
          </div>
        )}

        <div className="mt-4 flex items-center gap-1.5 type-caption text-muted-foreground">
          <LifeBuoy className="h-3.5 w-3.5" />
          Prefer a folder path? Use File &gt; Open Folder.
        </div>
      </div>
    </Modal>
  );
}
