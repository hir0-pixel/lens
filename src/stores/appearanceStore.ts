import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  applyAppearance,
  DEFAULT_APPEARANCE,
  type AccentId,
  type AppearanceSettings,
  type ThemeMode,
  type UiDensity,
} from "@/shared/themes/themeManager";

interface AppearanceStore extends AppearanceSettings {
  setThemeMode: (mode: ThemeMode) => void;
  setAccent: (accent: AccentId) => void;
  setDensity: (density: UiDensity) => void;
  setFontFamily: (fontFamily: string) => void;
  setFontSize: (fontSize: number) => void;
  setLineHeight: (lineHeight: number) => void;
  setCornerRadius: (cornerRadius: number) => void;
  setIconTheme: (iconTheme: AppearanceSettings["iconTheme"]) => void;
  setTransparency: (transparency: boolean) => void;
  setReducedMotion: (reducedMotion: boolean) => void;
  setHighContrast: (highContrast: boolean) => void;
  patch: (partial: Partial<AppearanceSettings>) => void;
  reset: () => void;
  apply: () => void;
}

function snapshot(state: AppearanceStore): AppearanceSettings {
  return {
    themeMode: state.themeMode,
    accent: state.accent,
    density: state.density,
    fontFamily: state.fontFamily,
    fontSize: state.fontSize,
    lineHeight: state.lineHeight,
    cornerRadius: state.cornerRadius,
    iconTheme: state.iconTheme,
    transparency: state.transparency,
    reducedMotion: state.reducedMotion,
    highContrast: state.highContrast,
  };
}

export const useAppearanceStore = create<AppearanceStore>()(
  persist(
    (set, get) => ({
      ...DEFAULT_APPEARANCE,
      setThemeMode: (themeMode) => {
        set({ themeMode });
        applyAppearance(snapshot(get()));
      },
      setAccent: (accent) => {
        set({ accent });
        applyAppearance(snapshot(get()));
      },
      setDensity: (density) => {
        set({ density });
        applyAppearance(snapshot(get()));
      },
      setFontFamily: (fontFamily) => {
        set({ fontFamily });
        applyAppearance(snapshot(get()));
      },
      setFontSize: (fontSize) => {
        set({ fontSize });
        applyAppearance(snapshot(get()));
      },
      setLineHeight: (lineHeight) => {
        set({ lineHeight });
        applyAppearance(snapshot(get()));
      },
      setCornerRadius: (cornerRadius) => {
        set({ cornerRadius });
        applyAppearance(snapshot(get()));
      },
      setIconTheme: (iconTheme) => {
        set({ iconTheme });
        applyAppearance(snapshot(get()));
      },
      setTransparency: (transparency) => set({ transparency }),
      setReducedMotion: (reducedMotion) => {
        set({ reducedMotion });
        applyAppearance(snapshot(get()));
      },
      setHighContrast: (highContrast) => {
        set({ highContrast });
        applyAppearance(snapshot(get()));
      },
      patch: (partial) => {
        set(partial);
        applyAppearance(snapshot(get()));
      },
      reset: () => {
        set(DEFAULT_APPEARANCE);
        applyAppearance(DEFAULT_APPEARANCE);
      },
      apply: () => applyAppearance(snapshot(get())),
    }),
    {
      name: "orchids-appearance",
      onRehydrateStorage: () => (state) => {
        state?.apply();
      },
    },
  ),
);
