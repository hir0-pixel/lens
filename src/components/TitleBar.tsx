import { X } from "lucide-react";

export default function TitleBar() {
  return (
    <div
      data-tauri-drag-region
      className="flex h-9 shrink-0 select-none items-center justify-between border-b border-white/5 bg-surface-1 px-3 text-zinc-400"
    >
      <div data-tauri-drag-region className="flex items-center gap-2.5">
        <div className="flex h-4 w-4 items-center justify-center rounded-[4px] bg-gradient-to-br from-accent-400 to-accent-600">
          <span className="text-[9px] font-bold leading-none text-surface-0">
            O
          </span>
        </div>
        <span className="text-xs font-medium text-zinc-300">Orchids</span>
        <span className="text-[11px] text-zinc-500">1.0.0</span>
      </div>

      <div className="titlebar-no-drag flex items-center gap-1.5">
        <button
          onClick={() => window.close()}
          className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
