import { PROVIDER_COLORS } from "@/shared/design-system";
import { cn } from "@/lib/utils";

/** Map mock model provider ids → brand color tokens */
const ALIAS: Record<string, string> = {
  orchids: PROVIDER_COLORS.orchids,
  claude: PROVIDER_COLORS.anthropic,
  anthropic: PROVIDER_COLORS.anthropic,
  chatgpt: PROVIDER_COLORS.openai,
  openai: PROVIDER_COLORS.openai,
  gemini: PROVIDER_COLORS.google,
  google: PROVIDER_COLORS.google,
  copilot: PROVIDER_COLORS.cursor,
  cursor: PROVIDER_COLORS.cursor,
  ollama: PROVIDER_COLORS.ollama,
  openrouter: PROVIDER_COLORS.openrouter,
  azure: PROVIDER_COLORS.azure,
  custom: PROVIDER_COLORS.custom,
};

export function providerColor(provider: string): string {
  return ALIAS[provider] ?? PROVIDER_COLORS.custom;
}

interface ProviderDotProps {
  provider: string;
  className?: string;
}

export function ProviderDot({ provider, className }: ProviderDotProps) {
  const isOrchids = provider === "orchids";
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        isOrchids && "bg-accent",
        className,
      )}
      style={isOrchids ? undefined : { backgroundColor: providerColor(provider) }}
      aria-hidden
    />
  );
}
