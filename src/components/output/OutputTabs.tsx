import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Eye,
  FileCode2,
  Pin,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import BrowserView from "./BrowserView";
import EditorView from "./EditorView";
import TerminalView from "./TerminalView";
import type { OutputTab } from "@/lib/types";
import { useEditorChromeStore } from "@/stores/editorChromeStore";

interface EditorTab {
  id: string;
  path: string;
  label: string;
  dirty?: boolean;
  pinned?: boolean;
  view: OutputTab;
}

const INITIAL_TABS: EditorTab[] = [
  { id: "1", path: "src/App.tsx", label: "App.tsx", view: "editor" },
  { id: "2", path: "src/main.tsx", label: "main.tsx", view: "editor" },
  { id: "3", path: "preview", label: "preview", view: "browser" },
  {
    id: "4",
    path: "task/slack-standup",
    label: "slack-standup",
    view: "task",
  },
];

function TabIcon({ view }: { view: OutputTab }) {
  if (view === "browser")
    return <Eye className="h-3.5 w-3.5 shrink-0 text-[var(--info)]" strokeWidth={1.5} />;
  if (view === "terminal")
    return (
      <Terminal
        className="h-3.5 w-3.5 shrink-0 text-[var(--success)]"
        strokeWidth={1.5}
      />
    );
  if (view === "task")
    return (
      <Sparkles
        className="h-3.5 w-3.5 shrink-0 text-[var(--accent-primary)]"
        strokeWidth={1.5}
      />
    );
  return (
    <FileCode2
      className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]"
      strokeWidth={1.5}
    />
  );
}

/**
 * Content pane tabs — file / preview / task / terminal kinds.
 */
