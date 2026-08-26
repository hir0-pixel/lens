import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getWorkspaceFiles } from "@/shared/search/workspaceIndex";
import { CURSOR_MOTION } from "@/shared/design-system/cursorMotion";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TreeNode {
  id: string;
  name: string;
  path: string;
  kind: "file" | "folder";
  children?: TreeNode[];
}

function cloneTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((n) => ({
    ...n,
    children: n.children ? cloneTree(n.children) : undefined,
  }));
}

function sortNodes(nodes: TreeNode[]) {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const n of nodes) if (n.children) sortNodes(n.children);
}

function buildTree(): TreeNode[] {
  const files = getWorkspaceFiles().filter((f) => f.kind === "file");
  const root: TreeNode = {
    id: "root",
    name: "finance-dashboard",
    path: "",
    kind: "folder",
    children: [],
  };

  for (const f of files) {
    const parts = f.path.split("/");
    let cursor = root;
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      acc = acc ? `${acc}/${part}` : part;
      const isFile = i === parts.length - 1;
      if (!cursor.children) cursor.children = [];
      let next = cursor.children.find((c) => c.name === part);
      if (!next) {
        next = {
          id: acc,
          name: part,
          path: acc,
          kind: isFile ? "file" : "folder",
          children: isFile ? undefined : [],
        };
        cursor.children.push(next);
      }
      cursor = next;
    }
  }

  sortNodes(root.children ?? []);
  return root.children ?? [];
}

function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.children) {
      const found = findNode(n.children, path);
      if (found) return found;
    }
  }
  return null;
}

function removeNode(nodes: TreeNode[], path: string): TreeNode[] {
  return nodes
    .filter((n) => n.path !== path)
    .map((n) =>
      n.children
        ? { ...n, children: removeNode(n.children, path) }
        : n,
    );
}

function renameInTree(
  nodes: TreeNode[],
  path: string,
  newName: string,
): TreeNode[] {
  return nodes.map((n) => {
    if (n.path === path) {
      const parent = path.includes("/")
        ? path.slice(0, path.lastIndexOf("/"))
        : "";
      const newPath = parent ? `${parent}/${newName}` : newName;
      return { ...n, name: newName, path: newPath, id: newPath };
    }
    if (n.children) {
      return { ...n, children: renameInTree(n.children, path, newName) };
    }
    return n;
  });
}

function insertChild(
  nodes: TreeNode[],
  parentPath: string,
  child: TreeNode,
): TreeNode[] {
  if (!parentPath) {
    const next = [...nodes, child];
    sortNodes(next);
    return next;
  }
  return nodes.map((n) => {
    if (n.path === parentPath && n.kind === "folder") {
      const children = [...(n.children ?? []), child];
      sortNodes(children);
      return { ...n, children };
    }
    if (n.children) {
      return {
        ...n,
        children: insertChild(n.children, parentPath, child),
      };
    }
    return n;
  });
}

function fileIcon(name: string) {
  if (name.endsWith(".json")) return FileJson;
  if (name.endsWith(".md") || name.endsWith(".css")) return FileText;
  return FileCode2;
}

/**
 * Explorer — IDE density rows, CRUD, rename, multi-select, basic DnD.
 */
