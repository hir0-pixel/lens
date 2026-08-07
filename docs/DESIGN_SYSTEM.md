# Orchids Design System

Production visual language for the Orchids Desktop IDE. Goal: **Cursor parity** in layout, spacing, motion, and interaction — with Orchids amber branding preserved.

## Principles

1. **Refine, don’t redesign** — keep established chrome; tighten tokens and rhythm.
2. **One hierarchy** — Nav Rail → Navigator → **Agent** → Tools → Utility → Status Bar.
3. **Subtle motion** — 100–220ms, ease-out; respect `reduce-motion`.
4. **Semantic first** — prefer `border-border`, `text-muted-foreground`, `bg-surface-*` over raw zinc/white opacity.
5. **Brand sparingly** — accent `#FCAA26` for active indicators, CTAs, and Orchids provider.

## Tokens

Source of truth:

- TypeScript: `src/shared/design-system/tokens.ts`
- CSS variables: `src/index.css` (`:root`)
- Tailwind mapping: `tailwind.config.js`

### Surfaces

| Token | Role |
|-------|------|
| `surface-0` | Editor / content canvas |
| `surface-1` | Sidebars, status bar, chrome |
| `surface-2` | Elevated inputs, menus |
| `surface-3–4` | Nested elevation |

### Typography roles

| Role | Size | Usage |
|------|------|--------|
| meta | 10px | Badges, mono ids |
| caption | 11px | Panel titles (uppercase), status bar |
| body | 12px | Lists, settings rows |
| bodyEmphasis | 13px | Headers, AI title |
| title | 14–15px | Dialog / page titles |
| mono | JetBrains Mono | Code, paths, keys |

Avoid fractional sizes (`10.5`, `11.5`, `12.5`).

### Icon sizes

| Context | Size |
|---------|------|
| Activity Bar | 18px |
| Toolbar | 14px (`h-3.5`) |
| Status Bar | 12px |
| Palette rows | 16px (`h-4`) |

Stroke: prefer `1.75` on activity icons, default elsewhere.

### Layout chrome

| Element | Height / width |
|---------|----------------|
| Activity Bar | 48px wide |
| Panel header | 36px (`h-9`) |
| Toolbar | 32px (`h-8`) |
| Status Bar | 22px |
| Top Bar | 40px (`h-10`) |

### Motion

| Token | Duration |
|-------|----------|
| fast | 100ms |
| normal | 150ms |
| slow | 200ms |
| enter | 220ms |

Easing: `cubic-bezier(0.16, 1, 0.3, 1)` (`ease-orchids`).

Chrome uses `transition-colors duration-150`. Entrance: `animate-fade-in` / `fade-up` / `scale-in` for overlays and AI content only.

### Borders & dividers

Always `border-border` for panel seams. Do not mix `border-white/5` with `border-border` on adjacent chrome.

### Focus & a11y

- Visible `:focus-visible` ring using `--ring`
- `aria-pressed` / `aria-current` on toggles and nav
- High contrast + reduced motion via appearance store classes
- Status colors: `.text-error`, `.text-warning`, `.text-success`, `.text-info`

## Component guidelines

### Panel chrome

Use `PanelHeader` / `.wb-panel-header` for title rows and `.wb-toolbar` for secondary toolbars.

### Empty states

Use `WorkbenchEmptyState` — icon plate, title, description, optional actions + shortcut hints.

### Loading

Use `Skeleton` (shimmer) or `WorkbenchSkeleton` for list/card/editor placeholders.

### Errors

Use `WorkbenchBanner` for inline errors/warnings; Sonner toasts for transient feedback.

### Provider colors

Use `ProviderDot` / `PROVIDER_COLORS` — never duplicate hex maps in feature code.

## Spacing

4px base grid (`SPACE` in tokens). Panel padding: header `px-3`, content lists `px-2`, dialogs `px-5`.

## Accessibility rules

1. Every icon-only button needs `aria-label`.
2. Keyboard focus must be visible.
3. Do not rely on color alone for git/diagnostic status (icon + color).
4. Honor `reduce-motion` and `high-contrast` document classes.

## Checklist for new UI

- [ ] Uses surface / border / muted tokens
- [ ] Header is `h-9` or toolbar `h-8`
- [ ] Icons match the size contract
- [ ] Transitions use `duration-150` (or motion tokens)
- [ ] Empty / loading / error states covered
- [ ] Focus and ARIA labels present
