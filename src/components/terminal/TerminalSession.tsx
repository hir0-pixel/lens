import { memo, useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { useTerminalStore } from "@/stores/terminalStore";
import { executeRealCommand } from "@/components/terminal/utils/realShell";
import {
  getBootLines,
  getPrompt,
  TERMINAL_OPTIONS,
} from "@/components/terminal/utils/terminalTheme";
import {
  registerTerminal,
  unregisterTerminal,
  type TerminalHandle,
} from "@/components/terminal/utils/terminalRegistry";
import { cn } from "@/lib/utils";

interface TerminalSessionProps {
  sessionId: string;
  projectName?: string;
  isActive: boolean;
  onFocus?: () => void;
  className?: string;
}

function TerminalSessionComponent({
  sessionId,
  projectName = "finance-dashboard",
  isActive,
  onFocus,
  className,
}: TerminalSessionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const inputBufferRef = useRef("");
  const session = useTerminalStore((s) => s.sessions.find((x) => x.id === sessionId));
  const updateSession = useTerminalStore((s) => s.updateSession);
  const setCwd = useTerminalStore((s) => s.setCwd);
  const appendHistory = useTerminalStore((s) => s.appendHistory);
  const killSession = useTerminalStore((s) => s.killSession);
  const generation = session?.generation ?? 0;
  const shell = session?.shell ?? "bash";
  const cwd = session?.cwd ?? "~/dev/finance-dashboard";

  useEffect(() => {
    if (!containerRef.current || !session) return;

    const term = new Terminal(TERMINAL_OPTIONS);
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.open(containerRef.current);

    const boot = () => {
      term.clear();
      getBootLines(projectName, cwd, shell).forEach((line) => term.writeln(line));
      term.write(getPrompt(shell, cwd).replace(/^\r\n/, ""));
    };

    boot();

    const handle: TerminalHandle = {
      terminal: term,
      searchAddon: search,
      clear: () => {
        term.clear();
        inputBufferRef.current = "";
        term.write(getPrompt(shell, useTerminalStore.getState().sessions.find((s) => s.id === sessionId)?.cwd ?? cwd).replace(/^\r\n/, ""));
      },
      copy: () => {
        const sel = term.getSelection();
        if (sel) void navigator.clipboard.writeText(sel);
      },
      paste: async () => {
        try {
          const text = await navigator.clipboard.readText();
          term.write(text);
          inputBufferRef.current += text;
        } catch {
          /* clipboard denied */
        }
      },
      selectAll: () => term.selectAll(),
      findNext: (query, opts) => {
        search.findNext(query, {
          caseSensitive: opts?.caseSensitive,
          regex: opts?.regex,
        });
      },
      findPrevious: (query, opts) => {
        search.findPrevious(query, {
          caseSensitive: opts?.caseSensitive,
          regex: opts?.regex,
        });
      },
      focus: () => term.focus(),
      restart: boot,
    };

    registerTerminal(sessionId, handle);

    const runCommand = async (line: string) => {
      const current = useTerminalStore.getState().sessions.find((s) => s.id === sessionId);
      if (!current || current.status !== "running") return;

      appendHistory(sessionId, line);
      const result = await executeRealCommand(
        line,
        { cwd: current.cwd, shell: current.shell },
        (chunk) => {
          term.write(chunk);
        },
      );

      if (result.clear) {
        term.clear();
      } else if (result.output) {
        term.write(result.output);
      }

      if (result.newState.cwd !== current.cwd) {
        setCwd(sessionId, result.newState.cwd);
      }

      if (result.exitSession) {
        killSession(sessionId);
        term.writeln("\x1b[90m[session killed — restart to continue]\x1b[0m");
        return;
      }

      const updated = useTerminalStore.getState().sessions.find((s) => s.id === sessionId);
      term.write(getPrompt(updated?.shell ?? shell, updated?.cwd ?? cwd));
    };

    const onData = term.onData((data) => {
      const current = useTerminalStore.getState().sessions.find((s) => s.id === sessionId);
      if (!current || current.status !== "running") return;
      onFocus?.();

      if (data === "\r") {
        const line = inputBufferRef.current;
        inputBufferRef.current = "";
        term.write("\r\n");
        runCommand(line);
        return;
      }

      if (data === "\u007F") {
        if (inputBufferRef.current.length > 0) {
          inputBufferRef.current = inputBufferRef.current.slice(0, -1);
          term.write("\b \b");
        }
        return;
      }

      if (data === "\u0003") {
        inputBufferRef.current = "";
        term.write("^C\r\n");
        term.write(getPrompt(shell, useTerminalStore.getState().sessions.find((s) => s.id === sessionId)?.cwd ?? cwd).replace(/^\r\n/, ""));
        return;
      }

      if (data === "\u000c") {
        term.clear();
        inputBufferRef.current = "";
        term.write(getPrompt(shell, useTerminalStore.getState().sessions.find((s) => s.id === sessionId)?.cwd ?? cwd).replace(/^\r\n/, ""));
        return;
      }

      if (data >= " ") {
        inputBufferRef.current += data;
        term.write(data);
      }
    });

    const fitTerminal = () => {
      if (containerRef.current?.offsetParent !== null) {
        fit.fit();
      }
    };

    fitTerminal();
    requestAnimationFrame(fitTerminal);

    const ro = new ResizeObserver(() => fitTerminal());
    ro.observe(containerRef.current);
    window.addEventListener("resize", fitTerminal);

    termRef.current = term;

    return () => {
      onData.dispose();
      ro.disconnect();
      window.removeEventListener("resize", fitTerminal);
      unregisterTerminal(sessionId);
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId, generation, projectName]);

  useEffect(() => {
    if (isActive) {
      requestAnimationFrame(() => termRef.current?.focus());
    }
  }, [isActive]);

  useEffect(() => {
    const term = termRef.current;
    if (!term || !isActive) return;
    const current = useTerminalStore
      .getState()
      .sessions.find((s) => s.id === sessionId);
    if (!current) return;
    const viewport = term.buffer.active.viewportY;
    if (current.scrollPosition === viewport) return;
    updateSession(sessionId, { scrollPosition: viewport });
  }, [sessionId, isActive, updateSession]);

  return (
    <div
      className={cn(
        "h-full w-full overflow-hidden bg-[var(--cursor-editor-bg)] px-2 py-1 font-mono",
        !isActive && "opacity-95",
        className,
      )}
      onMouseDown={() => onFocus?.()}
      role="tabpanel"
      aria-label={`Terminal session ${session?.title ?? sessionId}`}
    >
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

export const TerminalSession = memo(TerminalSessionComponent);
