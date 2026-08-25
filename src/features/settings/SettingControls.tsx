import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
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
      <h2 className="type-title-sm font-semibold text-[var(--text-primary)]">{title}</h2>
      {description && (
        <p className="mt-1 type-caption leading-relaxed text-[var(--text-secondary)]">{description}</p>
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
        <h3 className="mb-2 type-caption-uppercase text-[var(--text-tertiary)]">
          {title}
        </h3>
      )}
      <Card className="gap-0 divide-y divide-border overflow-hidden py-0">
        {children}
      </Card>
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
    <Field
      id={id}
      orientation="horizontal"
      className="items-start justify-between gap-4 bg-surface-0/40 px-3.5 py-3 transition-colors hover:bg-[var(--bg-hover)]"
    >
      <FieldLabel className="flex-col items-start gap-1 pt-0.5">
        <FieldTitle className="type-caption font-medium text-[var(--text-primary)]">
          {title}
        </FieldTitle>
        {description && (
          <FieldDescription className="type-caption leading-relaxed text-[var(--text-secondary)]">
            {description}
          </FieldDescription>
        )}
      </FieldLabel>
      <FieldContent className="flex-none flex-row items-center">
        {children}
      </FieldContent>
    </Field>
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
        <SelectTrigger className="h-8 w-[180px] border-[var(--border-default)] bg-surface-2 type-caption">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="type-caption">
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
        <span className="w-10 text-right type-code tabular-nums text-[var(--text-secondary)]">
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
          "h-8 w-[220px] border-[var(--border-default)] bg-surface-2 type-caption",
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
          <label key={o.value} className="flex items-center gap-1.5 type-caption text-[var(--text-secondary)]">
            <RadioGroupItem value={o.value} id={`${id}-${o.value}`} />
            {o.label}
          </label>
        ))}
      </RadioGroup>
    </SettingRow>
  );
}
