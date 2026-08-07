/**
 * Auto-update placeholder — wires to Tauri updater in a future release.
 */

import { logger } from "@/shared/diagnostics/logger";

export interface UpdateInfo {
  available: boolean;
  version?: string;
  notes?: string;
  mandatory?: boolean;
}

export const UpdateService = {
  /** Placeholder: returns no update. Real impl uses @tauri-apps/plugin-updater. */
  async checkForUpdates(): Promise<UpdateInfo> {
    logger.debug("update.check.skipped", {
      reason: "placeholder — enable tauri updater plugin for production releases",
    });
    return { available: false };
  },

  async installUpdate(): Promise<void> {
    logger.warn("update.install.unavailable");
    throw new Error(
      "In-app updates are not enabled in this build. Download the latest installer from the release page.",
    );
  },
};
