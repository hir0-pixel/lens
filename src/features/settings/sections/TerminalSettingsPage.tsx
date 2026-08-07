import {
  SettingsGroup,
  SettingsSectionHeader,
  SettingSelect,
  SettingSlider,
} from "../SettingControls";
import { useSettingsStore } from "@/stores/settingsStore";

export function TerminalSettingsPage() {
  const terminal = useSettingsStore((s) => s.terminal);
  const update = useSettingsStore((s) => s.updateTerminal);

  return (
    <div>
      <SettingsSectionHeader
        title="Terminal"
        description="Default shell, fonts, scrollback, and renderer."
      />
      <SettingsGroup title="Shell">
        <SettingSelect
          id="t-shell"
          title="Default Shell"
          value={terminal.defaultShell}
          onValueChange={(v) =>
            update({ defaultShell: v as typeof terminal.defaultShell })
          }
          options={[
            { value: "powershell", label: "PowerShell" },
            { value: "bash", label: "bash" },
            { value: "cmd", label: "Command Prompt" },
            { value: "zsh", label: "zsh" },
          ]}
        />
        <SettingSelect
          title="Font Family"
          value={terminal.fontFamily}
          onValueChange={(v) => update({ fontFamily: v })}
          options={[
            { value: "JetBrains Mono", label: "JetBrains Mono" },
            { value: "Geist Mono", label: "Geist Mono" },
            { value: "Cascadia Code", label: "Cascadia Code" },
            { value: "Consolas", label: "Consolas" },
          ]}
        />
        <SettingSlider
          title="Font Size"
          value={terminal.fontSize}
          min={10}
          max={18}
          onValueChange={(v) => update({ fontSize: v })}
          suffix="px"
        />
        <SettingSelect
          title="Cursor Style"
          value={terminal.cursorStyle}
          onValueChange={(v) =>
            update({ cursorStyle: v as typeof terminal.cursorStyle })
          }
          options={[
            { value: "block", label: "Block" },
            { value: "underline", label: "Underline" },
            { value: "bar", label: "Bar" },
          ]}
        />
      </SettingsGroup>
      <SettingsGroup title="Buffer & Rendering">
        <SettingSelect
          id="t-scroll"
          title="Scrollback"
          value={String(terminal.scrollback)}
          onValueChange={(v) => update({ scrollback: Number(v) })}
          options={[
            { value: "1000", label: "1,000" },
            { value: "5000", label: "5,000" },
            { value: "10000", label: "10,000" },
            { value: "50000", label: "50,000" },
          ]}
        />
        <SettingSlider
          title="Terminal Opacity"
          description="Placeholder for native transparency"
          value={terminal.opacity}
          min={60}
          max={100}
          onValueChange={(v) => update({ opacity: v })}
          suffix="%"
        />
        <SettingSelect
          title="Renderer"
          value={terminal.renderer}
          onValueChange={(v) =>
            update({ renderer: v as typeof terminal.renderer })
          }
          options={[
            { value: "canvas", label: "Canvas" },
            { value: "dom", label: "DOM" },
            { value: "webgl", label: "WebGL" },
          ]}
        />
      </SettingsGroup>
    </div>
  );
}
