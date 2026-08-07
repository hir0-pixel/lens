import {
  SettingsGroup,
  SettingsSectionHeader,
  SettingSelect,
  SettingToggle,
} from "../SettingControls";
import { useSettingsStore } from "@/stores/settingsStore";

export function EditorSettingsPage() {
  const editor = useSettingsStore((s) => s.editor);
  const update = useSettingsStore((s) => s.updateEditor);

  return (
    <div>
      <SettingsSectionHeader
        title="Editor"
        description="Tab size, wrapping, minimap, cursor, and format-on-save."
      />
      <SettingsGroup title="Display">
        <SettingSelect
          id="e-tab"
          title="Tab Size"
          value={String(editor.tabSize)}
          onValueChange={(v) => update({ tabSize: Number(v) })}
          options={[
            { value: "2", label: "2" },
            { value: "4", label: "4" },
            { value: "8", label: "8" },
          ]}
        />
        <SettingSelect
          id="e-wrap"
          title="Word Wrap"
          value={editor.wordWrap}
          onValueChange={(v) => update({ wordWrap: v as typeof editor.wordWrap })}
          options={[
            { value: "off", label: "Off" },
            { value: "on", label: "On" },
            { value: "wordWrapColumn", label: "Word Wrap Column" },
          ]}
        />
        <SettingToggle
          id="e-mini"
          title="Minimap"
          checked={editor.minimap}
          onCheckedChange={(v) => update({ minimap: v })}
        />
        <SettingSelect
          title="Line Numbers"
          value={editor.lineNumbers}
          onValueChange={(v) => update({ lineNumbers: v as typeof editor.lineNumbers })}
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
            { value: "relative", label: "Relative" },
          ]}
        />
        <SettingToggle
          title="Sticky Scroll"
          description="Show nested scopes at the top of the editor"
          checked={editor.stickyScroll}
          onCheckedChange={(v) => update({ stickyScroll: v })}
        />
      </SettingsGroup>
      <SettingsGroup title="Cursor">
        <SettingSelect
          title="Cursor Style"
          value={editor.cursorStyle}
          onValueChange={(v) => update({ cursorStyle: v as typeof editor.cursorStyle })}
          options={[
            { value: "line", label: "Line" },
            { value: "block", label: "Block" },
            { value: "underline", label: "Underline" },
          ]}
        />
        <SettingSelect
          title="Cursor Blinking"
          value={editor.cursorBlinking}
          onValueChange={(v) =>
            update({ cursorBlinking: v as typeof editor.cursorBlinking })
          }
          options={[
            { value: "blink", label: "Blink" },
            { value: "smooth", label: "Smooth" },
            { value: "phase", label: "Phase" },
            { value: "solid", label: "Solid" },
          ]}
        />
      </SettingsGroup>
      <SettingsGroup title="Editing">
        <SettingToggle
          id="e-format"
          title="Format on Save"
          checked={editor.formatOnSave}
          onCheckedChange={(v) => update({ formatOnSave: v })}
        />
        <SettingToggle
          title="Auto Complete"
          checked={editor.autoComplete}
          onCheckedChange={(v) => update({ autoComplete: v })}
        />
        <SettingToggle
          title="Code Actions on Save"
          checked={editor.codeActionsOnSave}
          onCheckedChange={(v) => update({ codeActionsOnSave: v })}
        />
      </SettingsGroup>
    </div>
  );
}
