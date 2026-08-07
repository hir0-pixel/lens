import {
  Accessibility,
  Boxes,
  GitBranch,
  Globe,
  Info,
  Keyboard,
  Layout,
  Palette,
  Plug,
  Shield,
  Sparkles,
  Terminal,
  Type,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SettingsSectionId } from "./defaults";

export interface SettingsNavItem {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  keywords: string[];
  description: string;
}

export interface SettingsSearchEntry {
  id: string;
  section: SettingsSectionId;
  title: string;
  description?: string;
  keywords: string[];
}

export const SETTINGS_NAV: SettingsNavItem[] = [
  { id: "general", label: "General", icon: Layout, keywords: ["startup", "autosave", "workspace"], description: "Startup and workspace preferences" },
  { id: "appearance", label: "Appearance", icon: Palette, keywords: ["theme", "font", "accent", "dark", "light"], description: "Theme, fonts, and density" },
  { id: "editor", label: "Editor", icon: Type, keywords: ["tab", "wrap", "minimap", "cursor"], description: "Editor behavior and display" },
  { id: "terminal", label: "Terminal", icon: Terminal, keywords: ["shell", "scrollback", "ansi"], description: "Integrated terminal options" },
  { id: "browser", label: "Browser", icon: Globe, keywords: ["homepage", "privacy", "download"], description: "Embedded browser preferences" },
  { id: "ai", label: "AI", icon: Sparkles, keywords: ["temperature", "streaming", "context", "model"], description: "Agent and model defaults" },
  { id: "providers", label: "Providers", icon: Plug, keywords: ["api", "openai", "anthropic", "key"], description: "API keys and provider connections" },
  { id: "models", label: "Models", icon: Boxes, keywords: ["gpt", "claude", "gemini", "favorite"], description: "Installed and favorite models" },
  { id: "git", label: "Git", icon: GitBranch, keywords: ["fetch", "pull", "rebase", "diff"], description: "Source control preferences" },
  { id: "privacy", label: "Privacy", icon: Shield, keywords: ["telemetry", "crash", "analytics"], description: "Telemetry and diagnostics" },
  { id: "accessibility", label: "Accessibility", icon: Accessibility, keywords: ["motion", "contrast", "screen reader"], description: "Keyboard and assistive options" },
  { id: "keyboard", label: "Keyboard", icon: Keyboard, keywords: ["shortcut", "keybinding"], description: "Keyboard shortcut reference" },
  { id: "about", label: "About", icon: Info, keywords: ["version", "export", "import", "reset"], description: "App info and settings backup" },
];

export const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = [
  { id: "g-autosave", section: "general", title: "Auto Save", keywords: ["autosave", "delay"], description: "Automatically save files" },
  { id: "g-startup", section: "general", title: "Show Welcome on Startup", keywords: ["welcome", "startup"] },
  { id: "g-restore", section: "general", title: "Restore Windows", keywords: ["restore", "session"] },
  { id: "a-theme", section: "appearance", title: "Color Theme", keywords: ["dark", "light", "system", "theme"] },
  { id: "a-accent", section: "appearance", title: "Accent Color", keywords: ["accent", "brand", "amber"] },
  { id: "a-font", section: "appearance", title: "Font Family", keywords: ["font", "inter", "typography"] },
  { id: "a-size", section: "appearance", title: "Font Size", keywords: ["size", "scale"] },
  { id: "a-density", section: "appearance", title: "UI Density", keywords: ["compact", "comfortable"] },
  { id: "e-tab", section: "editor", title: "Tab Size", keywords: ["indent", "spaces"] },
  { id: "e-wrap", section: "editor", title: "Word Wrap", keywords: ["wrap"] },
  { id: "e-mini", section: "editor", title: "Minimap", keywords: ["minimap", "overview"] },
  { id: "e-format", section: "editor", title: "Format on Save", keywords: ["format", "prettier"] },
  { id: "t-shell", section: "terminal", title: "Default Shell", keywords: ["powershell", "bash"] },
  { id: "t-scroll", section: "terminal", title: "Scrollback", keywords: ["history", "buffer"] },
  { id: "ai-temp", section: "ai", title: "Temperature", keywords: ["creativity", "random"] },
  { id: "ai-stream", section: "ai", title: "Streaming Responses", keywords: ["stream"] },
  { id: "ai-reason", section: "ai", title: "Reasoning Mode", keywords: ["thinking", "reason"] },
  { id: "p-openai", section: "providers", title: "OpenAI API Key", keywords: ["openai", "chatgpt", "key"] },
  { id: "p-claude", section: "providers", title: "Anthropic API Key", keywords: ["claude", "anthropic"] },
  { id: "p-ollama", section: "providers", title: "Ollama", keywords: ["local", "ollama"] },
  { id: "git-fetch", section: "git", title: "Auto Fetch", keywords: ["fetch", "remote"] },
  { id: "git-pull", section: "git", title: "Pull Strategy", keywords: ["rebase", "merge"] },
  { id: "priv-tele", section: "privacy", title: "Telemetry", keywords: ["telemetry", "usage"] },
  { id: "acc-motion", section: "accessibility", title: "Reduced Motion", keywords: ["motion", "animation"] },
  { id: "acc-contrast", section: "accessibility", title: "High Contrast", keywords: ["contrast"] },
  { id: "about-export", section: "about", title: "Export Settings", keywords: ["backup", "export"] },
  { id: "about-import", section: "about", title: "Import Settings", keywords: ["restore", "import"] },
];

export function searchSettings(query: string): SettingsSearchEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return SETTINGS_SEARCH_INDEX.filter((e) => {
    const hay = `${e.title} ${e.description ?? ""} ${e.keywords.join(" ")} ${e.section}`.toLowerCase();
    return q.split(/\s+/).every((part) => hay.includes(part) || fuzzyIncludes(hay, part));
  }).slice(0, 40);
}

function fuzzyIncludes(hay: string, needle: string): boolean {
  let hi = 0;
  for (let ni = 0; ni < needle.length; ni++) {
    const ch = needle[ni];
    const found = hay.indexOf(ch, hi);
    if (found < 0) return false;
    hi = found + 1;
  }
  return true;
}
