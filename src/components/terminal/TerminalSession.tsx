import { memo, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { useTerminalStore } from "@/stores/terminalStore";
import { getTerminalTheme, TERMINAL_OPTIONS } from "@/components/terminal/utils/terminalTheme";
import {
  registerTerminal,
  unregisterTerminal,
  type TerminalHandle,
} from "@/components/terminal/utils/terminalRegistry";
import { isTauri } from "@/features/projects/platform";
import { cn } from "@/lib/utils";

interface TerminalSessionProps {
  sessionId: string;
  /** Retained for callers that label a terminal by project. The native shell owns its prompt. */
  projectName?: string;
  isActive: boolean;
  onFocus?: () => void;
  className?: string;
}

interface TerminalDataEvent {
  sessionId: string;
  data: string;
}

function TerminalSessionComponent({
  sessionId,
  isActive,
  onFocus,
  className,
}: TerminalSessionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const onFocusRef = useRef(onFocus);
  const session = useTerminalStore((s) => s.sessions.find((x) => x.id === sessionId));
  const updateSession = useTerminalStore((s) => s.updateSession);
  const generation = session?.generation ?? 0;
  const shell = session?.shell ?? "powershell";
  const cwd = session?.cwd ?? "~";

  onFocusRef.current = onFocus;

  useEffect(() => {
    if (!containerRef.current || !session) return;

    const term = new Terminal({
      ...TERMINAL_OPTIONS,
      theme: getTerminalTheme(document.documentElement.classList.contains("dark")),
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.open(containerRef.current);

    const applyTheme = () => {
      term.options.theme = getTerminalTheme(document.documentElement.classList.contains("dark"));
      term.refresh(0, term.rows - 1);
    };
    const themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // xterm's canvas renderer remains available when WebGL is unavailable.
    }

    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    const resizePty = () => {
      if (containerRef.current?.offsetParent === null) return;
      fit.fit();
      if (isTauri()) {
        void invoke("terminal_resize", {
          args: { sessionId, cols: term.cols, rows: term.rows },
        }).catch(() => {
          // The first layout pass can occur before the native session is ready.
        });
      }
    };

    const start = async () => {
      try {
        unlisten = await listen<TerminalDataEvent>("terminal://data", (event) => {
          if (event.payload.sessionId !== sessionId || disposed) return;
          term.write(event.payload.data, () => term.scrollToBottom());
        });

        resizePty();
        if (!isTauri()) {
          term.writeln("This terminal is available in the desktop app.");
          return;
        }

        await invoke("terminal_spawn", {
          args: { sessionId, generation, cwd, shell, cols: term.cols, rows: term.rows },
        });
        if (!disposed) term.focus();
      } catch (error) {
        if (!disposed) {
          term.writeln(`\x1b[31mUnable to start terminal: ${String(error)}\x1b[0m`);
        }
      }
    };

    const onData = term.onData((data) => {
      if (!isTauri()) return;
      onFocusRef.current?.();
      void invoke("terminal_write", { sessionId, data }).catch((error) => {
        if (!disposed) {
          term.writeln(`\r\n\x1b[31mTerminal input error: ${String(error)}\x1b[0m`);
        }
      });
    });

    const handle: TerminalHandle = {
      terminal: term,
      searchAddon: search,
      clear: () => {
        term.clear();
        term.focus();
      },
      copy: () => {
        const selection = term.getSelection();
        if (selection) void navigator.clipboard.writeText(selection);
      },
      paste: async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (isTauri()) {
            await invoke("terminal_write", { sessionId, data: text });
          }
        } catch {
          // Clipboard access may be denied by the host.
        }
      },
      selectAll: () => term.selectAll(),
      findNext: (query, options) => {
        search.findNext(query, {
          caseSensitive: options?.caseSensitive,
          regex: options?.regex,
        });
      },
      findPrevious: (query, options) => {
        search.findPrevious(query, {
          caseSensitive: options?.caseSensitive,
          regex: options?.regex,
        });
      },
      focus: () => term.focus(),
      restart: () => {
        void invoke("terminal_write", { sessionId, data: "exit\r" });
      },
    };

    registerTerminal(sessionId, handle);
    termRef.current = term;
    void start();

    const resizeObserver = new ResizeObserver(resizePty);
    resizeObserver.observe(containerRef.current);
    window.addEventListener("resize", resizePty);
    requestAnimationFrame(resizePty);

    return () => {
      disposed = true;
      onData.dispose();
      unlisten?.();
      resizeObserver?.disconnect();
      themeObserver.disconnect();
      window.removeEventListener("resize", resizePty);
      unregisterTerminal(sessionId);
      if (isTauri()) {
        void invoke("terminal_close", { args: { sessionId, generation } });
      }
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId, generation, cwd, shell]);

  useEffect(() => {
    if (isActive) requestAnimationFrame(() => termRef.current?.focus());
  }, [isActive]);

  useEffect(() => {
    const term = termRef.current;
    if (!term || !isActive) return;
    const current = useTerminalStore.getState().sessions.find((s) => s.id === sessionId);
    if (current && current.scrollPosition !== term.buffer.active.viewportY) {
      updateSession(sessionId, { scrollPosition: term.buffer.active.viewportY });
    }
  }, [isActive, sessionId, updateSession]);

  return (
    <div
      className={cn(
        "h-full w-full overflow-hidden bg-[var(--bg-canvas)] font-mono",
        !isActive && "opacity-95",
        className,
      )}
      onMouseDown={() => {
        onFocusRef.current?.();
        termRef.current?.focus();
      }}
      role="tabpanel"
      aria-label={`Terminal session ${session?.title ?? sessionId}`}
    >
      <div className="h-full w-full p-3">
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
}

export const TerminalSession = memo(TerminalSessionComponent);
