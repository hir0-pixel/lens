import { useCallback, useRef, useState } from "react";
import {
  FilePlus2,
  Globe,
  MessageSquare,
  SquareTerminal,
  X,
} from "lucide-react";
import TerminalView from "@/components/output/TerminalView";
import BrowserView from "@/components/output/BrowserView";
import { useGitStore } from "@/stores/gitStore";
import { useSessionStore } from "@/stores/sessionStore";
import { cn } from "@/lib/utils";

export type AgentsDockKind =
  | "picker"
  | "terminal"
  | "browser"
  | "review"
  | "conversation"
  | null;

interface AgentsSideDockProps {
  kind: AgentsDockKind;
  onClose: () => void;
  onOpenTab?: (kind: Exclude<AgentsDockKind, null | "picker">) => void;
  initialWidthPx?: number;
}

const TAB_OPTIONS: {
  kind: Exclude<AgentsDockKind, null | "picker">;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}[] = [
  { kind: "conversation", label: "Side conversation", icon: MessageSquare },
  { kind: "review", label: "Review", icon: FilePlus2 },
  { kind: "terminal", label: "Terminal", icon: SquareTerminal },
  { kind: "browser", label: "Browser", icon: Globe },
];

function tabLabel(kind: AgentsDockKind) {
  if (kind === "terminal") return ">_ shell";
  if (kind === "browser") return "Browser";
  if (kind === "review") return "Review";
  if (kind === "conversation") return "Side conversation";
  return "Open tab";
}

/**
 * Right-side dock on the Agents window — picker, review, terminal, browser.
 */
export function AgentsSideDock({
  kind,
  onClose,
  onOpenTab,
  initialWidthPx = 480,
}: AgentsSideDockProps) {
  const [selectMode, setSelectMode] = useState(false);
  const [width, setWidth] = useState(initialWidthPx);
  const dragging = useRef(false);
  const repositories = useSessionStore((s) => s.repositories);
  const activeRepositoryId = useSessionStore((s) => s.activeRepositoryId);
  const activeRepo = repositories.find((r) => r.id === activeRepositoryId);
  const cwd = activeRepo?.path;
  const changes = useGitStore((s) => s.changes);

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

  function pick(next: Exclude<AgentsDockKind, null | "picker">) {
    if (onOpenTab) onOpenTab(next);
    else
      window.dispatchEvent(
        new CustomEvent("lens:open-agents-tab", { detail: { kind: next } }),
      );
  }

  return (
    <aside
      className={cn(
        "relative flex h-full shrink-0 flex-col border-l border-white/[0.08] bg-[#0d0d0d]",
        "animate-in slide-in-from-right duration-[var(--duration-slow)]",
      )}
      style={{ width }}
      aria-label={tabLabel(kind)}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        onPointerDown={startResize}
        className="absolute left-0 top-0 z-10 h-full w-1 -translate-x-1/2 cursor-col-resize hover:bg-[var(--accent-primary)]/40"
      />

      {kind === "picker" ? (
        <div className="flex min-h-0 flex-1 flex-col px-8 pt-16">
          <h2 className="text-[22px] font-medium tracking-tight text-[#f0f0f0]">
            Open tab
          </h2>
          <p className="mt-1.5 text-[13.5px] text-[#7a7a7a]">
            Choose a tab to open in the side pane.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-3">
            {TAB_OPTIONS.map(({ kind: tab, label, icon: Icon }) => (
              <button
                key={tab}
                type="button"
                onClick={() => pick(tab)}
                className="flex h-[92px] flex-col items-start justify-center gap-3 rounded-2xl bg-[#1c1c1c] px-5 text-left hover:bg-[#242424]"
              >
                <Icon className="h-5 w-5 text-[#d4d4d4]" strokeWidth={1.5} />
                <span className="text-[14px] text-[#e8e8e8]">{label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="flex h-8 shrink-0 items-center gap-1 border-b border-white/[0.08] px-1">
            <span className="inline-flex h-7 items-center rounded-md bg-white/[0.08] px-2 font-mono text-[12px] text-[#e8e8e8]">
              {tabLabel(kind)}
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
            {kind === "terminal" && <TerminalView cwd={cwd} />}
            {kind === "browser" && (
              <BrowserView
                selectMode={selectMode}
                onToggleSelectMode={() => setSelectMode((v) => !v)}
              />
            )}
            {kind === "review" && (
              <div className="h-full overflow-y-auto bg-[#111]">
                <div className="px-3 py-2 text-[12px] text-[#8a8a8a]">
                  {changes.length} files
                </div>
                <ul>
                  {changes.map((file) => (
                    <li
                      key={file.id}
                      className="flex items-center gap-2 px-3 py-1.5 text-[12.5px] hover:bg-white/[0.04]"
                    >
                      <span className="min-w-0 flex-1 truncate text-[#d4d4d4]">
                        {file.path.split("/").pop() ?? file.path}
                      </span>
                      <span className="tabular-nums text-[#3fb950]">
                        +{file.additions}
                      </span>
                      <span className="tabular-nums text-[#f85149]">
                        -{file.deletions}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {kind === "conversation" && (
              <div className="flex h-full flex-col items-center justify-center bg-[#111] px-6 text-center">
                <MessageSquare
                  className="mb-3 h-8 w-8 text-[#5a5a5a]"
                  strokeWidth={1.4}
                />
                <p className="text-[14px] text-[#c8c8c8]">Side conversation</p>
                <p className="mt-1 max-w-[240px] text-[12.5px] text-[#6a6a6a]">
                  Start a parallel thread without leaving this chat.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

export default AgentsSideDock;
