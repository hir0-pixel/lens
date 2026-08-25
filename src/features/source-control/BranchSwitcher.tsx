import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  GitBranch,
  ArrowDown,
  ArrowUp,
  Plus,
  Search,
  Star,
  Trash2,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useGitStore } from "@/stores/gitStore";
import { cn } from "@/lib/utils";

export function BranchSwitcher() {
  const branches = useGitStore((s) => s.branches);
  const favoriteBranches = useGitStore((s) => s.favoriteBranches);
  const checkoutBranch = useGitStore((s) => s.checkoutBranch);
  const createBranch = useGitStore((s) => s.createBranch);
  const renameBranch = useGitStore((s) => s.renameBranch);
  const deleteBranch = useGitStore((s) => s.deleteBranch);
  const toggleFavoriteBranch = useGitStore((s) => s.toggleFavoriteBranch);
  const operation = useGitStore((s) => s.operation);
  const current = branches.find((b) => b.current);

  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return branches.filter((b) => !q || b.name.toLowerCase().includes(q));
  }, [branches, query]);

  const favorites = filtered.filter((b) => favoriteBranches.includes(b.name));
  const others = filtered.filter((b) => !favoriteBranches.includes(b.name));

  return (
    <>
      <div className="border-b border-[var(--border-subtle)] px-2 py-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              disabled={operation === "checking-out"}
              className="h-8 w-full justify-between gap-2 px-2 text-[12px] font-normal hover:bg-[var(--bg-hover)]"
            >
              <span className="flex min-w-0 items-center gap-2">
                <GitBranch className="h-3.5 w-3.5 text-accent" />
                <span className="truncate text-[var(--text-primary)]">{current?.name ?? "—"}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]">
                {current && current.ahead > 0 && (
                  <span className="flex items-center gap-0.5 text-[var(--success)]">
                    <ArrowUp className="h-2.5 w-2.5" />
                    {current.ahead}
                  </span>
                )}
                {current && current.behind > 0 && (
                  <span className="flex items-center gap-0.5 text-[var(--info)]">
                    <ArrowDown className="h-2.5 w-2.5" />
                    {current.behind}
                  </span>
                )}
                <ChevronDown className="h-3.5 w-3.5" />
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72 p-0">
            <div className="border-b border-[var(--border-subtle)] p-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search branches…"
                  className="h-8 border-[var(--border-default)] bg-surface-2 pl-7 text-[12px]"
                />
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto p-1">
              {favorites.length > 0 && (
                <>
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
                    Favorites
                  </DropdownMenuLabel>
                  {favorites.map((b) => (
                    <BranchItem
                      key={b.name}
                      name={b.name}
                      current={b.current}
                      ahead={b.ahead}
                      behind={b.behind}
                      favorite
                      onSelect={() => void checkoutBranch(b.name)}
                      onToggleFavorite={() => toggleFavoriteBranch(b.name)}
                      onRename={() => {
                        setRenameTarget(b.name);
                        setRenameValue(b.name);
                      }}
                      onDelete={() => deleteBranch(b.name)}
                    />
                  ))}
                </>
              )}
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
                Local branches
              </DropdownMenuLabel>
              {others.map((b) => (
                <BranchItem
                  key={b.name}
                  name={b.name}
                  current={b.current}
                  ahead={b.ahead}
                  behind={b.behind}
                  favorite={false}
                  onSelect={() => void checkoutBranch(b.name)}
                  onToggleFavorite={() => toggleFavoriteBranch(b.name)}
                  onRename={() => {
                    setRenameTarget(b.name);
                    setRenameValue(b.name);
                  }}
                  onDelete={() => deleteBranch(b.name)}
                />
              ))}
              {filtered.length === 0 && (
                <div className="px-2 py-4 text-center text-[12px] text-[var(--text-tertiary)]">
                  No branches found
                </div>
              )}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setNewName("");
                setCreateOpen(true);
              }}
            >
              <Plus className="mr-2 h-3.5 w-3.5" />
              Create new branch…
            </DropdownMenuItem>
            <DropdownMenuItem disabled className="text-[var(--text-tertiary)]">
              Merge branch… (coming soon)
            </DropdownMenuItem>
            <DropdownMenuItem disabled className="text-[var(--text-tertiary)]">
              Rebase… (coming soon)
            </DropdownMenuItem>
            <DropdownMenuItem disabled className="text-[var(--text-tertiary)]">
              Cherry-pick… (coming soon)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create branch</DialogTitle>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="branch-name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) {
                void createBranch(newName).then(() => setCreateOpen(false));
              }
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void createBranch(newName).then(() => setCreateOpen(false))}
              disabled={!newName.trim()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(renameTarget)} onOpenChange={(v) => !v && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename branch</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameTarget && renameValue.trim()) {
                renameBranch(renameTarget, renameValue.trim());
                setRenameTarget(null);
              }
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (renameTarget && renameValue.trim()) {
                  renameBranch(renameTarget, renameValue.trim());
                  setRenameTarget(null);
                }
              }}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function BranchItem({
  name,
  current,
  ahead,
  behind,
  favorite,
  onSelect,
  onToggleFavorite,
  onRename,
  onDelete,
}: {
  name: string;
  current: boolean;
  ahead: number;
  behind: number;
  favorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <DropdownMenuItem
          onClick={onSelect}
          className={cn("gap-2", current && "bg-[var(--bg-hover)]")}
        >
          {current ? (
            <Check className="h-3.5 w-3.5 text-accent" />
          ) : (
            <GitBranch className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          )}
          <span className="min-w-0 flex-1 truncate">{name}</span>
          {favorite && <Star className="h-3 w-3 fill-accent text-accent" />}
          {(ahead > 0 || behind > 0) && (
            <span className="text-[10px] text-[var(--text-tertiary)]">
              {ahead > 0 && `↑${ahead}`}
              {behind > 0 && ` ↓${behind}`}
            </span>
          )}
        </DropdownMenuItem>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onClick={onSelect}>Checkout</ContextMenuItem>
        <ContextMenuItem onClick={onToggleFavorite}>
          <Star className="mr-2 h-3.5 w-3.5" />
          {favorite ? "Unfavorite" : "Favorite"}
        </ContextMenuItem>
        <ContextMenuItem onClick={onRename}>
          <Pencil className="mr-2 h-3.5 w-3.5" />
          Rename…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onDelete} className="text-[var(--error)] focus:text-[var(--error)]">
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Delete…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
