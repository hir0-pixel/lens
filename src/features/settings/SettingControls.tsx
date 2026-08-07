import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export function SettingsSectionHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-5">
      <h2 className="text-[15px] font-semibold text-zinc-100">{title}</h2>
      {description && (
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">{description}</p>
      )}
    </div>
  );
}

export function SettingsGroup({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      {title && (
        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          {title}
        </h3>
      )}
      <div className="overflow-hidden rounded-lg border border-border divide-y divide-border">
        {children}
      </div>
    </div>
  );
}

export function SettingRow({
  title,
  description,
  children,
  id,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <div
      id={id}
      className="flex items-start justify-between gap-4 bg-white/[0.02] px-3.5 py-3 transition-colors hover:bg-white/[0.04]"
    >
      <div className="min-w-0 flex-1 pt-0.5">
        <Label className="text-[13px] font-medium text-zinc-200">{title}</Label>
        {description && (
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-zinc-500">{description}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

export function SettingToggle({
  title,
  description,
  checked,
  onCheckedChange,
  id,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  id?: string;
}) {
  return (
    <SettingRow title={title} description={description} id={id}>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={title} />
    </SettingRow>
  );
}

export function SettingSelect({
  title,
  description,
  value,
  onValueChange,
  options,
  id,
}: {
  title: string;
  description?: string;
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  id?: string;
}) {
  return (
    <SettingRow title={title} description={description} id={id}>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="h-8 w-[180px] border-white/10 bg-surface-2 text-[12px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-[12px]">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}

export function SettingSlider({
  title,
  description,
  value,
  onValueChange,
  min,
  max,
  step = 1,
  suffix,
  id,
}: {
  title: string;
  description?: string;
  value: number;
  onValueChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  id?: string;
}) {
  return (
    <SettingRow title={title} description={description} id={id}>
      <div className="flex w-[200px] items-center gap-3">
        <Slider
          value={[value]}
          min={min}
          max={max}
          step={step}
          onValueChange={(v) => onValueChange(v[0] ?? value)}
          className="flex-1"
          aria-label={title}
        />
        <span className="w-10 text-right font-mono text-[11px] tabular-nums text-zinc-400">
          {value}
          {suffix ?? ""}
        </span>
      </div>
    </SettingRow>
  );
}

export function SettingInput({
  title,
  description,
  value,
  onChange,
  type = "text",
  placeholder,
  mono,
  id,
}: {
  title: string;
  description?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  mono?: boolean;
  id?: string;
}) {
  return (
    <SettingRow title={title} description={description} id={id}>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "h-8 w-[220px] border-white/10 bg-surface-2 text-[12px]",
          mono && "font-mono",
        )}
        aria-label={title}
      />
    </SettingRow>
  );
}

export function SettingRadio({
  title,
  description,
  value,
  onValueChange,
  options,
  id,
}: {
  title: string;
  description?: string;
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  id?: string;
}) {
  return (
    <SettingRow title={title} description={description} id={id}>
      <RadioGroup
        value={value}
        onValueChange={onValueChange}
        className="flex flex-wrap justify-end gap-3"
      >
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-1.5 text-[12px] text-zinc-300">
            <RadioGroupItem value={o.value} id={`${id}-${o.value}`} />
            {o.label}
          </label>
        ))}
      </RadioGroup>
    </SettingRow>
  );
}
