import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  FileCode2,
  FolderOpen,
  GitBranch,
  History,
  Search,
  Terminal,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { MentionItem, MentionKind } from "../../lib/types";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";

const KIND_ICONS: Record<MentionKind, React.ComponentType<{ className?: string }>> = {
  file: FileCode2,
  folder: FolderOpen,
  terminal: Terminal,
  git: GitBranch,
  diagnostics: AlertCircle,
  codebase: Search,
  session: History,
};

const KIND_LABELS: Record<MentionKind, string> = {
  file: "Files",
  folder: "Folders",
  terminal: "Terminal",
  git: "Git",
  diagnostics: "Diagnostics",
  codebase: "Codebase",
  session: "Past sessions",
};

interface MentionPickerProps {
  open: boolean;
  items: MentionItem[];
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (item: MentionItem) => void;
  onClose: () => void;
  position?: { top: number; left: number };
}

export function MentionPicker({
  open,
  items,
  query,
  onQueryChange,
  onSelect,
  onClose,
}: MentionPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = items.filter(
    (item) =>
      item.label.toLowerCase().includes(query.toLowerCase()) ||
      item.detail?.toLowerCase().includes(query.toLowerCase()),
  );

  const grouped = filtered.reduce<Record<MentionKind, MentionItem[]>>(
    (acc, item) => {
      if (!acc[item.kind]) acc[item.kind] = [];
      acc[item.kind].push(item);
      return acc;
    },
    {} as Record<MentionKind, MentionItem[]>,
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && filtered[activeIndex]) {
        e.preventDefault();
        onSelect(filtered[activeIndex]);
      } else if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Tab" && filtered[activeIndex]) {
        e.preventDefault();
        onSelect(filtered[activeIndex]);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, filtered, activeIndex, onSelect, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 z-50 mb-1.5 w-full animate-scale-in overflow-hidden rounded-lg border border-[var(--border-default)] bg-surface-2"
    >
      <Command shouldFilter={false} className="bg-transparent">
        <CommandInput
          value={query}
          onValueChange={onQueryChange}
          placeholder="Search files, folders, terminal…"
          className="h-9 border-none type-caption"
        />
        <CommandList className="max-h-48">
          <CommandEmpty className="py-4 type-caption text-[var(--text-tertiary)]">
            No matches found
          </CommandEmpty>
          {(Object.keys(grouped) as MentionKind[]).map((kind) => {
            const Icon = KIND_ICONS[kind];
            return (
              <CommandGroup
                key={kind}
                heading={KIND_LABELS[kind]}
                className="[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.88px] [&_[cmdk-group-heading]]:leading-[1.4]"
              >
                {grouped[kind].map((item) => {
                  const globalIndex = filtered.indexOf(item);
                  return (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      onSelect={() => onSelect(item)}
                      className={cn(
                        "gap-2 type-caption",
                        globalIndex === activeIndex && "bg-[var(--bg-hover)]",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
                      <span className="truncate">{item.label}</span>
                      {item.detail && (
                        <span className="ml-auto truncate type-caption text-[var(--text-disabled)]">
                          {item.detail}
                        </span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            );
          })}
        </CommandList>
      </Command>
    </div>
  );
}
