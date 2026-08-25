import { useCallback, useEffect, useRef, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { FileCode } from "lucide-react";
import {
  getStoredFileContent,
  saveStoredFileContent,
  subscribeFileChanges,
} from "@/features/files/fileSync";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

function languageForPath(path: string): string {
  if (path.endsWith(".tsx") || path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".jsx") || path.endsWith(".js")) return "javascript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".sql")) return "sql";
  return "plaintext";
}

/**
 * Separate OS/Browser window for editing a single project file.
 * Real-time changes live-sync back to the main window.
 * Displays Git-style diff highlighting: added lines in green, removed lines in red.
 * Ctrl+S saves the file and updates the diff baseline.
 */
export default function FileEditorWindowApp() {
  const [filePath, setFilePath] = useState<string>("src/App.tsx");
  const [content, setContent] = useState<string>("");
  const [baselineContent, setBaselineContent] = useState<string>("");
  const contentRef = useRef(content);
  contentRef.current = content;

  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  const handleSave = useCallback(() => {
    const currentVal = contentRef.current;
    saveStoredFileContent(filePath, currentVal);
    setBaselineContent(currentVal);
    toast.success(`Saved ${fileName}`);
  }, [filePath, fileName]);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const pathArg = q.get("filePath") || "src/App.tsx";
    setFilePath(pathArg);
    const initialContent = getStoredFileContent(pathArg);
    setContent(initialContent);
    setBaselineContent(initialContent);
    document.title = `${pathArg.split(/[/\\]/).pop() || pathArg} — Lens Editor`;
  }, []);

  // Listen to remote changes from main or other windows
  useEffect(() => {
    const unsubscribe = subscribeFileChanges((changedPath, newContent) => {
      if (changedPath === filePath) {
        setContent(newContent);
      }
    });
    return () => unsubscribe();
  }, [filePath]);

  // Global window keydown listener for Ctrl+S / Cmd+S
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  function handleChange(val: string) {
    setContent(val);
    saveStoredFileContent(filePath, val);
  }

  return (
    <div className="flex h-screen flex-col bg-[#111111] text-[#e8e8e8] font-sans antialiased">
      {/* Title / Header Bar - Clean header without Save button or sync text */}
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#161616] px-4">
        <div className="flex items-center gap-2 min-w-0">
          <FileCode className="h-4 w-4 text-blue-400 shrink-0" strokeWidth={1.5} />
          <span className="type-caption font-semibold text-[#f0f0f0] truncate">
            {fileName}
          </span>
          <span className="type-code text-[#777] truncate hidden sm:inline">
            {filePath}
          </span>
        </div>
      </header>

      {/* Editor Surface with Git-style Inline Diff (Added = Green, Deleted = Red) */}
      <div className="min-h-0 flex-1 relative bg-[#111111]">
        <DiffEditor
          height="100%"
          language={languageForPath(filePath)}
          original={baselineContent}
          modified={content}
          onMount={(editor, monaco) => {
            const originalEditor = editor.getOriginalEditor();
            originalEditor.updateOptions({ lineNumbers: "off" });

            const modifiedEditor = editor.getModifiedEditor();
            modifiedEditor.updateOptions({ lineNumbers: "on" });

            modifiedEditor.onDidChangeModelContent(() => {
              const val = modifiedEditor.getValue();
              handleChange(val);
            });
            modifiedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
              handleSave();
            });
          }}
          theme="vs-dark"
          loading={
            <div className="flex h-full items-center justify-center type-caption text-[#777]">
              Loading editor…
            </div>
          }
          options={{
            renderSideBySide: false, // Inline diff view (green for added, red for deleted)
            fontSize: 13,
            fontFamily: "var(--ds-font-mono)",
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            padding: { top: 12 },
            automaticLayout: true,
            originalEditable: false,
          }}
        />
      </div>

      <Toaster position="bottom-right" theme="dark" />
    </div>
  );
}
