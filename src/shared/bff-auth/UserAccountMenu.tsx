import { LogOut } from "lucide-react";
import { useAuthStore } from "./store";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Displays the authenticated user and a logout action in the Lens chrome.
 * Only shows avatar + display name; permissions are never decided here.
 */
export function UserAccountMenu() {
  const session = useAuthStore((s) => s.session);
  const logout = useAuthStore((s) => s.logout);
  const status = useAuthStore((s) => s.status);

  if (status !== "authenticated" || !session) {
    return null;
  }

  const displayName = session.name ?? session.preferredUsername ?? session.subject;
  const initial = (displayName ?? "U").charAt(0).toUpperCase();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] text-[12px] font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
          aria-label="Account menu"
          title={session.email ?? displayName}
        >
          {session.picture ? (
            <img
              src={session.picture}
              alt=""
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            initial
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-64 p-0">
        <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-3 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] text-[14px] font-semibold text-[var(--text-primary)]">
            {session.picture ? (
              <img
                src={session.picture}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              initial
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
              {displayName}
            </p>
            {session.email && (
              <p className="truncate text-[11px] text-[var(--text-tertiary)]">
                {session.email}
              </p>
            )}
          </div>
        </div>
        <div className="p-1">
          <Button
            type="button"
            variant="ghost"
            className="h-9 w-full justify-start gap-2 px-2 text-[13px]"
            onClick={() => void logout()}
          >
            <LogOut className="h-4 w-4" strokeWidth={1.75} />
            Sign out
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}