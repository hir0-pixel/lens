import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  type AccessibilitySettings,
  type AiSettings,
  type AppSettingsBundle,
  type BrowserSettings,
  type EditorSettings,
  type GeneralSettings,
  type GitSettings,
  type PrivacySettings,
  type SettingsSectionId,
  type TerminalSettings,
} from "@/shared/settings/defaults";
import { toast } from "sonner";
import { ValidationService } from "@/shared/preferences/ValidationService";

interface SettingsUIState {
  activeSection: SettingsSectionId;
  searchQuery: string;
  favorites: SettingsSectionId[];
  recentSections: SettingsSectionId[];
  searchHistory: string[];
}

interface SettingsStore extends AppSettingsBundle, SettingsUIState {
  setSection: (id: SettingsSectionId) => void;
  setSearchQuery: (q: string) => void;
  toggleFavorite: (id: SettingsSectionId) => void;
  pushSearchHistory: (q: string) => void;
  updateGeneral: (partial: Partial<GeneralSettings>) => void;
  updateEditor: (partial: Partial<EditorSettings>) => void;
  updateTerminal: (partial: Partial<TerminalSettings>) => void;
  updateBrowser: (partial: Partial<BrowserSettings>) => void;
  updateAi: (partial: Partial<AiSettings>) => void;
  updateGit: (partial: Partial<GitSettings>) => void;
  updatePrivacy: (partial: Partial<PrivacySettings>) => void;
  updateAccessibility: (partial: Partial<AccessibilitySettings>) => void;
  resetSection: (section: keyof AppSettingsBundle) => void;
  resetAll: () => void;
  exportSettings: () => string;
  importSettings: (json: string) => boolean;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,
      activeSection: "general",
      searchQuery: "",
      favorites: ["appearance", "providers", "ai"],
      recentSections: ["general", "appearance"],
      searchHistory: [],

      setSection: (activeSection) =>
        set((s) => ({
          activeSection,
          recentSections: [
            activeSection,
            ...s.recentSections.filter((x) => x !== activeSection),
          ].slice(0, 8),
        })),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      toggleFavorite: (id) =>
        set((s) => ({
          favorites: s.favorites.includes(id)
            ? s.favorites.filter((x) => x !== id)
            : [...s.favorites, id],
        })),
      pushSearchHistory: (q) => {
        if (!q.trim()) return;
        set((s) => ({
          searchHistory: [q, ...s.searchHistory.filter((x) => x !== q)].slice(0, 10),
        }));
      },

      updateGeneral: (partial) =>
        set((s) => ({ general: { ...s.general, ...partial } })),
      updateEditor: (partial) =>
        set((s) => ({ editor: { ...s.editor, ...partial } })),
      updateTerminal: (partial) =>
        set((s) => ({ terminal: { ...s.terminal, ...partial } })),
      updateBrowser: (partial) =>
        set((s) => ({ browser: { ...s.browser, ...partial } })),
      updateAi: (partial) => set((s) => ({ ai: { ...s.ai, ...partial } })),
      updateGit: (partial) => set((s) => ({ git: { ...s.git, ...partial } })),
      updatePrivacy: (partial) =>
        set((s) => ({ privacy: { ...s.privacy, ...partial } })),
      updateAccessibility: (partial) =>
        set((s) => ({ accessibility: { ...s.accessibility, ...partial } })),

      resetSection: (section) => {
        if (section === "version") return;
        set({ [section]: DEFAULT_SETTINGS[section] } as Partial<SettingsStore>);
        toast.success(`Reset ${section} settings`);
      },
      resetAll: () => {
        set({
          ...DEFAULT_SETTINGS,
          activeSection: get().activeSection,
          favorites: get().favorites,
          recentSections: get().recentSections,
          searchHistory: [],
          searchQuery: "",
        });
        toast.success("All settings restored to defaults");
      },

      exportSettings: () => {
        const s = get();
        const bundle: AppSettingsBundle = {
          version: SETTINGS_VERSION,
          general: s.general,
          editor: s.editor,
          terminal: s.terminal,
          browser: s.browser,
          ai: s.ai,
          git: s.git,
          privacy: s.privacy,
          accessibility: s.accessibility,
        };
        return JSON.stringify(bundle, null, 2);
      },

      importSettings: (json) => {
        try {
          const parsed = JSON.parse(json) as Partial<AppSettingsBundle>;
          const check = ValidationService.validateSettingsBundle(parsed);
          if (!check.ok) {
            toast.error(check.errors[0] ?? "Invalid settings file");
            return false;
          }
          if (check.warnings.length) {
            toast.message(check.warnings[0]);
          }
          set({
            general: { ...DEFAULT_SETTINGS.general, ...parsed.general },
            editor: { ...DEFAULT_SETTINGS.editor, ...parsed.editor },
            terminal: { ...DEFAULT_SETTINGS.terminal, ...parsed.terminal },
            browser: { ...DEFAULT_SETTINGS.browser, ...parsed.browser },
            ai: { ...DEFAULT_SETTINGS.ai, ...parsed.ai },
            git: { ...DEFAULT_SETTINGS.git, ...parsed.git },
            privacy: { ...DEFAULT_SETTINGS.privacy, ...parsed.privacy },
            accessibility: {
              ...DEFAULT_SETTINGS.accessibility,
              ...parsed.accessibility,
            },
            version: SETTINGS_VERSION,
          });
          toast.success("Settings imported");
          return true;
        } catch {
          toast.error("Invalid settings file");
          return false;
        }
      },
    }),
    {
      name: "lens-settings",
      partialize: (s) => ({
        version: s.version,
        general: s.general,
        editor: s.editor,
        terminal: s.terminal,
        browser: s.browser,
        ai: s.ai,
        git: s.git,
        privacy: s.privacy,
        accessibility: s.accessibility,
        favorites: s.favorites,
        recentSections: s.recentSections,
        searchHistory: s.searchHistory,
        activeSection: s.activeSection,
      }),
    },
  ),
);
