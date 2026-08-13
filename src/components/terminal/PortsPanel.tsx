import { ExternalLink, Radio } from "lucide-react";

const MOCK_PORTS = [
  { port: 1420, process: "vite", label: "Lens Dev Server" },
  { port: 3000, process: "node", label: "Preview" },
];

/**
 * Ports panel — forwarded / local development ports.
 */
export function PortsPanel() {
  return (
    <div className="flex h-full flex-col bg-[var(--ds-panel)] text-[13px]">
      <div className="flex h-[28px] shrink-0 items-center px-3 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--ds-fg-muted)]">
        Forwarded Ports
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {MOCK_PORTS.map((p) => (
          <li
            key={p.port}
            className="cursor-list-row flex items-center gap-2 px-3 hover:bg-[var(--ds-hover)]"
          >
            <Radio
              className="h-3.5 w-3.5 text-[var(--ds-success)]"
              strokeWidth={1.5}
            />
            <span className="tabular-nums text-[var(--ds-fg)]">{p.port}</span>
            <span className="text-[var(--ds-fg-muted)]">{p.process}</span>
            <span className="min-w-0 flex-1 truncate text-[var(--ds-fg-muted)]">
              {p.label}
            </span>
            <a
              href={`http://localhost:${p.port}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[12px] text-[var(--cursor-focus)] transition-colors hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              Open
              <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
