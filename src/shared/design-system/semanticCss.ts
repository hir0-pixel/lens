/**
 * Semantic design tokens as CSS custom properties.
 * Components should prefer var(--ds-*) or var(--cursor-*) over hardcoded values.
 * Imported by index.css via @import — also mirrored in :root for dual naming.
 */

export const SEMANTIC_CSS = `
:root {
  /* Surfaces */
  --ds-bg: var(--cursor-editor-bg);
  --ds-surface: var(--cursor-sidebar-bg);
  --ds-surface-elevated: var(--cursor-quick-input-bg);
  --ds-sidebar: var(--cursor-sidebar-bg);
  --ds-editor: var(--cursor-editor-bg);
  --ds-toolbar: var(--cursor-title-bg);
  --ds-panel: var(--cursor-panel-bg);

  /* Text / borders */
  --ds-fg: var(--cursor-fg);
  --ds-fg-muted: var(--cursor-fg-muted);
  --ds-border: var(--cursor-border);
  --ds-selection: var(--cursor-list-active);
  --ds-hover: var(--cursor-list-hover);
  --ds-pressed: #a1a1a1;
  --ds-disabled: 0.4;

  /* Brand / status */
  --ds-primary: var(--lens-accent);
  --ds-secondary: var(--cursor-focus);
  --ds-warning: #f5a623;
  --ds-error: var(--cursor-error);
  --ds-success: #0070f3;
  --ds-info: #0070f3;

  /* Spacing scale */
  --ds-space-1: 4px;
  --ds-space-2: 8px;
  --ds-space-3: 12px;
  --ds-space-4: 16px;
  --ds-space-5: 20px;
  --ds-space-6: 24px;

  /* Motion aliases */
  --ds-dur-fast: var(--cursor-dur-fast);
  --ds-dur-normal: var(--cursor-dur-normal);
  --ds-dur-slow: var(--cursor-dur-slow);
  --ds-ease: var(--cursor-ease);
  --ds-ease-out: var(--cursor-ease-out);

  /* Typography */
  --ds-font-ui: var(--cursor-font-ui);
  --ds-font-mono: var(--cursor-font-mono);
  --ds-text-xs: 11px;
  --ds-text-sm: 13px;
  --ds-text-md: 13px;
  --ds-text-lg: 14px;
}
`;
