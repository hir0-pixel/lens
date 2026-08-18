import type { ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, X } from "lucide-react";
import { cn } from "@/lib/utils";

async function withWindow(
  fn: (w: ReturnType<typeof getCurrentWindow>) => Promise<void>,
) {
  try {
    const w = getCurrentWindow();
    await fn(w);
  } catch {
    /* browser / non-Tauri */
  }
}

export function WindowControls() {
  return (
    <div className="flex h-full items-stretch">
      <WinBtn
        label="Minimize"
        onClick={() => void withWindow((w) => w.minimize())}
      >
        <Minus className="h-2.5 w-2.5" strokeWidth={1.75} />
      </WinBtn>
      <WinBtn
        label="Maximize"
        onClick={() =>
          void withWindow(async (w) => {
            if (await w.isMaximized()) await w.unmaximize();
            else await w.maximize();
          })
        }
      >
        <Copy className="h-2.5 w-2.5" strokeWidth={1.75} />
      </WinBtn>
      <WinBtn
        label="Close"
        danger
        onClick={() =>
          void withWindow((w) => w.close()).finally(() => {
            try {
              window.close();
            } catch {
              /* ignore */
            }
          })
        }
      >
        <X className="h-2.5 w-2.5" strokeWidth={1.75} />
      </WinBtn>
    </div>
  );
}

function WinBtn({
  children,
  label,
  onClick,
  danger,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        "flex h-full w-[46px] items-center justify-center text-[var(--text-secondary)]",
        "transition-[background-color,color] duration-[var(--duration-instant)] ease-[var(--ease-standard)]",
        danger
          ? "hover:bg-[var(--error-muted)] hover:text-[var(--error)]"
          : "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
      )}
    >
      {children}
    </button>
  );
}
