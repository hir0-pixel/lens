import { useMemo, useState } from "react";
import {
  MoreHorizontal,
  Pin,
  PinOff,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { Conversation } from "../../lib/types";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";

type ConversationGroup = "pinned" | "today" | "yesterday" | "older";

function groupConversations(conversations: Conversation[]) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);

  const groups: Record<ConversationGroup, Conversation[]> = {
    pinned: [],
    today: [],
    yesterday: [],
    older: [],
  };

  for (const conv of conversations) {
    if (conv.pinned) {
      groups.pinned.push(conv);
    } else if (conv.updatedAt >= todayStart) {
      groups.today.push(conv);
    } else if (conv.updatedAt >= yesterdayStart) {
      groups.yesterday.push(conv);
    } else {
      groups.older.push(conv);
    }
  }

  return groups;
}

interface ConversationHistoryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: Conversation[];
  activeId: string;
  onSelect: (id: string) => void;
  onPin: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

function ConversationRow({
  conv,
  active,
  onSelect,
  onPin,
  onDelete,
  onRename,
}: {
  conv: Conversation;
  active: boolean;
  onSelect: () => void;
  onPin: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(conv.title);

  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md pr-1 transition-colors",
          active ? "bg-[var(--bg-hover)]" : "hover:bg-[var(--bg-surface-raised)]",
        )}
      >
        <button
          onClick={onSelect}
          className="min-w-0 flex-1 px-2.5 py-2 text-left"
        >
          <div className="flex items-center gap-1.5">
            {conv.pinned && <Pin className="h-3 w-3 shrink-0 text-accent" />}
            <span className="truncate text-[13px] font-medium text-[var(--text-primary)]" title={conv.title}>
              {conv.title}
            </span>
          </div>
          <div className="truncate text-[11px] text-[var(--text-disabled)]" title={conv.preview}>
            {conv.preview}
          </div>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => { setRenameValue(conv.title); setRenameOpen(true); }}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onPin}>
              {conv.pinned ? (
                <>
                  <PinOff className="mr-2 h-3.5 w-3.5" />
                  Unpin
                </>
              ) : (
                <>
                  <Pin className="mr-2 h-3.5 w-3.5" />
                  Pin
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-[var(--error)] focus:text-[var(--error)]">
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameValue.trim()) {
                onRename(renameValue.trim());
                setRenameOpen(false);
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (renameValue.trim()) {
                  onRename(renameValue.trim());
                  setRenameOpen(false);
                }
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function GroupSection({
  label,
  items,
  activeId,
  onSelect,
  onPin,
  onDelete,
  onRename,
}: {
  label: string;
  items: Conversation[];
  activeId: string;
  onSelect: (id: string) => void;
  onPin: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mb-3">
      <div className="mb-1 px-2.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-disabled)]">
        {label}
      </div>
      {items.map((conv) => (
        <ConversationRow
          key={conv.id}
          conv={conv}
          active={conv.id === activeId}
          onSelect={() => onSelect(conv.id)}
          onPin={() => onPin(conv.id)}
          onDelete={() => onDelete(conv.id)}
          onRename={(title) => onRename(conv.id, title)}
        />
      ))}
    </div>
  );
}

export function ConversationHistory({
  open,
  onOpenChange,
  conversations,
  activeId,
  onSelect,
  onPin,
  onDelete,
  onRename,
}: ConversationHistoryProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return conversations;
    const q = query.toLowerCase();
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.preview.toLowerCase().includes(q),
    );
  }, [conversations, query]);

  const groups = groupConversations(filtered);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[300px] border-[var(--border-default)] bg-surface-1 p-0 sm:max-w-[300px]">
        <SheetHeader className="border-b border-[var(--border-subtle)] px-4 py-3">
          <SheetTitle className="text-[13px] font-semibold text-[var(--text-primary)]">
            Conversation history
          </SheetTitle>
        </SheetHeader>

        <div className="border-b border-[var(--border-subtle)] px-3 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations…"
              className="h-8 border-[var(--border-default)] bg-surface-2 pl-8 text-[12px]"
            />
          </div>
        </div>

        <ScrollArea className="h-[calc(100%-88px)]">
          <div className="p-2">
            <GroupSection
              label="Pinned"
              items={groups.pinned}
              activeId={activeId}
              onSelect={(id) => { onSelect(id); onOpenChange(false); }}
              onPin={onPin}
              onDelete={onDelete}
              onRename={onRename}
            />
            <GroupSection
              label="Today"
              items={groups.today}
              activeId={activeId}
              onSelect={(id) => { onSelect(id); onOpenChange(false); }}
              onPin={onPin}
              onDelete={onDelete}
              onRename={onRename}
            />
            <GroupSection
              label="Yesterday"
              items={groups.yesterday}
              activeId={activeId}
              onSelect={(id) => { onSelect(id); onOpenChange(false); }}
              onPin={onPin}
              onDelete={onDelete}
              onRename={onRename}
            />
            <GroupSection
              label="Older"
              items={groups.older}
              activeId={activeId}
              onSelect={(id) => { onSelect(id); onOpenChange(false); }}
              onPin={onPin}
              onDelete={onDelete}
              onRename={onRename}
            />
            {filtered.length === 0 && (
              <div className="px-2 py-8 text-center text-[12px] text-[var(--text-disabled)]">
                No conversations found
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
