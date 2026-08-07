# Orchids Desktop — UI Rebuild Status

**Date:** 2026-08-06  
**Goal:** Professional desktop IDE experience with Orchids branding (interaction patterns, not proprietary asset cloning).

## Architecture summary

Feature modules under `src/features/` (menu-bar, shell, command-palette, source-control, settings) + workbench chrome in `src/components/shell|explorer|output|ai|terminal`. Design tokens live in `src/shared/design-system` and CSS `--ds-*` / `--cursor-*` in `src/index.css`.

## This pass — rebuilt / upgraded

| Area | Change |
|------|--------|
| Design tokens | Unified `LAYOUT`/`MOTION`/`SEMANTIC`; `--ds-*` semantic CSS aliases; `prefers-reduced-motion` |
| Explorer | CRUD, rename (F2), multi-select, DnD into folders, filter, working context menus |
| Editor tabs | Pin (dbl-click/context), dirty from store, overflow fades, breadcrumbs |
| Editor | Dirty tracking, cursor → status bar, Ctrl+F find widget |
| AI empty/chat | Flattened density (no glow cards / max-width chat column) |
| Bottom panel | Debug Console + Ports; Close ≠ Hide |
| Status bar | Live Ln/Col, language, errors, unsaved, interactive items |

## Build verification

Run `npm run typecheck` and `npm run build`.

## Remaining issues

- Split editor groups not yet implemented
- AI message bubbles / composer still partially rounded (further flatten in next pass)
- Explorer DnD is mock in-memory only (no FS)
- Menu bar is Radix dropdowns (not full arrow-key menubar pattern)
- Large-workspace virtualization pending

## Next recommended

1. Flatten remaining AI chrome (`AIMessageBubble`, `AIComposer`)
2. Editor split groups
3. Tree virtualization + a11y menubar
4. Persist dirty buffers / session restore
