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

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (source: string, repo?: string) => void;
}

const SOURCES = [
  {
    id: "local",
    name: "Local folder",
    desc: "Open a project from your computer",
    icon: FolderOpen,
    color: "text-zinc-300",
  },
  {
    id: "github",
    name: "GitHub",
    desc: "Clone a repository and stay in sync",
    icon: GithubIcon,
    color: "text-zinc-300",
  },
  {
    id: "v0",
    name: "v0",
    desc: "Import a Vercel v0 project",
    icon: Sparkles,
    color: "text-violet-400",
  },
  {
    id: "lovable",
    name: "Lovable",
    desc: "Import from Lovable studio",
    icon: Wand2,
    color: "text-pink-400",
  },
  {
    id: "replit",
    name: "Replit",
    desc: "Import a Replit project",
    icon: Code2,
    color: "text-amber-400",
  },
  {
    id: "bolt",
    name: "Bolt",
    desc: "Import from Bolt.new",
    icon: Bot,
    color: "text-sky-400",
  },
];

export default function ImportDialog({
  open,
  onClose,
  onImport,
}: ImportDialogProps) {
  const [query, setQuery] = useState("");

  const filtered = SOURCES.filter((s) =>
    s.name.toLowerCase().includes(query.toLowerCase()),
  );

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
              onClick={() => onImport(source.id)}
              className="group flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3.5 text-left transition-colors hover:border-white/20 hover:bg-white/10"
            >
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5",
                  source.color,
                )}
              >
                <source.icon className="h-4.5 w-4.5 h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-zinc-100">
                  {source.name}
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
          Can't find your project? Wires any other project by pasting a folder
          path or repo URL.
        </div>
      </div>
    </Modal>
  );
}