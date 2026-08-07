import { useCallback, useRef, useState } from "react";
import { X } from "lucide-react";
import TerminalView from "@/components/output/TerminalView";
import BrowserView from "@/components/output/BrowserView";
import { useSessionStore } from "@/stores/sessionStore";
import { cn } from "@/lib/utils";

export type AgentsDockKind = "terminal" | "browser" | null;

interface AgentsSideDockProps {
  kind: AgentsDockKind;
  onClose: () => void;
  initialWidthPx?: number;
}

/**
 * Right-side dock on the Agents window — Terminal / Browser appear here
 * without leaving the agents UI (Cursor-style).
 */
export function AgentsSideDock({
  kind,
  onClose,
  initialWidthPx = 480,
}: AgentsSideDockProps) {
  const [selectMode, setSelectMode] = useState(false);
  const [width, setWidth] = useState(initialWidthPx);
  const dragging = useRef(false);
  const repositories = useSessionStore((s) => s.repositories);
  const activeRepositoryId = useSessionStore((s) => s.activeRepositoryId);
  const activeRepo = repositories.find((r) => r.id === activeRepositoryId);
  const cwd = activeRepo?.path;

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!dragging.current) return;
    const next = Math.min(
      Math.max(window.innerWidth - e.clientX, 280),
      Math.floor(window.innerWidth * 0.7),
    );
    setWidth(next);
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove]);

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    dragging.current = true;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  if (!kind) return null;

  return (
    <aside
      className={cn(
        "relative flex h-full shrink-0 flex-col border-l border-white/[0.08] bg-[#0d0d0d]",
        "animate-in slide-in-from-right duration-[var(--duration-slow)]",
      )}
      style={{ width }}
      aria-label={kind === "terminal" ? "Terminal" : "Browser"}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        onPointerDown={startResize}
        className="absolute left-0 top-0 z-10 h-full w-1 -translate-x-1/2 cursor-col-resize hover:bg-[var(--accent-primary)]/40"
      />
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-white/[0.08] px-1">
        <span className="inline-flex h-7 items-center rounded-md bg-white/[0.08] px-2 font-mono text-[12px] text-[#e8e8e8]">
          {kind === "terminal" ? ">_ shell" : "Browser"}
        </span>
        {kind === "terminal" && cwd && (
          <span
            className="ml-1 max-w-[200px] truncate font-mono text-[11px] text-[#6a6a6a]"
            title={cwd}
          >
            {cwd}
          </span>
        )}
        <button
          type="button"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded text-[#8a8a8a] hover:bg-white/[0.06] hover:text-[#e8e8e8]"
          aria-label="Close panel"
          title="Close"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <div className="min-h-0 flex-1 bg-black">
        {kind === "terminal" ? (
          <TerminalView cwd={cwd} />
        ) : (
          <BrowserView
            selectMode={selectMode}
            onToggleSelectMode={() => setSelectMode((v) => !v)}
          />
        )}
      </div>
    </aside>
  );
}

export default AgentsSideDock;
