import {
  SettingsGroup,
  SettingsSectionHeader,
  SettingInput,
  SettingSelect,
  SettingToggle,
} from "../SettingControls";
import { useSettingsStore } from "@/stores/settingsStore";

export function BrowserSettingsPage() {
  const browser = useSettingsStore((s) => s.browser);
  const update = useSettingsStore((s) => s.updateBrowser);

  return (
    <div>
      <SettingsSectionHeader
        title="Browser"
        description="Embedded browser homepage, search, and privacy."
      />
      <SettingsGroup>
        <SettingInput
          title="Default homepage"
          value={browser.homepage}
          onChange={(v) => update({ homepage: v })}
          mono
        />
        <SettingSelect
          title="Search engine"
          value={browser.searchEngine}
          onValueChange={(v) =>
            update({ searchEngine: v as typeof browser.searchEngine })
          }
          options={[
            { value: "google", label: "Google" },
            { value: "duckduckgo", label: "DuckDuckGo" },
            { value: "bing", label: "Bing" },
          ]}
        />
        <SettingInput
          title="Download directory"
          value={browser.downloadDirectory}
          onChange={(v) => update({ downloadDirectory: v })}
          mono
        />
        <SettingToggle
          title="Block trackers"
          description="Basic privacy shield for the embedded browser"
          checked={browser.blockTrackers}
          onCheckedChange={(v) => update({ blockTrackers: v })}
        />
      </SettingsGroup>
    </div>
  );
}
