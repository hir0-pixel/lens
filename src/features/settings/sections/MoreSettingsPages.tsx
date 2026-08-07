import {
  SettingsGroup,
  SettingsSectionHeader,
  SettingSelect,
  SettingToggle,
} from "../SettingControls";
import { useSettingsStore } from "@/stores/settingsStore";
import { useAppearanceStore } from "@/stores/appearanceStore";
import { Button } from "@/components/ui/button";
import { formatShortcut } from "@/features/keyboard/ShortcutRegistry";
import { DEFAULT_KEYBINDINGS } from "@/features/keyboard/ShortcutRegistry";
import { toast } from "sonner";
import { PreferencesService } from "@/shared/preferences/PreferencesService";

export function GitSettingsPage() {
  const git = useSettingsStore((s) => s.git);
  const update = useSettingsStore((s) => s.updateGit);

  return (
    <div>
      <SettingsSectionHeader
        title="Git"
        description="Fetch, pull strategy, and commit confirmations."
      />
      <SettingsGroup>
        <SettingToggle
          id="git-fetch"
          title="Auto Fetch"
          description="Periodically fetch from remotes in the background"
          checked={git.autoFetch}
          onCheckedChange={(v) => update({ autoFetch: v })}
        />
        <SettingSelect
          title="Auto Fetch Interval"
          value={String(git.autoFetchInterval)}
          onValueChange={(v) => update({ autoFetchInterval: Number(v) })}
          options={[
            { value: "60", label: "1 minute" },
            { value: "180", label: "3 minutes" },
            { value: "600", label: "10 minutes" },
          ]}
        />
        <SettingToggle
          title="Confirm before commit"
          checked={git.confirmCommit}
          onCheckedChange={(v) => update({ confirmCommit: v })}
        />
        <SettingSelect
          id="git-pull"
          title="Pull Strategy"
          value={git.pullStrategy}
          onValueChange={(v) =>
            update({ pullStrategy: v as typeof git.pullStrategy })
          }
          options={[
            { value: "merge", label: "Merge" },
            { value: "rebase", label: "Rebase" },
            { value: "ff-only", label: "Fast-forward only" },
          ]}
        />
        <SettingToggle
          title="Prefer rebase when pulling"
          checked={git.preferRebase}
          onCheckedChange={(v) => update({ preferRebase: v })}
        />
        <SettingToggle
          title="Show inline diffs"
          checked={git.showInlineDiff}
          onCheckedChange={(v) => update({ showInlineDiff: v })}
        />
      </SettingsGroup>
    </div>
  );
}

export function PrivacySettingsPage() {
  const privacy = useSettingsStore((s) => s.privacy);
  const update = useSettingsStore((s) => s.updatePrivacy);

  return (
    <div>
      <SettingsSectionHeader
        title="Privacy"
        description="Telemetry, crash reports, and diagnostics. Off by default where possible."
      />
      <SettingsGroup>
        <SettingToggle
          id="priv-tele"
          title="Telemetry"
          description="Anonymous product usage events"
          checked={privacy.telemetry}
          onCheckedChange={(v) => update({ telemetry: v })}
        />
        <SettingToggle
          title="Crash reporting"
          checked={privacy.crashReporting}
          onCheckedChange={(v) => update({ crashReporting: v })}
        />
        <SettingToggle
          title="Diagnostics"
          description="Include diagnostic logs when reporting issues"
          checked={privacy.diagnostics}
          onCheckedChange={(v) => update({ diagnostics: v })}
        />
        <SettingToggle
          title="Usage analytics"
          checked={privacy.usageAnalytics}
          onCheckedChange={(v) => update({ usageAnalytics: v })}
        />
      </SettingsGroup>
    </div>
  );
}

