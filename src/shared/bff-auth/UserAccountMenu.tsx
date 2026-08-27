import { LogOut } from "@/components/icons/tabler";
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
interface UserAccountMenuProps {
  /** When true, renders avatar circle + actual username label for sidebars/footers. */
  showLabel?: boolean;
}

export function UserAccountMenu({ showLabel = false }: UserAccountMenuProps = {}) {
  const session = useAuthStore((s) => s.session);
  const logout = useAuthStore((s) => s.logout);
  const status = useAuthStore((s) => s.status);

  const displayName =
    session?.name ?? session?.preferredUsername ?? session?.subject ?? "devuser";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <Popover>
      <PopoverTrigger asChild>
        {showLabel ? (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-[var(--bg-hover)]"
            title={session?.email ?? displayName}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--bg-active)] type-caption font-medium text-[var(--text-primary)]">
              {session?.picture ? (
                <img
                  src={session.picture}
                  alt=""
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                initial
              )}
            </span>
            <span className="min-w-0 truncate type-caption text-[var(--text-secondary)]">
              {displayName}
            </span>
          </button>
        ) : (
          <button
            type="button"
            className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] type-caption font-semibold text-[var(--text-primary)] transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)] hover:bg-[var(--bg-hover)]"
            aria-label="Account menu"
            title={session?.email ?? displayName}
          >
            {session?.picture ? (
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
        )}
      </PopoverTrigger>
      <PopoverContent
        align={showLabel ? "start" : "end"}
        side={showLabel ? "top" : "bottom"}
        className="w-64 p-0"
      >
        <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-3 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] type-body-sm font-semibold text-[var(--text-primary)]">
            {session?.picture ? (
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
            <p className="truncate type-caption font-semibold text-[var(--text-primary)]">
              {displayName}
            </p>
            {session?.email && (
              <p className="truncate type-caption text-[var(--text-tertiary)]">
                {session.email}
              </p>
            )}
          </div>
        </div>
        {status === "authenticated" && (
          <div className="p-1">
            <Button
              type="button"
              variant="ghost"
              className="h-9 w-full justify-start gap-2 px-2 type-caption"
              onClick={() => void logout()}
            >
              <LogOut className="h-4 w-4" strokeWidth={1.75} />
              Sign out
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
