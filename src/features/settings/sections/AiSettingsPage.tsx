import {
  SettingsGroup,
  SettingsSectionHeader,
  SettingSelect,
  SettingSlider,
  SettingToggle,
} from "../SettingControls";
import { useSettingsStore } from "@/stores/settingsStore";
import { useProviderStore } from "@/stores/providerStore";
import { useShallow } from "zustand/react/shallow";

export function AiSettingsPage() {
  const ai = useSettingsStore((s) => s.ai);
  const update = useSettingsStore((s) => s.updateAi);
  const providers = useProviderStore(useShallow((s) => s.providers.filter((p) => p.enabled)));
  const models = useProviderStore((s) => s.models);

  return (
    <div>
      <SettingsSectionHeader
        title="AI"
        description="Default provider, sampling, context, and streaming behavior."
      />
      <SettingsGroup title="Defaults">
        <SettingSelect
          title="Default provider"
          value={ai.defaultProviderId}
          onValueChange={(v) => update({ defaultProviderId: v })}
          options={providers.map((p) => ({ value: p.id, label: p.name }))}
        />
        <SettingSelect
          title="Default model"
          value={ai.defaultModelId}
          onValueChange={(v) => update({ defaultModelId: v })}
          options={models.map((m) => ({ value: m.id, label: m.label }))}
        />
      </SettingsGroup>
      <SettingsGroup title="Generation">
        <SettingSlider
          id="ai-temp"
          title="Temperature"
          description="Higher = more creative; lower = more deterministic"
          value={ai.temperature}
          min={0}
          max={2}
          step={0.1}
          onValueChange={(v) => update({ temperature: v })}
        />
        <SettingSelect
          title="Context length"
          value={String(ai.contextLength)}
          onValueChange={(v) => update({ contextLength: Number(v) })}
          options={[
            { value: "32000", label: "32K" },
            { value: "128000", label: "128K" },
            { value: "200000", label: "200K" },
            { value: "1000000", label: "1M" },
          ]}
        />
        <SettingSelect
          title="Max tokens"
          value={String(ai.maxTokens)}
          onValueChange={(v) => update({ maxTokens: Number(v) })}
          options={[
            { value: "2048", label: "2,048" },
            { value: "4096", label: "4,096" },
            { value: "8192", label: "8,192" },
            { value: "16384", label: "16,384" },
          ]}
        />
        <SettingToggle
          id="ai-stream"
          title="Streaming responses"
          checked={ai.streaming}
          onCheckedChange={(v) => update({ streaming: v })}
        />
        <SettingToggle
          id="ai-reason"
          title="Reasoning mode"
          description="Prefer models that expose chain-of-thought when available"
          checked={ai.reasoningMode}
          onCheckedChange={(v) => update({ reasoningMode: v })}
        />
      </SettingsGroup>
    </div>
  );
}
