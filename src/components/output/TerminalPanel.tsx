import TerminalView from "@/components/output/TerminalView";

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
  name,
  cwd,
  projectName,
  onClose,
}: TerminalPanelProps) {
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
    <div className="flex h-[240px] shrink-0 flex-col border-t border-white/[0.08] bg-[#0d0d0d]">
      <div className="flex h-[34px] shrink-0 items-center gap-1 border-b border-white/[0.08] bg-[#181818] px-2">
        <span className="px-2 py-1 text-[12px] font-semibold text-white">
          {title}
        </span>
        <span className="px-2 py-1 text-[12px] text-[#666]">{subtitle}</span>
        <span className="flex items-center gap-1.5 rounded bg-[#2a2a2a] px-2.5 py-1 text-[12px] font-medium text-white">
          {name ?? "shell"}
          <span className="font-mono text-[11px] text-[#888]" title={cwd}>
            {projectName ?? ""}
          </span>
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onNew}
            className="flex h-6 w-6 items-center justify-center rounded text-[#666] hover:bg-white/[0.06] hover:text-white"
            title="New terminal"
            aria-label="New terminal"
          >
            <span className="text-[15px] leading-none">+</span>
          </button>
          <button
            type="button"
            onClick={close}
            className="flex h-6 w-6 items-center justify-center rounded text-[#666] hover:bg-white/[0.06] hover:text-white"
            title="Close panel"
            aria-label="Close panel"
          >
            <span className="text-[13px] leading-none">×</span>
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <TerminalView cwd={cwd} projectName={projectName} />
      </div>
    </div>
  );
}