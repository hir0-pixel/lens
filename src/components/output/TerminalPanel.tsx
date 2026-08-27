import TerminalView from "@/components/output/TerminalView";
import { useCallback, useEffect, useState } from "react";
import { useTerminalStore } from "@/stores/terminalStore";

interface TerminalPanelProps {
  title?: string;
  subtitle?: string;
  name?: string;
  cwd?: string;
  projectName?: string;
  onClose?: () => void;
}

/**
 * Bottom terminal panel. Renders as a docked strip under the chat area — it
 * spans only the content column it is placed in, so a sibling left sidebar
 * keeps its full height.
 */
export default function TerminalPanel({
  title = "Terminal",
  subtitle = "PowerShell",
  cwd,
  projectName,
  onClose,
}: TerminalPanelProps) {
  const sessions = useTerminalStore((s) => s.sessions);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const setActiveSession = useTerminalStore((s) => s.setActiveSession);
  const [height, setHeight] = useState(240);
  const [isResizing, setIsResizing] = useState(false);

  const stopResizing = useCallback(() => setIsResizing(false), []);

  useEffect(() => {
    if (!isResizing) return;

    const onPointerMove = (event: PointerEvent) => {
      // The panel is docked to the bottom, so moving the pointer upward grows it.
      setHeight((current) =>
        Math.min(Math.max(current - event.movementY, 160), window.innerHeight - 120),
      );
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResizing);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResizing);
    };
  }, [isResizing, stopResizing]);

  const onNew = () =>
    window.dispatchEvent(new CustomEvent("lens:terminal-new"));
  const close = () => {
    if (onClose) {
      onClose();
      return;
    }
    window.dispatchEvent(new CustomEvent("lens:toggle-panel"));
  };

  return (
    <div
      className="relative flex shrink-0 flex-col border-t border-white/[0.08] bg-[#171717]"
      style={{ height }}
    >
      <div
        className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize touch-none"
        role="separator"
        aria-label="Resize terminal"
        aria-orientation="horizontal"
        aria-valuemin={160}
        aria-valuemax={Math.max(160, window.innerHeight - 120)}
        aria-valuenow={height}
        tabIndex={0}
        onPointerDown={(event) => {
          event.preventDefault();
          setIsResizing(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setHeight((current) => Math.min(current + 24, window.innerHeight - 120));
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            setHeight((current) => Math.max(current - 24, 160));
          }
        }}
      />
      <div className="flex h-[34px] shrink-0 items-center gap-1 border-b border-white/[0.08] bg-[#171717] px-2">
        <span className="px-2 py-1 type-caption font-semibold text-white">
          {title}
        </span>
        <span className="px-2 py-1 type-caption text-[#4d4d4d]">{subtitle}</span>
        {sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            onClick={() => setActiveSession(session.id)}
            title={session.cwd}
            className={`flex h-full max-w-[240px] items-center gap-1.5 px-2.5 type-caption ${
              session.id === activeSessionId
                ? "bg-[#222222] font-medium text-white"
                : "text-[#777777] hover:bg-[#1d1d1d] hover:text-[#c7c7c7]"
            }`}
          >
            <span className="truncate">{session.title}</span>
            <span className="truncate text-[#777777]">{session.cwd}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onNew}
            className="flex h-6 w-6 items-center justify-center rounded text-[#4d4d4d] hover:bg-white/[0.06] hover:text-white"
            title="New terminal"
            aria-label="New terminal"
          >
            <span className="type-title-sm leading-none">+</span>
          </button>
          <button
            type="button"
            onClick={close}
            className="flex h-6 w-6 items-center justify-center rounded text-[#4d4d4d] hover:bg-white/[0.06] hover:text-white"
            title="Close panel"
            aria-label="Close panel"
          >
            <span className="type-caption leading-none">×</span>
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <TerminalView cwd={cwd} projectName={projectName} />
      </div>
    </div>
  );
}
