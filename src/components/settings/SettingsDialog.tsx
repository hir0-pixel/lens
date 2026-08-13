import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingsLayout } from "@/features/settings/SettingsLayout";
import { useSettingsStore } from "@/stores/settingsStore";
import type { ProviderState } from "@/lib/types";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Kept for App compatibility — providers now live in providerStore. */
  providers?: ProviderState[];
  onToggleProvider?: (id: ProviderState["id"]) => void;
}

/**
 * Settings shell — preserves App open/close API while rendering the
 * Cursor-style SettingsLayout experience.
 */
export default function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="flex h-[min(720px,calc(100vh-2rem))] max-h-[calc(100vh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
        onEscapeKeyDown={(e) => {
          const q = useSettingsStore.getState().searchQuery.trim();
          if (q) {
            useSettingsStore.getState().setSearchQuery("");
            e.preventDefault();
          }
        }}
      >
        <DialogHeader className="flex-row items-center justify-between border-b px-5 py-3 pr-14">
          <DialogTitle className="text-[15px] font-semibold">Settings</DialogTitle>
        </DialogHeader>
        <SettingsLayout />
      </DialogContent>
    </Dialog>
  );
}
