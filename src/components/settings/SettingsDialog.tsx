import Modal from "@/components/ui/Modal";
import { SettingsLayout } from "@/features/settings/SettingsLayout";
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
    <Modal open={open} onClose={onClose} title="Settings" size="xl">
      <SettingsLayout />
    </Modal>
  );
}
