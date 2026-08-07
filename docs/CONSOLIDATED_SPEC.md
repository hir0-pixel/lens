# Orchids Frontend — Consolidated Spec Status

Implements the AI-first workspace design system (violet gradient accent) against the consolidated frontend prompt.

## Layout (unchanged grid roles)

```
Activity (48) | Sidebar (--sidebar-w) | Content (1fr) | Agent (--ai-panel-w)
              |                      | Utility bottom spanning content+agent
```

Panel sizes: Zustand `layoutStore` → CSS vars `--sidebar-w`, `--ai-panel-w`, `--bottom-panel-h`. Drag via `PanelSash`; persist `orchids-layout`.

## Design tokens

- Solid `--accent-primary` (violet `hsl(266 85% 65%)`) for dots, borders, links
- `--gradient-accent` reserved for: `.btn-primary`, streaming composer border, thinking glow
- Default appearance accent: `violet`

## Definition of done

| Criterion | Status |
|-----------|--------|
| Top bar: one gradient primary (Deploy) | Yes — `.btn-primary` |
| Agent panel: session / modes / chips / plan / review | Yes |
| Bottom + right resize, persist, collapse | Yes |
| Truncation + `title` on tabs/chips/paths/history/plan | Yes |
| Hover + focus-visible on buttons / modes | Yes |
| Gradient only on CTA / thinking / streaming | Yes |
| Empty/error animated enter + button hierarchy | Yes |

## Verify

```bash
npm run typecheck
npm run build
```
