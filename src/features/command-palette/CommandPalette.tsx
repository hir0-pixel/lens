import { useEffect, useMemo, useRef } from "react";
import {
  Box,
  Braces,
  Component,
  FileCode2,
  FileJson,
  FileText,
  FunctionSquare,
  Hash,
  MessageSquare,
  Pin,
  Type,
  Variable,
} from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fuzzyFilter } from "@/shared/fuzzy/fuzzyMatch";
import {
  getOpenFiles,
  getWorkspaceFiles,
  getWorkspaceSymbols,
} from "@/shared/search/workspaceIndex";
import { commandRegistry } from "./CommandRegistry";
import {
  inferModeFromQuery,
  stripModePrefix,
  useCommandStore,
  type PaletteMode,
} from "./commandStore";
import { HighlightedText } from "./HighlightedText";
import { useSessionStore } from "@/stores/sessionStore";

const MODE_PLACEHOLDER: Record<PaletteMode, string> = {
  commands: "Type a command or search…",
  files: "Search files by name",
  symbols: "Go to symbol in editor",
  "workspace-symbols": "Go to symbol in workspace",
  "goto-line": "Type a line number…",
};

function fileIcon(path: string) {
  if (path.endsWith(".json")) return FileJson;
  if (path.endsWith(".md")) return FileText;
  if (path.endsWith(".css")) return FileText;
  return FileCode2;
}

function symbolIcon(kind: string) {
  switch (kind) {
    case "component":
      return Component;
    case "function":
      return FunctionSquare;
    case "interface":
    case "type":
      return Braces;
    case "class":
      return Box;
    case "variable":
      return Variable;
    default:
      return Hash;
  }
}

function ModeHint({ mode }: { mode: PaletteMode }) {
  const hints: Record<PaletteMode, string> = {
    commands: "Commands",
    files: "Files",
    symbols: "Symbols",
    "workspace-symbols": "Workspace symbols",
    "goto-line": "Go to line",
  };
  return (
    <div className="flex items-center gap-2 border-b border-[var(--cursor-border)] px-3 py-1 text-[11px] text-[var(--cursor-fg-muted)]">
      <span className="rounded-[2px] bg-[var(--cursor-input-bg)] px-1.5 py-0.5 text-[var(--cursor-fg)]">
        {hints[mode]}
      </span>
      <span className="text-[var(--cursor-fg-muted)]">
        {mode === "files" && "> commands · @ symbols · # workspace · : line"}
        {mode === "commands" && "Remove > for files"}
        {mode === "goto-line" && "Enter line number then press Enter"}
      </span>
    </div>
  );
}

