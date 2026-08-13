export type SettingsSectionId =
  | "general"
  | "appearance"
  | "editor"
  | "terminal"
  | "browser"
  | "ai"
  | "models"
  | "providers"
  | "git"
  | "privacy"
  | "accessibility"
  | "keyboard"
  | "about";

export interface GeneralSettings {
  openInNewWindow: boolean;
  restoreWindows: boolean;
  autosave: "off" | "afterDelay" | "onFocusChange" | "onWindowChange";
  autosaveDelay: number;
  confirmBeforeClose: boolean;
  defaultWorkspace: string;
  showWelcomeOnStartup: boolean;
}

export interface EditorSettings {
  tabSize: number;
  wordWrap: "off" | "on" | "wordWrapColumn";
  minimap: boolean;
  lineNumbers: "on" | "off" | "relative";
  rulers: number[];
  cursorStyle: "line" | "block" | "underline";
  cursorBlinking: "blink" | "smooth" | "phase" | "solid";
  formatOnSave: boolean;
  autoComplete: boolean;
  stickyScroll: boolean;
  codeActionsOnSave: boolean;
}

export interface TerminalSettings {
  defaultShell: "powershell" | "bash" | "cmd" | "zsh";
  fontFamily: string;
  fontSize: number;
  cursorStyle: "block" | "underline" | "bar";
  scrollback: number;
  opacity: number;
  renderer: "canvas" | "dom" | "webgl";
}

export interface BrowserSettings {
  homepage: string;
  searchEngine: "google" | "duckduckgo" | "bing";
  downloadDirectory: string;
  blockTrackers: boolean;
}

export interface AiSettings {
  defaultProviderId: string;
  defaultModelId: string;
  temperature: number;
  contextLength: number;
  streaming: boolean;
  reasoningMode: boolean;
  maxTokens: number;
}

export interface GitSettings {
  autoFetch: boolean;
  autoFetchInterval: number;
  confirmCommit: boolean;
  pullStrategy: "merge" | "rebase" | "ff-only";
  preferRebase: boolean;
  showInlineDiff: boolean;
}

export interface PrivacySettings {
  telemetry: boolean;
  crashReporting: boolean;
  diagnostics: boolean;
  usageAnalytics: boolean;
}

export interface AccessibilitySettings {
  screenReaderMode: boolean;
  keyboardNavigation: boolean;
  focusIndicators: "default" | "enhanced";
}

export interface AppSettingsBundle {
  version: number;
  general: GeneralSettings;
  editor: EditorSettings;
  terminal: TerminalSettings;
  browser: BrowserSettings;
  ai: AiSettings;
  git: GitSettings;
  privacy: PrivacySettings;
  accessibility: AccessibilitySettings;
}

export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: AppSettingsBundle = {
  version: SETTINGS_VERSION,
  general: {
    openInNewWindow: false,
    restoreWindows: true,
    autosave: "afterDelay",
    autosaveDelay: 1000,
    confirmBeforeClose: true,
    defaultWorkspace: "~/dev/finance-dashboard",
    showWelcomeOnStartup: true,
  },
  editor: {
    tabSize: 2,
    wordWrap: "on",
    minimap: true,
    lineNumbers: "on",
    rulers: [80, 120],
    cursorStyle: "line",
    cursorBlinking: "smooth",
    formatOnSave: true,
    autoComplete: true,
    stickyScroll: true,
    codeActionsOnSave: true,
  },
  terminal: {
    defaultShell: "powershell",
    fontFamily: "JetBrains Mono",
    fontSize: 12,
    cursorStyle: "block",
    scrollback: 10000,
    opacity: 100,
    renderer: "canvas",
  },
  browser: {
    homepage: "about:blank",
    searchEngine: "google",
    downloadDirectory: "~/Downloads",
    blockTrackers: true,
  },
  ai: {
    defaultProviderId: "lens",
    defaultModelId: "lens-default",
    temperature: 0.7,
    contextLength: 128000,
    streaming: true,
    reasoningMode: true,
    maxTokens: 8192,
  },
  git: {
    autoFetch: true,
    autoFetchInterval: 180,
    confirmCommit: false,
    pullStrategy: "merge",
    preferRebase: false,
    showInlineDiff: true,
  },
  privacy: {
    telemetry: false,
    crashReporting: true,
    diagnostics: true,
    usageAnalytics: false,
  },
  accessibility: {
    screenReaderMode: false,
    keyboardNavigation: true,
    focusIndicators: "default",
  },
};