export function ExplorerPanel({
  onOpenFile,
}: {
  onOpenFile?: (path: string) => void;
}) {
  const initial = useMemo(() => buildTree(), []);
  const [tree, setTree] = useState(() => cloneTree(initial));
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(["src", "src/components"]),
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(["src/App.tsx"]),
  );
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  function selectPath(path: string, multi: boolean) {
    setSelected((prev) => {
      if (multi) {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }
      return new Set([path]);
    });
  }

  function openFile(path: string) {
    onOpenFile?.(path);
    window.dispatchEvent(
      new CustomEvent("lens:open-file", { detail: { path } }),
    );
  }

  function startRename(path: string) {
    const node = findNode(tree, path);
    if (!node) return;
    setRenaming(path);
    setRenameValue(node.name);
  }

  function commitRename() {
    if (!renaming || !renameValue.trim()) {
      setRenaming(null);
      return;
    }
    const name = renameValue.trim();
    setTree((prev) => renameInTree(prev, renaming, name));
    setSelected(new Set([
      renaming.includes("/")
        ? `${renaming.slice(0, renaming.lastIndexOf("/"))}/${name}`
        : name,
    ]));
    setRenaming(null);
  }

  function deleteSelected(path?: string) {
    const targets = path ? [path] : [...selected];
    setTree((prev) => {
      let next = prev;
      for (const p of targets) next = removeNode(next, p);
      return next;
    });
    setSelected(new Set());
  }

  function createItem(kind: "file" | "folder", parentPath?: string) {
    const parent =
      parentPath ??
      [...selected].find((p) => findNode(tree, p)?.kind === "folder") ??
      "";
    const base = kind === "file" ? "untitled.tsx" : "New Folder";
    let name = base;
    let i = 1;
    const parentNode = parent ? findNode(tree, parent) : null;
    const siblings = parentNode?.children ?? tree;
    while (siblings.some((s) => s.name === name)) {
      name =
        kind === "file" ? `untitled-${i}.tsx` : `New Folder ${i}`;
      i++;
    }
    const path = parent ? `${parent}/${name}` : name;
    const child: TreeNode = {
      id: path,
      name,
      path,
      kind,
      children: kind === "folder" ? [] : undefined,
    };
    setTree((prev) => insertChild(prev, parent, child));
    if (parent) {
      setExpanded((prev) => new Set(prev).add(parent));
    }
    setSelected(new Set([path]));
    setRenaming(path);
    setRenameValue(name);
    if (kind === "file") openFile(path);
  }

  function onDropOnto(folderPath: string) {
    if (!dragPath || dragPath === folderPath) {
      setDragPath(null);
      setDropTarget(null);
      return;
    }
    if (folderPath.startsWith(dragPath + "/")) {
      setDragPath(null);
      setDropTarget(null);
      return;
    }
    const node = findNode(tree, dragPath);
    if (!node) return;
    setTree((prev) => {
      const without = removeNode(prev, dragPath);
      const moved: TreeNode = {
        ...node,
        path: folderPath ? `${folderPath}/${node.name}` : node.name,
        id: folderPath ? `${folderPath}/${node.name}` : node.name,
      };
      return insertChild(without, folderPath, moved);
    });
    setExpanded((prev) => new Set(prev).add(folderPath));
    setDragPath(null);
    setDropTarget(null);
  }

  function matchesFilter(node: TreeNode): boolean {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    if (node.name.toLowerCase().includes(q)) return true;
    if (node.children) return node.children.some(matchesFilter);
    return false;
  }

  function renderNode(node: TreeNode, depth: number): ReactNode {
    if (!matchesFilter(node)) return null;
    const isFolder = node.kind === "folder";
    const isOpen = expanded.has(node.path);
    const isSelected = selected.has(node.path);
    const isDrop = dropTarget === node.path;
    const Icon = isFolder
      ? isOpen
        ? FolderOpen
        : Folder
      : fileIcon(node.name);
    const padLeft = 8 + depth * CURSOR_MOTION.treeIndent;

    return (
      <div key={node.path}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              role="treeitem"
              aria-expanded={isFolder ? isOpen : undefined}
              aria-selected={isSelected}
              tabIndex={0}
              draggable
              onDragStart={(e) => {
                setDragPath(node.path);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (!isFolder) return;
                e.preventDefault();
                setDropTarget(node.path);
              }}
              onDragLeave={() => {
                if (dropTarget === node.path) setDropTarget(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (isFolder) onDropOnto(node.path);
              }}
              onClick={(e) => {
                selectPath(node.path, e.metaKey || e.ctrlKey);
                if (isFolder) toggle(node.path);
                else openFile(node.path);
              }}
              onDoubleClick={() => {
                if (!isFolder) startRename(node.path);
              }}
              onKeyDown={(e) => {
                if (e.key === "F2") {
                  e.preventDefault();
                  startRename(node.path);
                }
                if (e.key === "Delete") {
                  e.preventDefault();
                  deleteSelected(node.path);
                }
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).click();
                }
                if (e.key === "ArrowRight" && isFolder && !isOpen) {
                  toggle(node.path);
                }
                if (e.key === "ArrowLeft" && isFolder && isOpen) {
                  toggle(node.path);
                }
              }}
              className={cn(
                "group relative flex cursor-pointer items-center gap-0.5 pr-2 type-caption outline-none",
                "transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)]",
                isDrop && "outline outline-1 -outline-offset-1 outline-[var(--accent-primary)]",
                isSelected && "bg-[var(--bg-selected)] text-[var(--text-primary)]",
              )}
              style={{
                height: CURSOR_MOTION.listRowHeight,
                paddingLeft: padLeft,
                background: !isSelected
                  ? isDrop
                    ? "var(--bg-hover)"
                    : undefined
                  : undefined,
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  (e.currentTarget as HTMLElement).style.background =
                    "var(--bg-hover)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected && !isDrop) {
                  (e.currentTarget as HTMLElement).style.background =
                    "transparent";
                }
              }}
            >
              {isSelected && (
                <span
                  className="absolute bottom-0.5 left-0 top-0.5 w-0.5 origin-center rounded-sm bg-[var(--accent-primary)] animate-[lens-bar-in_var(--duration-fast)_var(--ease-standard)_both]"
                  aria-hidden
                />
              )}
              <button
                type="button"
                tabIndex={-1}
                aria-hidden={!isFolder}
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center text-[var(--ds-fg-muted)]",
                  !isFolder && "opacity-0",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isFolder) toggle(node.path);
                }}
              >
                {isFolder &&
                  (isOpen ? (
                    <ChevronDown
                      className="h-4 w-4 transition-transform duration-[var(--ds-dur-normal)] ease-[var(--ds-ease)]"
                      strokeWidth={1.5}
                    />
                  ) : (
                    <ChevronRight
                      className="h-4 w-4 transition-transform duration-[var(--ds-dur-normal)] ease-[var(--ds-ease)]"
                      strokeWidth={1.5}
                    />
                  ))}
              </button>
              <Icon
                className={cn(
                  "mr-1 h-4 w-4 shrink-0",
                  isFolder
                    ? "text-[var(--warning)]"
                    : "text-[var(--ds-fg-muted)]",
                )}
                strokeWidth={1.5}
              />
              {renaming === node.path ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="h-[18px] min-w-0 flex-1 rounded-[2px] border border-[var(--cursor-focus)] bg-[var(--cursor-input-bg)] px-1 type-caption text-[var(--ds-fg)] outline-none"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate leading-[22px]">
                  {node.name}
                </span>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="min-w-[180px] rounded-none border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] p-0 type-caption animate-cursor-fade">
            {isFolder ? (
              <>
                <ContextMenuItem
                  className="h-[26px] rounded-none px-3 data-[highlighted]:bg-[var(--cursor-focus)] data-[highlighted]:text-white"
                  onSelect={() => createItem("file", node.path)}
                >
                  New File…
                </ContextMenuItem>
                <ContextMenuItem
                  className="h-[26px] rounded-none px-3 data-[highlighted]:bg-[var(--cursor-focus)] data-[highlighted]:text-white"
                  onSelect={() => createItem("folder", node.path)}
                >
                  New Folder…
                </ContextMenuItem>
                <ContextMenuSeparator className="bg-[var(--ds-border)]" />
              </>
            ) : null}
            <ContextMenuItem
              className="h-[26px] rounded-none px-3 data-[highlighted]:bg-[var(--cursor-focus)] data-[highlighted]:text-white"
              onSelect={() => !isFolder && openFile(node.path)}
            >
              Open
            </ContextMenuItem>
            <ContextMenuItem
              className="h-[26px] rounded-none px-3 data-[highlighted]:bg-[var(--cursor-focus)] data-[highlighted]:text-white"
              onSelect={() => void navigator.clipboard?.writeText(node.path)}
            >
              Copy Path
            </ContextMenuItem>
            <ContextMenuSeparator className="bg-[var(--ds-border)]" />
            <ContextMenuItem
              className="h-[26px] rounded-none px-3 data-[highlighted]:bg-[var(--cursor-focus)] data-[highlighted]:text-white"
              onSelect={() => startRename(node.path)}
            >
              Rename…
            </ContextMenuItem>
            <ContextMenuItem
              className="h-[26px] rounded-none px-3 text-[var(--ds-error)] data-[highlighted]:bg-[var(--cursor-focus)] data-[highlighted]:text-white"
              onSelect={() => deleteSelected(node.path)}
            >
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {isFolder && isOpen && node.children && (
          <div className="animate-cursor-fade">
            {node.children.map((c) => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" role="tree" aria-label="Explorer">
      <div className="flex h-[22px] shrink-0 items-center gap-0.5 px-2">
        <span className="min-w-0 flex-1 truncate type-caption-uppercase text-[var(--ds-fg)]">
          finance-dashboard
        </span>
        <ExplorerAction
          label="New File…"
          onClick={() => createItem("file")}
        >
          <FileCode2 className="h-4 w-4" strokeWidth={1.5} />
        </ExplorerAction>
        <ExplorerAction
          label="New Folder…"
          onClick={() => createItem("folder")}
        >
          <Folder className="h-4 w-4" strokeWidth={1.5} />
        </ExplorerAction>
        <ExplorerAction
          label="Refresh Explorer"
          onClick={() => setTree(cloneTree(buildTree()))}
        >
          <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
        </ExplorerAction>
      </div>
      <div className="px-2 pb-1">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files…"
          aria-label="Filter explorer"
          className="cursor-input h-[22px] w-full px-1.5 type-caption"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-0.5">
        {tree.map((n) => renderNode(n, 0))}
      </div>
    </div>
  );
}

function ExplorerAction({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className="flex h-[22px] w-[22px] items-center justify-center text-[var(--ds-fg-muted)] transition-colors duration-[var(--ds-dur-fast)] hover:bg-[var(--ds-hover)] hover:text-[var(--ds-fg)]"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="rounded-none border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] px-2 py-1 type-caption animate-cursor-fade"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
