import {
  GitBranch,
  AlertCircle,
  Bell,
  ArrowDown,
  ArrowUp,
  GitMerge,
  Check,
} from "@/components/icons/tabler";
import type { Model, Project } from "@/lib/types";
import { useGitStore } from "@/stores/gitStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useEditorChromeStore } from "@/stores/editorChromeStore";
import { MOCK_PROBLEMS } from "@/components/terminal/mock-data";
import { useCommandStore } from "@/features/command-palette/commandStore";

interface StatusBarProps {
  project: Project;
  model: Model;
  credits: number;
}

/**
 * Status bar — interactive branch, problems, cursor, language, encoding, notifications.
 */
export default function StatusBar({ project, model }: StatusBarProps) {
  const branch = useGitStore((s) => s.getCurrentBranch());
  const operation = useGitStore((s) => s.operation);
  const conflictCount = useGitStore((s) => s.getConflicts().length);
  const changeCount = useGitStore(
    (s) =>
      s.getStaged().length + s.getUnstaged().length + s.getUntracked().length,
  );
  const openTools = useLayoutStore((s) => s.openTools);
  const openBottomPanel = useLayoutStore((s) => s.openBottomPanel);
  const line = useEditorChromeStore((s) => s.line);
  const column = useEditorChromeStore((s) => s.column);
  const language = useEditorChromeStore((s) => s.language);
  const encoding = useEditorChromeStore((s) => s.encoding);
  const dirtyPaths = useEditorChromeStore((s) => s.dirtyPaths);
  const activePath = useEditorChromeStore((s) => s.activePath);

  const errorCount = MOCK_PROBLEMS.filter((p) => p.severity === "error").length;
  const warningCount = MOCK_PROBLEMS.filter(
    (p) => p.severity === "warning",
  ).length;

  const branchName = branch?.name ?? project.branch;
  const ahead = branch?.ahead ?? 0;
  const behind = branch?.behind ?? 0;

  return (
    <footer
      className="cursor-statusbar flex shrink-0 select-none items-stretch"
      role="status"
      aria-label="Status Bar"
    >
      <button
        type="button"
        className="cursor-statusbar-item"
        onClick={() => openTools("git")}
        aria-label={`Git: ${branchName}`}
      >
        {conflictCount > 0 ? (
          <GitMerge className="h-3.5 w-3.5 text-[var(--ds-error)]" />
        ) : (
          <GitBranch className="h-3.5 w-3.5" strokeWidth={1.75} />
        )}
        <span>{branchName}</span>
        {ahead > 0 && (
          <span className="inline-flex items-center">
            <ArrowUp className="h-3 w-3" />
            {ahead}
          </span>
        )}
        {behind > 0 && (
          <span className="inline-flex items-center">
            <ArrowDown className="h-3 w-3" />
            {behind}
          </span>
        )}
        {changeCount > 0 && <span>*{changeCount}</span>}
        {operation !== "idle" && (
          <span className="opacity-70">{operation}…</span>
        )}
      </button>

      <button
        type="button"
        className="cursor-statusbar-item"
        onClick={() => openBottomPanel("problems")}
        aria-label={`${errorCount} errors, ${warningCount} warnings`}
      >
        <AlertCircle
          className="h-3.5 w-3.5 text-[var(--ds-error)]"
          strokeWidth={1.75}
        />
        <span className="tabular-nums">{errorCount}</span>
        <span className="tabular-nums opacity-70">{warningCount}</span>
      </button>

      {activePath && (
        <button
          type="button"
          className="cursor-statusbar-item max-w-[200px]"
          title={activePath}
          onClick={() => openTools("editor")}
          aria-label={`File: ${activePath}`}
        >
          <span className="truncate">{activePath.split("/").pop()}</span>
        </button>
      )}

      {dirtyPaths.size > 0 && (
        <button
          type="button"
          className="cursor-statusbar-item"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("lens:command", { detail: { id: "file.saveAll" } }),
            )
          }
          aria-label={`${dirtyPaths.size} unsaved files`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--ds-primary)]" />
          {dirtyPaths.size} unsaved
        </button>
      )}

      <div className="flex-1" />

      <button
        type="button"
        className="cursor-statusbar-item hidden md:inline-flex"
        onClick={() =>
          window.dispatchEvent(new CustomEvent("lens:open-settings"))
        }
        aria-label={`Model: ${model.label}`}
      >
        {model.label}
      </button>

      <button
        type="button"
        className="cursor-statusbar-item"
        onClick={() => useCommandStore.getState().openGotoLine()}
        aria-label={`Go to line ${line}`}
      >
        Ln {line}, Col {column}
      </button>

      <button
        type="button"
        className="cursor-statusbar-item hidden lg:inline-flex"
        onClick={() => useCommandStore.getState().openCommands()}
        aria-label={`Language: ${language}`}
      >
        {language}
      </button>

      <button
        type="button"
        className="cursor-statusbar-item hidden lg:inline-flex"
        onClick={() =>
          window.dispatchEvent(new CustomEvent("lens:open-settings"))
        }
      >
        {encoding}
      </button>

      <button
        type="button"
        className="cursor-statusbar-item"
        onClick={() => openBottomPanel("output")}
        aria-label="Sync / workspace ready"
      >
        <Check className="h-3.5 w-3.5 text-[var(--ds-success)]" strokeWidth={1.75} />
      </button>

      <button
        type="button"
        disabled
        className="cursor-statusbar-item cursor-not-allowed opacity-50"
        aria-label="Notifications"
        title="Notification center coming soon"
      >
        <Bell className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </footer>
  );
}
