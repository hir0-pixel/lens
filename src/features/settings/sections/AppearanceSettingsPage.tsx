import { Check } from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import {
  SettingsGroup,
  SettingsSectionHeader,
  SettingRadio,
  SettingRow,
  SettingSelect,
  SettingSlider,
  SettingToggle,
} from "../SettingControls";
import { useAppearanceStore } from "@/stores/appearanceStore";
import { ACCENT_COLORS, type AccentId } from "@/shared/themes/themeManager";
import { cn } from "@/lib/utils";

const ACCENTS = Object.keys(ACCENT_COLORS) as AccentId[];

export function AppearanceSettingsPage() {
  const themeMode = useAppearanceStore((s) => s.themeMode);
  const accent = useAppearanceStore((s) => s.accent);
  const density = useAppearanceStore((s) => s.density);
  const fontFamily = useAppearanceStore((s) => s.fontFamily);
  const fontSize = useAppearanceStore((s) => s.fontSize);
  const lineHeight = useAppearanceStore((s) => s.lineHeight);
  const cornerRadius = useAppearanceStore((s) => s.cornerRadius);
  const iconTheme = useAppearanceStore((s) => s.iconTheme);
  const transparency = useAppearanceStore((s) => s.transparency);
  const setThemeMode = useAppearanceStore((s) => s.setThemeMode);
  const setAccent = useAppearanceStore((s) => s.setAccent);
  const setDensity = useAppearanceStore((s) => s.setDensity);
  const setFontFamily = useAppearanceStore((s) => s.setFontFamily);
  const setFontSize = useAppearanceStore((s) => s.setFontSize);
  const setLineHeight = useAppearanceStore((s) => s.setLineHeight);
  const setCornerRadius = useAppearanceStore((s) => s.setCornerRadius);
  const setIconTheme = useAppearanceStore((s) => s.setIconTheme);
  const setTransparency = useAppearanceStore((s) => s.setTransparency);

  return (
    <div>
      <SettingsSectionHeader
        title="Appearance"
        description="Color theme, accent, typography, and UI density. Changes apply instantly."
      />

      <SettingsGroup title="Theme">
        <SettingRadio
          id="a-theme"
          title="Color Theme"
          description="Follow system or force dark / light"
          value={themeMode}
          onValueChange={(v) => setThemeMode(v as typeof themeMode)}
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
            { value: "system", label: "System" },
          ]}
        />
        <SettingRow
          id="a-accent"
          title="Accent Color"
          description="Lens brand accent used across the IDE"
        >
          <div className="flex flex-wrap justify-end gap-2" id="a-accent">
            {ACCENTS.map((id) => (
              <Toggle
                key={id}
                type="button"
                pressed={accent === id}
                onPressedChange={() => setAccent(id)}
                aria-label={id}
                className={cn(
                  "size-7 min-w-0 rounded-full border-2 p-0 transition-transform hover:scale-110 hover:bg-transparent aria-pressed:bg-transparent",
                  accent === id ? "border-white" : "border-transparent",
                )}
                style={{ backgroundColor: ACCENT_COLORS[id] }}
              >
                {accent === id && <Check className="h-3.5 w-3.5 text-surface-0" />}
              </Toggle>
            ))}
          </div>
        </SettingRow>
        <SettingSelect
          id="a-density"
          title="UI Density"
          value={density}
          onValueChange={(v) => setDensity(v as typeof density)}
          options={[
            { value: "comfortable", label: "Comfortable" },
            { value: "default", label: "Default" },
            { value: "compact", label: "Compact" },
          ]}
        />
      </SettingsGroup>

      <SettingsGroup title="Typography">
        <SettingSelect
          id="a-font"
          title="Font Family"
          value={fontFamily}
          onValueChange={setFontFamily}
          options={[
            { value: "Inter", label: "Inter" },
            { value: "Geist", label: "Geist" },
            { value: "Segoe UI", label: "Segoe UI" },
            { value: "SF Pro Text", label: "SF Pro Text" },
          ]}
        />
        <SettingSlider
          id="a-size"
          title="Font Size"
          value={fontSize}
          min={11}
          max={18}
          onValueChange={setFontSize}
          suffix="px"
        />
        <SettingSlider
          title="Line Height"
          value={lineHeight}
          min={1.2}
          max={2}
          step={0.05}
          onValueChange={setLineHeight}
        />
        <SettingSlider
          title="Corner Radius"
          value={cornerRadius}
          min={0}
          max={16}
          onValueChange={setCornerRadius}
          suffix="px"
        />
      </SettingsGroup>

      <SettingsGroup title="Icons & Effects">
        <SettingSelect
          title="Icon Theme"
          value={iconTheme}
          onValueChange={(v) => setIconTheme(v as typeof iconTheme)}
          options={[
            { value: "default", label: "Default" },
            { value: "minimal", label: "Minimal" },
          ]}
        />
        <SettingToggle
          title="Window transparency"
          description="Placeholder — requires native compositor support"
          checked={transparency}
          onCheckedChange={setTransparency}
        />
      </SettingsGroup>
    </div>
  );
}
