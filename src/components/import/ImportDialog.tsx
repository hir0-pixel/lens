import { useState } from "react";
import {
  Boxes,
  FolderOpen,
  Sparkles,
  Search,
  Code2,
  Wand2,
  Bot,
  LifeBuoy,
} from "lucide-react";
import GithubIcon from "../ui/GithubIcon";
import { cn } from "../../lib/utils";
import Modal from "../ui/Modal";
import { openFolder } from "@/features/projects/openFolder";
import { toast } from "sonner";

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful local/github open; other sources stay disabled. */
  onImport?: (source: string, repo?: string) => void;
  onCloneRequest?: () => void;
}

const SOURCES = [
  {
    id: "local",
    name: "Local folder",
    desc: "Open a project from your computer",
    icon: FolderOpen,
    color: "text-zinc-300",
    ready: true as const,
  },
  {
    id: "github",
    name: "GitHub",
    desc: "Clone a repository via git URL",
    icon: GithubIcon,
    color: "text-zinc-300",
    ready: true as const,
  },
  {
    id: "v0",
    name: "v0",
    desc: "Import a Vercel v0 project",
    icon: Sparkles,
    color: "text-violet-400",
    ready: false as const,
    reason: "v0 import is coming soon",
  },
  {
    id: "lovable",
    name: "Lovable",
    desc: "Import from Lovable studio",
    icon: Wand2,
    color: "text-pink-400",
    ready: false as const,
    reason: "Lovable import is coming soon",
  },
  {
    id: "replit",
    name: "Replit",
    desc: "Import a Replit project",
    icon: Code2,
    color: "text-amber-400",
    ready: false as const,
    reason: "Replit import is coming soon",
  },
  {
    id: "bolt",
    name: "Bolt",
    desc: "Import from Bolt.new",
    icon: Bot,
    color: "text-sky-400",
    ready: false as const,
    reason: "Bolt import is coming soon",
  },
];

export default function ImportDialog({
  open,
  onClose,
  onImport,
  onCloneRequest,
}: ImportDialogProps) {
  const [query, setQuery] = useState("");

  const filtered = SOURCES.filter((s) =>
    s.name.toLowerCase().includes(query.toLowerCase()),
  );

  async function handleSource(id: string) {
    if (id === "local") {
      onClose();
      await openFolder();
      onImport?.("local");
      return;
    }
    if (id === "github") {
      onClose();
      if (onCloneRequest) onCloneRequest();
      else {
        toast.message("Clone a repo", {
          description: "Use Welcome → Clone repo, or paste a git URL after opening a folder.",
        });
      }
      onImport?.("github");
      return;
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import project"
      subtitle="Start from an existing project or copy one in from another tool"
      size="lg"
    >
      <div className="p-5">
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
          <Search className="h-4 w-4 text-zinc-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search import sources…"
            className="w-full bg-transparent text-[13px] text-zinc-100 placeholder-zinc-500 outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {filtered.map((source) => (
            <button
              key={source.id}
              type="button"
              disabled={!source.ready}
              title={!source.ready ? source.reason : undefined}
              onClick={() => void handleSource(source.id)}
              className={cn(
                "group flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3.5 text-left transition-colors",
                source.ready
                  ? "hover:border-white/20 hover:bg-white/10"
                  : "cursor-not-allowed opacity-50",
              )}
            >
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5",
                  source.color,
                )}
              >
                <source.icon className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-zinc-100">
                  {source.name}
                  {!source.ready && (
                    <span className="ml-2 text-[10px] font-normal uppercase tracking-wide text-zinc-500">
                      Soon
                    </span>
                  )}
                </div>
                <div className="truncate text-[11.5px] text-zinc-500">
                  {source.desc}
                </div>
              </div>
            </button>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="flex flex-col items-center py-10 text-center">
            <Boxes className="h-8 w-8 text-zinc-600" />
            <p className="mt-3 text-[13px] text-zinc-400">
              No sources match “{query}”
            </p>
          </div>
        )}

        <div className="mt-4 flex items-center gap-1.5 text-[11.5px] text-zinc-500">
          <LifeBuoy className="h-3.5 w-3.5" />
          Prefer a folder path? Use File → Open Folder.
        </div>
      </div>
    </Modal>
  );
}
