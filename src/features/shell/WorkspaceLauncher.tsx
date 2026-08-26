import { useId } from "react";
import { Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { revealInFolder } from "@/features/projects/revealInFolder";
import { isTauri } from "@/features/projects/platform";
import { openIdeWindow } from "@/features/windows/openAppWindow";
import { useSessionStore } from "@/stores/sessionStore";

function ExplorerGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("h-4 w-4 shrink-0", className)}
      aria-hidden
    >
      <path
        fill="#f5a623"
        d="M1.2 4.1c0-.7.5-1.2 1.2-1.2h3.05c.2 0 .4.08.55.22L6.9 4.1h6.7c.7 0 1.2.5 1.2 1.2v.7H1.2v-.9Z"
      />
      <path
        fill="#f9cb28"
        d="M1.2 5.4h13.6v6.9c0 .8-.6 1.4-1.4 1.4H2.6c-.8 0-1.4-.6-1.4-1.4V5.4Z"
      />
      <rect x="8.15" y="7.15" width="5.35" height="5.2" rx="0.7" fill="#007cf0" />
    </svg>
  );
}

function VsCodeLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("h-4 w-4 shrink-0", className)}
      aria-hidden
    >
      <path
        fill="#0070f3"
        d="M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L2.65 18.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"
      />
    </svg>
  );
}

function CursorLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("h-4 w-4 shrink-0", className)}
      aria-hidden
    >
      <rect width="24" height="24" rx="5" fill="#171717" />
      <path fill="#ebebeb" d="M6.4 4.6 17.8 12.15l-5.55 1.28L8.7 20.2z" />
      <path fill="#888888" d="m12.25 13.43 5.55-1.28-2.85 8.05-4.55-1.2z" />
      <path fill="#4d4d4d" d="m12.25 13.43 2.15 5.57-5.7 1.2z" />
    </svg>
  );
}

function ClionLogo({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("h-4 w-4 shrink-0", className)}
      aria-hidden
    >
      <defs>
        <linearGradient
          id={`${id}-g`}
          x1="2"
          y1="2"
          x2="22"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#50e3c2" />
          <stop offset="0.45" stopColor="#007cf0" />
          <stop offset="1" stopColor="#ff4d4d" />
        </linearGradient>
      </defs>
      <rect
        x="1.25"
        y="1.25"
        width="21.5"
        height="21.5"
        rx="3.6"
        fill="#171717"
        stroke={`url(#${id}-g)`}
        strokeWidth="1.7"
      />
      <path
        fill="#f5f5f5"
        d="M6.35 6.35c1.72 0 2.88.64 3.58 1.58l-1.28 1.18c-.52-.64-1.14-.98-2.2-.98-1.42 0-2.4 1.14-2.4 2.72s.98 2.72 2.4 2.72c1.1 0 1.74-.4 2.3-1.04l1.24 1.24c-.82.92-1.88 1.62-3.62 1.62-2.32 0-4-1.78-4-4.54 0-2.74 1.7-4.5 3.98-4.5zm5.15.25h2.12v6.82h3.7v1.88h-5.82V6.6z"
      />
    </svg>
  );
}

const itemClass =
  "h-9 cursor-pointer gap-2.5 rounded-md px-2.5 type-caption text-[var(--text-primary)] focus:bg-[var(--bg-hover)] focus:text-[var(--text-primary)]";

async function openInEditor(
  name: "VS Code" | "Cursor" | "CLion",
  scheme: string,
  folder?: string,
) {
  if (!folder) {
    toast.message("No folder open");
    return;
  }
  const path = folder.replace(/\\/g, "/");
  const url = `${scheme}${path}`;
  try {
    if (isTauri()) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    }
    window.open(url, "_blank");
  } catch {
    toast.error(`Couldn’t open ${name}`, {
      description: folder,
    });
  }
}

export function WorkspaceLauncher() {
  const repositories = useSessionStore((s) => s.repositories);
  const activeRepositoryId = useSessionStore((s) => s.activeRepositoryId);
  const repo =
    repositories.find((r) => r.id === activeRepositoryId) ?? repositories[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Open workspace"
          title="Open workspace"
          className="mx-1 inline-flex h-[22px] items-center gap-0.5 self-center rounded-md border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-1.5 leading-none hover:bg-[var(--bg-hover)]"
        >
          <ExplorerGlyph className="block" />
          <ChevronDown
            className="block h-3 w-3 shrink-0 translate-y-[1px] text-[var(--text-tertiary)]"
            strokeWidth={2}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="min-w-[200px] rounded-xl border-[var(--border-default)] bg-[var(--bg-overlay)] p-1.5 text-[var(--text-primary)]"
      >
        <DropdownMenuItem
          className={itemClass}
          onClick={() => {
            if (repo?.path) void revealInFolder(repo.path);
            else toast.message("No folder open");
          }}
        >
          <ExplorerGlyph />
          Resource Manager
          <Check className="ml-auto h-3.5 w-3.5 text-[var(--text-secondary)]" strokeWidth={2} />
        </DropdownMenuItem>
        <DropdownMenuItem
          className={itemClass}
          onClick={() => void openIdeWindow()}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] bg-[var(--bg-hover)] type-caption font-semibold text-[var(--text-primary)]">
            L
          </span>
          Lens IDE
        </DropdownMenuItem>
        <DropdownMenuItem
          className={itemClass}
          onClick={() => void openInEditor("VS Code", "vscode://file/", repo?.path)}
        >
          <VsCodeLogo />
          VS Code
        </DropdownMenuItem>
        <DropdownMenuItem
          className={itemClass}
          onClick={() => void openInEditor("Cursor", "cursor://file/", repo?.path)}
        >
          <CursorLogo />
          Cursor
        </DropdownMenuItem>
        <DropdownMenuItem
          className={itemClass}
          onClick={() =>
            void openInEditor("CLion", "jetbrains://clion/navigate/reference?path=", repo?.path)
          }
        >
          <ClionLogo />
          CLion
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
