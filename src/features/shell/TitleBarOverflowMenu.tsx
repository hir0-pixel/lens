import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { openFolder } from "@/features/projects/openFolder";
import { revealInFolder } from "@/features/projects/revealInFolder";
import { exitApp } from "@/features/projects/exitApp";
import { useSessionStore } from "@/stores/sessionStore";
import { UpdateService } from "@/shared/release/UpdateService";
import { logger } from "@/shared/diagnostics/logger";

function itemClass() {
  return "h-8 cursor-pointer rounded-md px-3 text-[13px] text-[var(--text-primary)] focus:bg-[var(--bg-hover)] focus:text-[var(--text-primary)]";
}

export function TitleBarOverflowMenu() {
  async function revealWorkspace() {
    const state = useSessionStore.getState();
    const repo =
      state.repositories.find((r) => r.id === state.activeRepositoryId) ??
      state.repositories[0];
    if (!repo?.path) {
      toast.message("No workspace open");
      return;
    }
    const ok = await revealInFolder(repo.path);
    if (!ok) {
      toast.error("Couldn’t open File Explorer", { description: repo.path });
    }
  }

  async function checkUpdates() {
    const info = await UpdateService.checkForUpdates();
    if (info.available) {
      toast.message("Update available", {
        description: info.version ?? "A newer build is ready.",
      });
    } else {
      toast.message("You’re up to date", {
        description: "Lens 0.1.0",
      });
    }
  }

  function processMonitor() {
    const mem = (
      performance as Performance & { memory?: { usedJSHeapSize: number } }
    ).memory;
    const heap = mem
      ? `${Math.round(mem.usedJSHeapSize / 1024 / 1024)} MB heap`
      : "heap unavailable";
    toast.message("Process monitor", {
      description: `Renderer · ${navigator.hardwareConcurrency ?? "?"} cores · ${heap}`,
    });
  }

  function exportLogs() {
    const lines = logger.getEntries().map((e) => {
      const ctx = e.context ? ` ${JSON.stringify(e.context)}` : "";
      return `${e.timestamp} [${e.level}] ${e.message}${ctx}`;
    });
    const blob = new Blob(
      [lines.join("\n") || "No log entries yet.\n"],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lens-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Logs exported");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="App menu"
          title="App menu"
          className="flex h-full w-8 items-center justify-center text-[var(--text-secondary)] outline-none hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] data-[state=open]:bg-[var(--bg-hover)] data-[state=open]:text-[var(--text-primary)]"
        >
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="min-w-[248px] rounded-xl border border-[var(--border-default)] bg-[var(--bg-overlay)] p-1.5 text-[var(--text-primary)] shadow-[var(--shadow-lg)]"
      >
        <DropdownMenuItem
          className={itemClass()}
          onClick={() =>
            window.dispatchEvent(new CustomEvent("lens:new-agent"))
          }
        >
          New task
          <DropdownMenuShortcut className="text-[11px] tracking-normal text-[var(--text-tertiary)]">
            Ctrl+N
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={itemClass()}
          onClick={() => void openFolder()}
        >
          Open workspace
          <DropdownMenuShortcut className="text-[11px] tracking-normal text-[var(--text-tertiary)]">
            Ctrl+O
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem className={itemClass()} onClick={() => void revealWorkspace()}>
          Open in File Explorer
        </DropdownMenuItem>

        <DropdownMenuSeparator className="mx-2 my-1.5 bg-[var(--border-subtle)]" />

        <DropdownMenuItem
          className={itemClass()}
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("lens:open-settings", {
                detail: { section: "about" },
              }),
            )
          }
        >
          About Lens
        </DropdownMenuItem>
        <DropdownMenuItem className={itemClass()} onClick={() => void checkUpdates()}>
          Check for updates
        </DropdownMenuItem>
        <DropdownMenuItem className={itemClass()} onClick={processMonitor}>
          Process monitor
        </DropdownMenuItem>

        <DropdownMenuSeparator className="mx-2 my-1.5 bg-[var(--border-subtle)]" />

        <DropdownMenuItem
          className={itemClass()}
          onClick={() =>
            toast.message("Feedback", {
              description: "Tell us what to improve — settings → About.",
            })
          }
        >
          Feedback
        </DropdownMenuItem>
        <DropdownMenuItem
          className={itemClass()}
          onClick={() =>
            toast.message("Request a feature", {
              description: "Describe it in chat or send feedback from About.",
            })
          }
        >
          Request a feature
        </DropdownMenuItem>
        <DropdownMenuItem
          className={itemClass()}
          onClick={() =>
            toast.message("Community", {
              description: "Community links will open here when published.",
            })
          }
        >
          Community
        </DropdownMenuItem>
        <DropdownMenuItem
          className={itemClass()}
          onClick={() =>
            window.dispatchEvent(new CustomEvent("lens:show-welcome"))
          }
        >
          Product docs
        </DropdownMenuItem>
        <DropdownMenuItem className={itemClass()} onClick={exportLogs}>
          Export logs
        </DropdownMenuItem>

        <DropdownMenuSeparator className="mx-2 my-1.5 bg-[var(--border-subtle)]" />

        <DropdownMenuItem
          className={itemClass()}
          onClick={() => void exitApp()}
        >
          Close window
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
