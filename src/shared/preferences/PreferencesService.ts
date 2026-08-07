import { useAppearanceStore } from "@/stores/appearanceStore";
import { useProviderStore } from "@/stores/providerStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { PersistenceService } from "./PersistenceService";
import { ValidationService } from "./ValidationService";

/**
 * Cross-store preferences orchestration (export, import, backups, defaults).
 */
export const PreferencesService = {
  exportAll(): string {
    const settings = useSettingsStore.getState().exportSettings();
    const appearance = useAppearanceStore.getState();
    const providers = useProviderStore.getState();
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        settings: JSON.parse(settings),
        appearance: {
          themeMode: appearance.themeMode,
          accent: appearance.accent,
          density: appearance.density,
          fontFamily: appearance.fontFamily,
          fontSize: appearance.fontSize,
          lineHeight: appearance.lineHeight,
          cornerRadius: appearance.cornerRadius,
          iconTheme: appearance.iconTheme,
          transparency: appearance.transparency,
          reducedMotion: appearance.reducedMotion,
          highContrast: appearance.highContrast,
        },
        providers: {
          providers: providers.providers,
          models: providers.models,
          recentModelIds: providers.recentModelIds,
        },
      },
      null,
      2,
    );
  },

  importAll(json: string): boolean {
    try {
      const parsed = JSON.parse(json) as {
        settings?: unknown;
        appearance?: Record<string, unknown>;
        providers?: {
          providers?: unknown;
          models?: unknown;
          recentModelIds?: string[];
        };
      };

      if (parsed.settings) {
        const check = ValidationService.validateSettingsBundle(parsed.settings);
        if (!check.ok) return false;
        useSettingsStore
          .getState()
          .importSettings(JSON.stringify(parsed.settings));
      }

      if (parsed.appearance) {
        const a = useAppearanceStore.getState();
        if (parsed.appearance.themeMode)
          a.setThemeMode(parsed.appearance.themeMode as never);
        if (parsed.appearance.accent)
          a.setAccent(parsed.appearance.accent as never);
        if (typeof parsed.appearance.fontSize === "number")
          a.setFontSize(parsed.appearance.fontSize);
        if (typeof parsed.appearance.density === "string")
          a.setDensity(parsed.appearance.density as never);
      }

      return true;
    } catch {
      return false;
    }
  },

  createBackup(label = "manual"): string {
    const payload = this.exportAll();
    return PersistenceService.backup(label, JSON.parse(payload));
  },

  restoreDefaults(): void {
    useSettingsStore.getState().resetAll();
    useAppearanceStore.getState().reset();
  },
};