export function CommandPalette() {
  const overlay = useCommandStore((s) => s.overlay);
  const query = useCommandStore((s) => s.query);
  const paletteMode = useCommandStore((s) => s.paletteMode);
  const setQuery = useCommandStore((s) => s.setQuery);
  const setPaletteMode = useCommandStore((s) => s.setPaletteMode);
  const close = useCommandStore((s) => s.close);
  const pushRecentCommand = useCommandStore((s) => s.pushRecentCommand);
  const pushRecentFile = useCommandStore((s) => s.pushRecentFile);
  const recentCommandIds = useCommandStore((s) => s.recentCommandIds);
  const pinnedCommandIds = useCommandStore((s) => s.pinnedCommandIds);
  const recentFilePaths = useCommandStore((s) => s.recentFilePaths);
  const pinnedFilePaths = useCommandStore((s) => s.pinnedFilePaths);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = overlay === "palette";

  useEffect(() => {
    if (!open) return;
    const t = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [open, paletteMode]);

  function handleQueryChange(value: string) {
    setQuery(value);
    setPaletteMode(inferModeFromQuery(value));
  }

  const filterText = stripModePrefix(query, paletteMode);

  const commandResults = useMemo(() => {
    if (paletteMode !== "commands") return [];
    const all = commandRegistry.getAll().filter((c) => {
      const enabled = typeof c.enabled === "function" ? c.enabled() : c.enabled !== false;
      return enabled;
    });
    return fuzzyFilter(
      all,
      filterText,
      (c) => `${c.title} ${c.category} ${c.description ?? ""} ${(c.keywords ?? []).join(" ")}`,
      50,
    );
  }, [paletteMode, filterText, open]);

  const fileResults = useMemo(() => {
    if (paletteMode !== "files") return [];
    const files = getWorkspaceFiles();
    if (!filterText) {
      const openFiles = getOpenFiles();
      const ordered = [
        ...pinnedFilePaths.map((p) => files.find((f) => f.path === p)).filter(Boolean),
        ...openFiles.map((p) => files.find((f) => f.path === p)).filter(Boolean),
        ...recentFilePaths.map((p) => files.find((f) => f.path === p)).filter(Boolean),
        ...files,
      ].filter((f, i, arr) => f && arr.findIndex((x) => x?.path === f.path) === i) as typeof files;
      return ordered.slice(0, 40).map((f) => ({ ...f, _fuzzyScore: 0, _fuzzyIndices: [] as number[] }));
    }
    return fuzzyFilter(files, filterText, (f) => `${f.name} ${f.path}`, 40);
  }, [paletteMode, filterText, pinnedFilePaths, recentFilePaths]);

  const symbolResults = useMemo(() => {
    if (paletteMode !== "symbols" && paletteMode !== "workspace-symbols") return [];
    const symbols = getWorkspaceSymbols();
    const scoped =
      paletteMode === "symbols"
        ? symbols.filter((s) => s.file === useCommandStore.getState().lastOpenedFile)
        : symbols;
    return fuzzyFilter(scoped.length ? scoped : symbols, filterText, (s) => `${s.name} ${s.file} ${s.kind}`, 40);
  }, [paletteMode, filterText]);

  const sessionResults = useMemo(() => {
    if (paletteMode !== "files" && paletteMode !== "commands") return [];
    const all = Object.values(useSessionStore.getState().sessions);
    if (!all.length) return [];
    return fuzzyFilter(
      all,
      filterText,
      (s) =>
        `${s.title} ${s.messages.map((m) => m.content).join(" ").slice(0, 200)}`,
      12,
    );
  }, [paletteMode, filterText, open]);

  function openSession(id: string) {
    close();
    useSessionStore.getState().setCurrentSession(id, true);
  }

  async function runCommand(id: string) {
    close();
    pushRecentCommand(id);
    await commandRegistry.execute(id);
  }

  function openFile(path: string) {
    pushRecentFile(path);
    close();
    window.dispatchEvent(new CustomEvent("orchids:open-file", { detail: { path } }));
  }

  function goToSymbol(file: string, line: number) {
    pushRecentFile(file);
    close();
    window.dispatchEvent(
      new CustomEvent("orchids:open-file", { detail: { path: file, line } }),
    );
  }

  function goToLine() {
    const line = parseInt(filterText, 10);
    if (!Number.isFinite(line) || line < 1) return;
    const file = useCommandStore.getState().lastOpenedFile ?? "src/App.tsx";
    close();
    window.dispatchEvent(
      new CustomEvent("orchids:open-file", { detail: { path: file, line } }),
    );
  }

  const recentCmds = recentCommandIds
    .map((id) => commandRegistry.get(id))
    .filter(Boolean)
    .slice(0, 5);

  const pinnedCmds = pinnedCommandIds
    .map((id) => commandRegistry.get(id))
    .filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent
        className={cn(
          "top-[15%] translate-y-0 gap-0 overflow-hidden rounded-none border-[var(--cursor-border)] bg-[var(--cursor-quick-input-bg)] p-0 shadow-[var(--shadow-overlay)]",
          "sm:max-w-[600px]",
          "[&>button]:hidden",
          "animate-cursor-scale",
        )}
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <Command
          shouldFilter={false}
          className="bg-transparent"
          loop
        >
          <CommandInput
            ref={inputRef}
            value={query}
            onValueChange={handleQueryChange}
            placeholder={MODE_PLACEHOLDER[paletteMode]}
            className="h-[28px] border-none text-[13px] text-[var(--cursor-fg)] placeholder:text-[var(--cursor-fg-muted)]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && paletteMode === "goto-line") {
                e.preventDefault();
                goToLine();
              }
            }}
          />
          <ModeHint mode={paletteMode} />
          <CommandList className="max-h-[min(420px,55vh)] scroll-py-1">
            <CommandEmpty className="py-8 text-[13px] text-zinc-500">
              No results found.
            </CommandEmpty>

            {sessionResults.length > 0 && (
              <CommandGroup heading="Sessions">
                {sessionResults.map((s) => (
                  <CommandItem
                    key={`sess-${s.id}`}
                    value={`session-${s.id}`}
                    onSelect={() => openSession(s.id)}
                    className="cursor-quick-item h-[22px] gap-2 px-2 text-[13px] data-[selected=true]:bg-[var(--cursor-list-active)] data-[selected=true]:text-white"
                  >
                    <MessageSquare className="h-3.5 w-3.5 text-zinc-500" />
                    <span className="truncate">{s.title}</span>
                    <span className="ml-auto text-[11px] text-zinc-600">
                      {s.type}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {paletteMode === "commands" && !filterText && pinnedCmds.length > 0 && (
              <CommandGroup heading="Pinned">
                {pinnedCmds.map((cmd) =>
                  cmd ? (
                    <CommandItem
                      key={`pin-${cmd.id}`}
                      value={cmd.id}
                      onSelect={() => void runCommand(cmd.id)}
                      className="cursor-quick-item h-[22px] gap-2 px-2 text-[13px] data-[selected=true]:bg-[var(--cursor-list-active)] data-[selected=true]:text-white"
                    >
                      <Pin className="h-3.5 w-3.5 text-accent" />
                      <span className="text-zinc-500">{cmd.category}:</span>
                      <span className="truncate">{cmd.title}</span>
                      {cmd.shortcut && (
                        <CommandShortcut className="font-mono text-[11px] text-zinc-600">
                          {cmd.shortcut}
                        </CommandShortcut>
                      )}
                    </CommandItem>
                  ) : null,
                )}
              </CommandGroup>
            )}

            {paletteMode === "commands" && !filterText && recentCmds.length > 0 && (
              <>
                <CommandSeparator className="bg-white/5" />
                <CommandGroup heading="Recently used">
                  {recentCmds.map((cmd) =>
                    cmd ? (
                      <CommandItem
                        key={`recent-${cmd.id}`}
                        value={`recent-${cmd.id}`}
                        onSelect={() => void runCommand(cmd.id)}
                        className="cursor-quick-item h-[22px] gap-2 px-2 text-[13px] data-[selected=true]:bg-[var(--cursor-list-active)] data-[selected=true]:text-white"
                      >
                        {cmd.icon && <cmd.icon className="h-4 w-4 text-zinc-500" />}
                        <span className="text-zinc-500">{cmd.category}:</span>
                        <span className="truncate">{cmd.title}</span>
                        {cmd.shortcut && (
                          <CommandShortcut className="font-mono text-[11px] text-zinc-600">
                            {cmd.shortcut}
                          </CommandShortcut>
                        )}
                      </CommandItem>
                    ) : null,
                  )}
                </CommandGroup>
              </>
            )}

            {paletteMode === "commands" && (
              <>
                {(pinnedCmds.length > 0 || recentCmds.length > 0) && filterText === "" && (
                  <CommandSeparator className="bg-white/5" />
                )}
                <CommandGroup heading={filterText ? "Commands" : "All commands"}>
                  {commandResults.map((cmd) => {
                    const Icon = cmd.icon;
                    return (
                      <CommandItem
                        key={cmd.id}
                        value={cmd.id}
                        onSelect={() => void runCommand(cmd.id)}
                        disabled={typeof cmd.enabled === "function" ? !cmd.enabled() : cmd.enabled === false}
                        className="cursor-quick-item h-[22px] gap-2 px-2 text-[13px] data-[selected=true]:bg-[var(--cursor-list-active)] data-[selected=true]:text-white data-[disabled=true]:opacity-40"
                      >
                        {Icon ? (
                          <Icon className="h-4 w-4 shrink-0 text-zinc-500" />
                        ) : (
                          <Hash className="h-4 w-4 shrink-0 text-zinc-600" />
                        )}
                        <span className="shrink-0 text-zinc-500">{cmd.category}:</span>
                        <HighlightedText
                          text={cmd.title}
                          indices={cmd._fuzzyIndices}
                          className="truncate"
                        />
                        {cmd.description && !filterText && (
                          <span className="ml-1 hidden truncate text-[11px] text-zinc-600 lg:inline">
                            {cmd.description}
                          </span>
                        )}
                        {cmd.shortcut && (
                          <CommandShortcut className="font-mono text-[11px] text-zinc-600">
                            {cmd.shortcut}
                          </CommandShortcut>
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}

            {paletteMode === "files" && (
              <>
                {!filterText && pinnedFilePaths.length > 0 && (
                  <CommandGroup heading="Pinned">
                    {fileResults
                      .filter((f) => pinnedFilePaths.includes(f.path))
                      .map((file) => {
                        const Icon = fileIcon(file.path);
                        return (
                          <CommandItem
                            key={`pin-file-${file.path}`}
                            value={file.path}
                            onSelect={() => openFile(file.path)}
                            className="cursor-quick-item h-[22px] gap-2 px-2 text-[13px] data-[selected=true]:bg-[var(--cursor-list-active)] data-[selected=true]:text-white"
                          >
                            <Pin className="h-3 w-3 text-accent" />
                            <Icon className="h-4 w-4 text-sky-400" />
                            <span className="truncate">{file.name}</span>
                            <span className="ml-auto truncate font-mono text-[11px] text-zinc-600">
                              {file.parent ?? ""}
                            </span>
                          </CommandItem>
                        );
                      })}
                  </CommandGroup>
                )}
                <CommandGroup heading={filterText ? "Files" : "Workspace"}>
                  {fileResults
                    .filter((f) => filterText || !pinnedFilePaths.includes(f.path))
                    .map((file) => {
                      const Icon = fileIcon(file.path);
                      const nameMatch = fuzzyFilter(
                        [{ n: file.name }],
                        filterText,
                        (x) => x.n,
                        1,
                      )[0]?._fuzzyIndices ?? [];
                      return (
                        <CommandItem
                          key={file.path}
                          value={file.path}
                          onSelect={() => openFile(file.path)}
                          className="cursor-quick-item h-[22px] gap-2 px-2 text-[13px] data-[selected=true]:bg-[var(--cursor-list-active)] data-[selected=true]:text-white"
                        >
                          <Icon className="h-4 w-4 shrink-0 text-sky-400" />
                          <HighlightedText
                            text={file.name}
                            indices={nameMatch}
                            className="truncate"
                          />
                          <span className="ml-auto max-w-[45%] truncate font-mono text-[11px] text-zinc-600">
                            {file.path}
                          </span>
                        </CommandItem>
                      );
                    })}
                </CommandGroup>
              </>
            )}

            {(paletteMode === "symbols" || paletteMode === "workspace-symbols") && (
              <CommandGroup heading="Symbols">
                {symbolResults.map((sym) => {
                  const Icon = symbolIcon(sym.kind);
                  return (
                    <CommandItem
                      key={sym.id}
                      value={sym.id}
                      onSelect={() => goToSymbol(sym.file, sym.line)}
                      className="cursor-quick-item h-[22px] gap-2 px-2 text-[13px] data-[selected=true]:bg-[var(--cursor-list-active)] data-[selected=true]:text-white"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-violet-400" />
                      <HighlightedText text={sym.name} indices={sym._fuzzyIndices} />
                      <span className="text-[11px] text-zinc-600">{sym.kind}</span>
                      <span className="ml-auto truncate font-mono text-[11px] text-zinc-600">
                        {sym.file}:{sym.line}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {paletteMode === "goto-line" && (
              <CommandGroup heading="Go to line">
                <CommandItem
                  value="goto"
                  onSelect={goToLine}
                  className="h-9 data-[selected=true]:bg-white/10"
                >
                  <Type className="h-4 w-4 text-zinc-500" />
                  Go to line {filterText || "…"}
                  <CommandShortcut>Enter</CommandShortcut>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>

          <div className="flex items-center gap-3 border-t border-white/5 px-3 py-1.5 text-[10px] text-zinc-600">
            <span>
              <kbd className="rounded border border-white/10 bg-surface-2 px-1">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="rounded border border-white/10 bg-surface-2 px-1">↵</kbd> open
            </span>
            <span>
              <kbd className="rounded border border-white/10 bg-surface-2 px-1">esc</kbd> close
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