export default function OutputTabs() {
  const [tabs, setTabs] = useState(INITIAL_TABS);
  const [activeId, setActiveId] = useState("1");
  const [selectMode, setSelectMode] = useState(false);
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);
  const [overflowLeft, setOverflowLeft] = useState(false);
  const [overflowRight, setOverflowRight] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const dirtyPaths = useEditorChromeStore((s) => s.dirtyPaths);
  const setActivePath = useEditorChromeStore((s) => s.setActivePath);

  const orderedTabs = useMemo(() => {
    const pinned = tabs.filter((t) => t.pinned);
    const rest = tabs.filter((t) => !t.pinned);
    return [...pinned, ...rest];
  }, [tabs]);

  const active = orderedTabs.find((t) => t.id === activeId) ?? orderedTabs[0];

  useEffect(() => {
    if (active?.view === "editor") {
      setActivePath(active.path);
    }
  }, [active?.path, active?.view, setActivePath]);

  useEffect(() => {
    setTabs((prev) => {
      let changed = false;
      const next = prev.map((t) => {
        const dirty = dirtyPaths.has(t.path);
        if (Boolean(t.dirty) !== dirty) changed = true;
        return { ...t, dirty };
      });
      return changed ? next : prev;
    });
  }, [dirtyPaths]);

  useEffect(() => {
    function onOpenFile(e: Event) {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (!path) return;
      const isPreview = path === "preview" || path.startsWith("preview/");
      const isTask = path.startsWith("task/");
      const isTerminal = path === "terminal" || path.startsWith("terminal/");
      const label = isPreview
        ? "preview"
        : isTerminal
          ? "powershell"
          : (path.split("/").pop() ?? path);
      const view: OutputTab = isPreview
        ? "browser"
        : isTask
          ? "task"
          : isTerminal
            ? "terminal"
            : "editor";
      setTabs((prev) => {
        const existing = prev.find(
          (t) =>
            t.path === path ||
            (isPreview && t.view === "browser") ||
            (isTerminal && t.view === "terminal"),
        );
        if (existing) {
          setActiveId(existing.id);
          return prev;
        }
        const id = `t-${Date.now()}`;
        setActiveId(id);
        return [...prev, { id, path, label, view }];
      });
    }
    function onFocusTerminal() {
      setTabs((prev) => {
        const existing = prev.find((t) => t.view === "terminal");
        if (existing) {
          setActiveId(existing.id);
          return prev;
        }
        const id = `term-${Date.now()}`;
        setActiveId(id);
        return [
          ...prev,
          {
            id,
            path: "terminal/powershell",
            label: "powershell",
            view: "terminal" as const,
          },
        ];
      });
    }
    function onFocusEditor() {
      setTabs((prev) => {
        const existing = prev.find((t) => t.view === "editor");
        if (existing) {
          setActiveId(existing.id);
          return prev;
        }
        const id = `ed-${Date.now()}`;
        setActiveId(id);
        return [
          ...prev,
          {
            id,
            path: "src/App.tsx",
            label: "App.tsx",
            view: "editor" as const,
          },
        ];
      });
    }
    window.addEventListener("lens:open-file", onOpenFile);
    window.addEventListener("lens:focus-terminal", onFocusTerminal);
    window.addEventListener("lens:focus-editor", onFocusEditor);
    return () => {
      window.removeEventListener("lens:open-file", onOpenFile);
      window.removeEventListener("lens:focus-terminal", onFocusTerminal);
      window.removeEventListener("lens:focus-editor", onFocusEditor);
    };
  }, []);

  function updateOverflow() {
    const el = scrollerRef.current;
    if (!el) return;
    setOverflowLeft(el.scrollLeft > 2);
    setOverflowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }

  useEffect(() => {
    updateOverflow();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateOverflow);
    const ro = new ResizeObserver(updateOverflow);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateOverflow);
      ro.disconnect();
    };
  }, [tabs.length]);

  function closeTab(id: string) {
    setTabs((prev) => {
      const target = prev.find((t) => t.id === id);
      if (target?.pinned) return prev;
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      if (activeId === id) {
        const fallback = next[Math.max(0, idx - 1)] ?? next[0];
        setActiveId(fallback.id);
      }
      return next;
    });
  }

  function togglePin(id: string) {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t)),
    );
  }

  const crumbs = (active?.path ?? "").split("/").filter(Boolean);

  return (
    <div className="cursor-editor flex h-full flex-col">
      <div className="relative flex shrink-0">
        {overflowLeft && (
          <div
            className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-6 bg-gradient-to-r from-[var(--bg-surface)] to-transparent"
            aria-hidden
          />
        )}
        <div
          ref={scrollerRef}
          className="cursor-tabs flex flex-1 items-stretch overflow-x-auto"
          role="tablist"
        >
          {orderedTabs.map((t) => {
            const isActive = t.id === activeId;
            const showClose =
              !t.pinned && (isActive || hoveredTab === t.id);
            return (
              <div
                key={t.id}
                role="tab"
                aria-selected={isActive}
                data-active={isActive}
                data-kind={t.view}
                onMouseEnter={() => setHoveredTab(t.id)}
                onMouseLeave={() => setHoveredTab(null)}
                onClick={() => setActiveId(t.id)}
                onDoubleClick={() => togglePin(t.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  togglePin(t.id);
                }}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    closeTab(t.id);
                  }
                }}
                className={cn(
                  "cursor-tab group relative flex max-w-[180px] min-w-[120px] shrink-0 cursor-pointer items-center gap-2",
                  "transition-[color,background-color,box-shadow] duration-[var(--duration-instant)] ease-[var(--ease-standard)]",
                )}
              >
                {t.pinned && (
                  <Pin
                    className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]"
                    strokeWidth={1.75}
                  />
                )}
                <TabIcon view={t.view} />
                <span className="min-w-0 flex-1 truncate" title={t.label}>
                  {t.label}
                </span>
                {t.dirty && (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-primary)] transition-opacity duration-[var(--duration-fast)] group-hover:opacity-0"
                    title="Unsaved"
                  />
                )}
                <button
                  type="button"
                  aria-label={t.pinned ? `Unpin ${t.label}` : `Close ${t.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (t.pinned) togglePin(t.id);
                    else closeTab(t.id);
                  }}
                  className={cn(
                    "absolute right-2 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)]",
                    "transition-opacity duration-[var(--duration-fast)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                    showClose || t.pinned ? "opacity-100" : "opacity-0",
                  )}
                >
                  {t.pinned ? (
                    <Pin className="h-3 w-3" strokeWidth={1.75} />
                  ) : (
                    <X className="h-3 w-3" strokeWidth={1.75} />
                  )}
                </button>
              </div>
            );
          })}
        </div>
        {overflowRight && (
          <div
            className="pointer-events-none absolute inset-y-0 right-0 z-[1] w-6 bg-gradient-to-l from-[var(--bg-surface)] to-transparent"
            aria-hidden
          />
        )}
      </div>

      {active?.view === "editor" && (
        <nav
          className="flex h-[22px] shrink-0 items-center gap-0.5 overflow-hidden border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 type-caption text-[var(--text-tertiary)]"
          aria-label="Breadcrumbs"
        >
          {crumbs.map((c, i) => (
            <span key={`${c}-${i}`} className="flex items-center gap-0.5">
              {i > 0 && (
                <ChevronRight className="h-3 w-3 opacity-60" strokeWidth={1.5} />
              )}
              <button
                type="button"
                className="max-w-[120px] truncate transition-colors duration-[var(--duration-instant)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
                title={crumbs.slice(0, i + 1).join("/")}
                onClick={() => {
                  if (i < crumbs.length - 1) {
                    const folder = crumbs.slice(0, i + 1).join("/");
                    window.dispatchEvent(
                      new CustomEvent("lens:view", {
                        detail: { id: "explorer" },
                      }),
                    );
                    void navigator.clipboard?.writeText(folder);
                  }
                }}
              >
                {c}
              </button>
            </span>
          ))}
        </nav>
      )}

      <div className="min-h-0 flex-1 animate-cursor-fade">
        {active?.view === "browser" && (
          <BrowserView
            selectMode={selectMode}
            onToggleSelectMode={() => setSelectMode((v) => !v)}
          />
        )}
        {active?.view === "editor" && <EditorView path={active.path} />}
        {active?.view === "terminal" && <TerminalView />}
        {active?.view === "task" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--bg-canvas)] px-6 text-center">
            <Sparkles
              className="h-8 w-8 text-[var(--accent-primary)]"
              strokeWidth={1.25}
            />
            <h2 className="type-title-sm text-[var(--text-primary)]">
              {active.label}
            </h2>
            <p className="max-w-sm type-caption leading-6 text-[var(--text-secondary)]">
              Agent task surface — run logs, tool traces, and outputs appear here
              while the session drives the work from the agent panel.
            </p>
          </div>
        )}
        {!active?.view && <EditorView path={active?.path} />}
      </div>
    </div>
  );
}
