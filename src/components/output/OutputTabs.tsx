import { useState } from "react";
import { ChevronDown, Globe, PanelRight, SquareTerminal } from "lucide-react";
import { cn } from "../../lib/utils";
import type { OutputTab } from "../../lib/types";
import BrowserView from "./BrowserView";
import EditorView from "./EditorView";
import TerminalView from "./TerminalView";

const TABS: { id: OutputTab; label: string; icon: React.ReactNode }[] = [
  { id: "browser", label: "Browser", icon: <Globe className="h-3.5 w-3.5" /> },
  { id: "editor", label: "Editor", icon: <PanelRight className="h-3.5 w-3.5" /> },
  { id: "terminal", label: "Terminal", icon: <SquareTerminal className="h-3.5 w-3.5" /> },
];

export default function OutputTabs() {
  const [tab, setTab] = useState<OutputTab>("browser");
  const [selectMode, setSelectMode] = useState(false);

  return (
    <div className="flex h-full flex-col bg-surface-1">
      {/* Tab bar */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-white/5 bg-surface-1 px-2 pt-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-1.5 text-[12.5px] font-medium transition-colors",
              tab === t.id
                ? "border-accent bg-surface-0 text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-300",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <button
            className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-white/10 hover:text-zinc-300"
            title="Split view"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1">
        {tab === "browser" && (
          <BrowserView
            selectMode={selectMode}
            onToggleSelectMode={() => setSelectMode((v) => !v)}
          />
        )}
        {tab === "editor" && <EditorView />}
        {tab === "terminal" && <TerminalView />}
      </div>
    </div>
  );
}