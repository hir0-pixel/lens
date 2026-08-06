import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const BOOT_LINES = [
  "\u001b[90m┌──────────────────────────────────────────────┐\u001b[0m",
  "\u001b[90m│\u001b[0m  \u001b[33mOrchids\uf000 Terminal — finance-dashboard  \u001b[90m│\u001b[0m",
  "\u001b[90m└──────────────────────────────────────────────┘\u001b[0m",
  "",
  "  Node v22.11.0 · npm 11.2.0 · Vite 7",
  "  Branch: main · Last commit: fc8ab2d",
  "",
  "\u001b[32m➜\u001b[0m  Local:\u001b[36m   http://localhost:5173/\u001b[0m",
  "\u001b[32m➜\u001b[0m  Network:\u001b[36m http://192.168.1.42:5173/\u001b[0m",
  "",
  "\u001b[32m➜\u001b[0m  press \u001b[33mh + enter\u001b[0m to show help",
];

export default function TerminalView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily:
        "JetBrains Mono, Geist Mono, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      theme: {
        background: "#0C0C0D",
        foreground: "#D4D4D8",
        cursor: "#FCAA26",
        cursorAccent: "#0C0C0D",
        selectionBackground: "rgba(252,170,38,0.35)",
        black: "#18181B",
        red: "#F87171",
        green: "#4ADE80",
        yellow: "#FACC15",
        blue: "#60A5FA",
        magenta: "#E879F9",
        cyan: "#22D3EE",
        white: "#E4E4E7",
        brightBlack: "#3F3F46",
      },
      cursorBlink: true,
      scrollback: 1000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);

    term.open(containerRef.current);
    fit.fit();

    BOOT_LINES.forEach((line) => term.writeln(line));
    term.write("\n\u001b[32m➜\u001b[0m ");

    terminalRef.current = term;

    const resizeHandler = () => fit.fit();
    window.addEventListener("resize", resizeHandler);
    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(containerRef.current);

    return () => {
      window.removeEventListener("resize", resizeHandler);
      ro.disconnect();
      term.dispose();
      terminalRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="h-full w-full bg-surface-0" />;
}