export function AccessibilitySettingsPage() {
  const accessibility = useSettingsStore((s) => s.accessibility);
  const update = useSettingsStore((s) => s.updateAccessibility);
  const reducedMotion = useAppearanceStore((s) => s.reducedMotion);
  const highContrast = useAppearanceStore((s) => s.highContrast);
  const setReducedMotion = useAppearanceStore((s) => s.setReducedMotion);
  const setHighContrast = useAppearanceStore((s) => s.setHighContrast);

  return (
    <div>
      <SettingsSectionHeader
        title="Accessibility"
        description="Motion, contrast, focus, and screen reader preferences."
      />
      <SettingsGroup>
        <SettingToggle
          id="acc-motion"
          title="Reduced motion"
          description="Minimize animations and transitions"
          checked={reducedMotion}
          onCheckedChange={setReducedMotion}
        />
        <SettingToggle
          id="acc-contrast"
          title="High contrast"
          checked={highContrast}
          onCheckedChange={setHighContrast}
        />
        <SettingToggle
          title="Screen reader mode"
          checked={accessibility.screenReaderMode}
          onCheckedChange={(v) => update({ screenReaderMode: v })}
        />
        <SettingToggle
          title="Enhanced keyboard navigation"
          checked={accessibility.keyboardNavigation}
          onCheckedChange={(v) => update({ keyboardNavigation: v })}
        />
        <SettingSelect
          title="Focus indicators"
          value={accessibility.focusIndicators}
          onValueChange={(v) =>
            update({
              focusIndicators: v as typeof accessibility.focusIndicators,
            })
          }
          options={[
            { value: "default", label: "Default" },
            { value: "enhanced", label: "Enhanced" },
          ]}
        />
      </SettingsGroup>
    </div>
  );
}

export function KeyboardSettingsPage() {
  return (
    <div>
      <SettingsSectionHeader
        title="Keyboard Shortcuts"
        description="Reference for primary Orchids / Cursor-aligned bindings. Full remapping coming soon."
      />
      <div className="overflow-hidden rounded-lg border border-white/10 divide-y divide-white/5">
        {DEFAULT_KEYBINDINGS.map((b) => (
          <div
            key={`${b.commandId}-${b.keys}`}
            className="flex items-center justify-between gap-3 px-3.5 py-2.5"
          >
            <span className="truncate font-mono text-[11px] text-zinc-500">
              {b.commandId}
            </span>
            <kbd className="shrink-0 rounded border border-white/10 bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-zinc-300">
              {formatShortcut(b.keys)}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AboutSettingsPage() {
  const resetAll = useSettingsStore((s) => s.resetAll);
  const resetAppearance = useAppearanceStore((s) => s.reset);

  function handleExport() {
    const json = PreferencesService.exportAll();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orchids-settings-v1.json`;
    a.click();
    URL.revokeObjectURL(url);
    PreferencesService.createBackup("export");
    toast.success("Settings exported");
  }

  function handleImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const ok = PreferencesService.importAll(text);
      if (!ok) {
        useSettingsStore.getState().importSettings(text);
      }
    };
    input.click();
  }

  return (
    <div>
      <SettingsSectionHeader
        title="About"
        description="Orchids Desktop IDE · Settings backup and restore."
      />
      <SettingsGroup title="Application">
        <div className="space-y-1 px-3.5 py-3 text-[12px] text-zinc-400">
          <div>
            Version <span className="text-zinc-200">0.1.0</span>
          </div>
          <div>
            Settings schema <span className="text-zinc-200">v1</span>
          </div>
          <div>Tauri 2 · React 19 · Vite 7</div>
        </div>
      </SettingsGroup>
      <SettingsGroup title="Backup">
        <div className="flex flex-wrap gap-2 px-3.5 py-3">
          <Button size="sm" variant="secondary" onClick={handleExport} id="about-export">
            Export settings
          </Button>
          <Button size="sm" variant="secondary" onClick={handleImport} id="about-import">
            Import settings
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="text-amber-400"
            onClick={() => {
              resetAll();
              resetAppearance();
            }}
          >
            Restore all defaults
          </Button>
        </div>
      </SettingsGroup>
    </div>
  );
}
