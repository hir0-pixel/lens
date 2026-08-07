import {
  SettingsGroup,
  SettingsSectionHeader,
  SettingInput,
  SettingSelect,
  SettingToggle,
} from "../SettingControls";
import { useSettingsStore } from "@/stores/settingsStore";

export function GeneralSettingsPage() {
  const general = useSettingsStore((s) => s.general);
  const update = useSettingsStore((s) => s.updateGeneral);

  return (
    <div>
      <SettingsSectionHeader
        title="General"
        description="Startup behavior, autosave, and workspace preferences."
      />
      <SettingsGroup title="Startup">
        <SettingToggle
          id="g-startup"
          title="Show welcome on startup"
          description="Display the welcome screen when Orchids launches"
          checked={general.showWelcomeOnStartup}
          onCheckedChange={(v) => update({ showWelcomeOnStartup: v })}
        />
        <SettingToggle
          id="g-restore"
          title="Restore previous windows"
          description="Reopen windows and folders from the last session"
          checked={general.restoreWindows}
          onCheckedChange={(v) => update({ restoreWindows: v })}
        />
        <SettingToggle
          title="Open projects in new window"
          checked={general.openInNewWindow}
          onCheckedChange={(v) => update({ openInNewWindow: v })}
        />
      </SettingsGroup>
      <SettingsGroup title="Files">
        <SettingSelect
          id="g-autosave"
          title="Auto Save"
          description="Controls auto save of dirty editors"
          value={general.autosave}
          onValueChange={(v) =>
            update({ autosave: v as typeof general.autosave })
          }
          options={[
            { value: "off", label: "Off" },
            { value: "afterDelay", label: "After Delay" },
            { value: "onFocusChange", label: "On Focus Change" },
            { value: "onWindowChange", label: "On Window Change" },
          ]}
        />
        <SettingSelect
          title="Auto Save Delay"
          description="Milliseconds before autosave (when After Delay)"
          value={String(general.autosaveDelay)}
          onValueChange={(v) => update({ autosaveDelay: Number(v) })}
          options={[
            { value: "500", label: "500 ms" },
            { value: "1000", label: "1000 ms" },
            { value: "2000", label: "2000 ms" },
            { value: "5000", label: "5000 ms" },
          ]}
        />
        <SettingToggle
          title="Confirm before closing"
          checked={general.confirmBeforeClose}
          onCheckedChange={(v) => update({ confirmBeforeClose: v })}
        />
        <SettingInput
          title="Default workspace"
          description="Fallback folder when no project is open"
          value={general.defaultWorkspace}
          onChange={(v) => update({ defaultWorkspace: v })}
          mono
        />
      </SettingsGroup>
    </div>
  );
}
